// Indeed: busca vagas (coleta/indeed-busca.js) e abre cada uma para descobrir onde é a candidatura.
// "Candidatar-se no site da empresa" -> o Rota segue o link e a vaga vai para a fila (Gupy ou site).
// Candidatura pelo próprio Indeed precisa da sua conta: a vaga vai para "Para você".

const { abrirNavegador, pausa, lerPagina } = require('../navegador/navegador');
const { normalizarUrl, detectarPlataformaEnvio } = require('../util/url');
const { pontuar } = require('../ia/pontuador');
const { conferirArea } = require('../ia/conferir-area');
const { temDesafio } = require('../candidatura/leitor-pagina');
const busca = require('../coleta/indeed-busca');

const POR_VEZ = 5;

// roda na página da vaga
function lerVagaIndeed() {
  const corpo = document.body.innerText || '';
  const visivel = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const botoes = [...document.querySelectorAll('button, a')].filter(visivel)
    .map((b) => ({ b, t: (b.innerText || b.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim() }))
    .filter((x) => /candidat|apply/i.test(x.t) && x.t.length < 60 && !/salvar|save|alerta/i.test(x.t));
  const externo = botoes.find((x) => /site da empresa|company site|company's site/i.test(x.t));
  const proprio = botoes.find((x) => x !== externo);
  document.querySelectorAll('[data-rota-botao]').forEach((e) => e.removeAttribute('data-rota-botao'));
  if (externo) externo.b.setAttribute('data-rota-botao', '1');
  const pos = corpo.search(/descri[cç][aã]o completa da vaga|full job description/i);
  return {
    titulo: (document.querySelector('h1')?.innerText || '').trim() || (document.title || '').split(' - ')[0].trim(),
    descricao: (pos >= 0 ? corpo.slice(pos) : corpo).slice(0, 8000),
    externo: !!externo, href: externo?.b.tagName === 'A' ? externo.b.href : null,
    botao: (externo || proprio)?.t || null,
    fechada: /esta vaga (expirou|n[aã]o est[aá] mais)|this job has expired|vaga expirada/i.test(corpo.slice(0, 4000)),
  };
}

// clica em "Candidatar-se no site da empresa" só para ler o endereço de destino (não envia nada)
async function descobrirDestino(pagina, contexto) {
  const abertas = new Set(contexto.pages());
  await pagina.locator('[data-rota-botao]').first().click({ timeout: 8000 }).catch(() => {});
  let nova = null;
  const limite = Date.now() + 15000;
  while (Date.now() < limite) {
    await pausa(700, 900);
    nova = contexto.pages().find((p) => !abertas.has(p)) || null;
    if (nova || !/indeed\.com/.test(pagina.url())) break;
  }
  const alvo = nova || pagina;
  await alvo.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});
  let url = alvo.url();
  for (let i = 0; i < 8; i++) {
    await pausa(900, 1100);
    if (alvo.url() === url && !/indeed\.com|about:blank/.test(url)) break;
    url = alvo.url();
  }
  if (nova) await nova.close().catch(() => {});
  return /indeed\.com|about:blank/.test(url) ? null : url;
}

async function resolverVaga(vaga, { pagina, contexto, config, repo }) {
  await pagina.goto(vaga.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await pausa(2500, 4500);
  if (await pagina.evaluate(temDesafio).catch(() => null)) return { erro: 'O Indeed pediu verificação anti-robô: paro por agora.' };
  await lerPagina(pagina).catch(() => {});
  const info = await pagina.evaluate(lerVagaIndeed);
  const base = { titulo: info.titulo || vaga.titulo, descricao: info.descricao || vaga.descricao };
  if (info.fechada) return { dados: { ...base, status: 'descartada', motivo_status: 'Indeed: vaga expirada' }, resumo: 'expirada' };
  if (!info.externo) {
    return info.botao
      ? { dados: { ...base, status: 'para_voce', motivo_status: 'Candidatura pelo próprio Indeed (precisa da sua conta): essa é com você' }, resumo: `pelo Indeed ("${info.botao}")` }
      : { dados: { ...base, status: 'descartada', motivo_status: 'Indeed: sem botão de candidatura' }, resumo: 'sem botão de candidatura' };
  }
  const destino = info.href && !/indeed\.com/.test(info.href) ? info.href : await descobrirDestino(pagina, contexto);
  if (!destino) return { dados: { ...base, status: 'erro', motivo_status: 'Indeed: não achei o link do site da empresa' }, resumo: 'sem link' };
  const url = normalizarUrl(destino) || destino;
  const plataforma = detectarPlataformaEnvio(url);
  const outra = await repo.vagas.buscarPorUrl(url, vaga.id);
  if (outra) return { dados: { ...base, url_candidatura: url, plataforma_envio: plataforma, status: 'descartada', motivo_status: `Mesma vaga já está no sistema (#${outra.id})` }, resumo: 'repetida' };
  const { nota, justificativa } = await pontuar({ ...vaga, ...base, url_candidatura: url, descricaoLida: true }, { config });
  const area = nota >= config.notaMinima ? await conferirArea({ ...vaga, ...base }, { config }) : null;
  if (area && !area.ok) return { dados: { ...base, url_candidatura: url, plataforma_envio: plataforma, nota: 5, justificativa: area.motivo, status: 'descartada', motivo_status: area.motivo }, resumo: `descartada: ${area.motivo}` };
  const aprovada = nota >= config.notaMinima;
  return {
    dados: {
      ...base, url_candidatura: url, plataforma_envio: plataforma, nota, justificativa: area ? `${justificativa}; ${area.motivo}` : justificativa,
      status: aprovada ? 'na_fila' : 'descartada',
      motivo_status: aprovada ? `Candidatura em: ${new URL(url).hostname}` : `Nota ${nota} abaixo do mínimo (${config.notaMinima})`,
    },
    resumo: `${plataforma} (${new URL(url).hostname}), nota ${nota}`,
  };
}

// busca vagas novas (devolve para quem chamou gravar) e abre as do Indeed que estão na fila
async function coletar(ctx, { abrir = abrirNavegador, porVez = POR_VEZ, buscar = true } = {}) {
  const { repo } = ctx;
  const nav = await abrir();
  let novas = [];
  try {
    if (buscar) {
      const local = String(ctx.config?.localizacao || 'São Paulo').split(/[;]/)[0].trim() || 'São Paulo';
      novas = await busca.buscar(nav.pagina, { termos: ctx.config.termosBusca, local, maxDias: ctx.config.maxDias, log: ctx.log });
    }
    const pendentes = repo ? (await repo.vagas.listar({ status: 'na_fila', limite: 500 })).filter((v) => v.plataforma_envio === 'indeed').slice(0, porVez) : [];
    for (const resumo of pendentes) {
      const vaga = await repo.vagas.obter(resumo.id);
      try {
        const r = await resolverVaga(vaga, { pagina: nav.pagina, contexto: nav.contexto, config: ctx.config, repo });
        if (r.erro) { await ctx.log('aviso', 'indeed', r.erro); break; }
        await repo.vagas.atualizar(vaga.id, r.dados);
        await ctx.log('info', 'indeed', `${r.dados.titulo || vaga.titulo}: ${r.resumo}.`);
      } catch (e) {
        await ctx.log('erro', 'indeed', `${vaga.titulo}: ${e.message.split('\n')[0]}`);
      }
      await pausa(4000, 9000);
    }
  } finally {
    await nav.fechar().catch(() => {});
  }
  return novas;
}

module.exports = { tipo: 'coleta', coletar, resolverVaga, lerVagaIndeed };
