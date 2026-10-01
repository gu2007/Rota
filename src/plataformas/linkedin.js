// Abre as vagas do LinkedIn (vindas dos alertas) só para descobrir onde é a candidatura.
// Não pesquisa nem usa a Candidatura simplificada: o LinkedIn proíbe automação e pode restringir a conta.

const { abrirNavegador, pausa, lerPagina } = require('../navegador/navegador');
const { normalizarUrl, detectarPlataformaEnvio } = require('../util/url');
const { pontuar } = require('../ia/pontuador');
const fs = require('fs');
const path = require('path');

const POR_VEZ = 2;

// roda no contexto da página
function lerVagaLinkedin() {
  const txt = (e) => (e?.innerText || '').replace(/\s+/g, ' ').trim();
  const visivel = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const corpo = document.body.innerText || '';

  // na página de visitante o link externo vem num comentário dentro de code#applyUrl
  let externo = null;
  const code = document.querySelector('code#applyUrl');
  if (code) { const m = code.innerHTML.match(/"(https?:[^"]+)"/); if (m) externo = m[1]; }

  // só o botão principal conta; a lista lateral tem "Candidatura simplificada" de outras vagas
  const DE_OUTRA_VAGA = '[class*=job-card], [class*=jobs-search-results], [class*=scaffold-layout__list], [class*=similar-jobs], [class*=jobs-similar], aside, [class*=discovery]';
  const APLICAR = /^(candidatura simplificada|easy apply|candidatar-se|candidatar|apply|aplicar)(\s|$|\b)/i;
  const botoes = [...document.querySelectorAll('button, a')]
    .filter((b) => visivel(b) && !b.closest(DE_OUTRA_VAGA))
    .map((b) => ({ b, t: txt(b) || '', aria: b.getAttribute('aria-label') || '' }))
    .filter((x) => (APLICAR.test(x.t) || APLICAR.test(x.aria) || /jobs-apply-button/.test(String(x.b.className))) && !/entrar|sign in|login/i.test(x.t));
  let principal = botoes.find((x) => /jobs-apply-button/.test(String(x.b.className)))
    || botoes.find((x) => x.b.closest('[class*=top-card], [class*=topcard], [class*=job-details-jobs-unified], main'))
    || botoes[0];
  // plano B: botão de candidatura mais perto, abaixo do h1
  if (!principal) {
    const h1 = document.querySelector('h1')?.getBoundingClientRect();
    const todos = [...document.querySelectorAll('button, a')].filter(visivel)
      .map((b) => ({ b, t: txt(b) || '', aria: b.getAttribute('aria-label') || '' }))
      .filter((x) => (APLICAR.test(x.t) || APLICAR.test(x.aria)) && !/entrar|sign in|login/i.test(x.t));
    if (h1) {
      const dist = (x) => { const r = x.b.getBoundingClientRect(); return r.top >= h1.top - 40 ? r.top - h1.top + Math.abs(r.left - h1.left) / 4 : 1e9; };
      todos.sort((a, b) => dist(a) - dist(b));
    }
    principal = todos[0];
  }
  // botão que já é link externo: não precisa clicar
  const href = principal?.b.tagName === 'A' ? principal.b.href : '';
  if (!externo && href && (/externalApply|[?&]url=/.test(href) || !/linkedin\.com/.test(href))) externo = href;
  const textoBotao = principal ? (principal.t || principal.aria) : '';
  const simplificada = !!principal && /simplificada|easy apply/i.test(`${principal.t} ${principal.aria}`);
  const candidatar = principal && !simplificada ? principal : null;
  document.querySelectorAll('[data-rota-botao]').forEach((e) => e.removeAttribute('data-rota-botao'));
  if (candidatar) candidatar.b.setAttribute('data-rota-botao', '1');

  // fallback do título: nome da aba ("Cargo | Empresa | LinkedIn")
  const partesAba = (document.title || '').replace(/^\(\d+\)\s*/, '').split('|').map((t) => t.trim());
  const titulo = txt(document.querySelector('h1')) || (partesAba.length >= 2 ? partesAba[0] : '');
  const empresaAba = partesAba.length >= 3 ? partesAba[1] : '';
  const empresa = empresaAba || txt(document.querySelector('[class*=company-name] a, [class*=company-name], a[href*="/company/"][data-tracking-control-name*=org-name], .topcard__org-name-link'));
  // "São Paulo, SP · há 2 dias · 30 candidaturas"
  const linhaTopo = txt(document.querySelector('[class*=primary-description], [class*=tertiary-description], .topcard__flavor--bullet, [class*=topcard__flavor-row]'));
  const local = (linhaTopo.split('·')[0] || '').trim() || null;
  const topo = txt(document.querySelector('main')).slice(0, 1500);
  const modelo = /h[ií]brid/i.test(topo) ? 'hibrido' : /remot/i.test(topo) ? 'remoto' : /presencial|on-site/i.test(topo) ? 'presencial' : null;
  const descricao = txt(document.querySelector('#job-details, [class*=jobs-description__content], [class*=jobs-box__html-content], .show-more-less-html__markup, [class*=description__text]'));

  return {
    titulo, empresa: empresa || null, local, modelo, descricao: descricao.slice(0, 8000),
    externo, simplificada, temBotao: !!candidatar, botao: textoBotao.slice(0, 60) || null,
    fechada: /n[aã]o (est[aá] )?aceita(ndo)? mais candidaturas|no longer accepting applications|vaga (foi )?encerrada|candidaturas? encerradas?|inscri[cç][oõ]es encerradas|n[aã]o est[aá] mais dispon[ií]vel|vaga (foi )?(expirad|pausad|fechad)|this job is no longer available|job (has )?expired|no longer available/i.test(corpo.slice(0, 6000)),
    pedeLogin: /entre para ver|sign in to|fa[cç]a login|entrar no linkedin/i.test(corpo.slice(0, 3000)) && !titulo,
  };
}

// O LinkedIn embrulha o link de fora: .../externalApply/123?url=<destino>
function desembrulhar(url) {
  try {
    const u = new URL(url);
    const dentro = u.searchParams.get('url');
    if (/linkedin\.com$/.test(u.hostname) && dentro) return dentro;
  } catch { /* segue */ }
  return url;
}

// clica em "Candidatar-se" só para ler a URL de destino (não envia nada)
async function descobrirDestino(pagina, contexto) {
  const abertas = new Set(contexto.pages());
  const botao = pagina.locator('[data-rota-botao]').first();
  await botao.scrollIntoViewIfNeeded().catch(() => {});
  await pausa(800, 1800);
  await botao.click({ timeout: 8000 }).catch(() => botao.evaluate((el) => el.click()).catch(() => {}));

  // até 15s: aba nova, saída do LinkedIn ou aviso intermediário que pede "Continuar"
  let nova = null;
  let avisos = 0;
  const limite = Date.now() + 15000;
  while (Date.now() < limite) {
    await pausa(700, 900);
    nova = contexto.pages().find((p) => !abertas.has(p)) || null;
    if (nova || !/linkedin\.com/.test(pagina.url())) break;
    if (avisos < 2) {
      const continuar = pagina.locator('[role=dialog] button, [role=alertdialog] button, [aria-modal=true] button, [class*=modal] button')
        .filter({ hasText: /^\s*(continuar|continue|candidatar-se|prosseguir|confirmar|ok|sim)\b/i }).first();
      if (await continuar.count().catch(() => 0)) {
        avisos++;
        await continuar.click().catch(() => {});
      }
    }
  }
  const alvo = nova || pagina;
  await alvo.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});
  // espera os redirecionamentos terminarem
  let url = alvo.url();
  for (let i = 0; i < 8; i++) {
    await pausa(900, 1100);
    if (alvo.url() === url && !/linkedin\.com|about:blank/.test(url)) break;
    url = alvo.url();
  }
  // ainda no LinkedIn: o destino costuma estar no ?url= ou num link da página
  if (/linkedin\.com/.test(url)) {
    const dentro = desembrulhar(url);
    if (!/linkedin\.com/.test(dentro)) url = dentro;
    else {
      const externo = await alvo.evaluate(() => [...document.querySelectorAll('a[href^="http"]')]
        .map((a) => a.href).find((h) => !/linkedin\.com|licdn\.com|lnkd\.in/.test(h))).catch(() => null);
      if (externo) url = desembrulhar(externo);
    }
  }
  if (nova) await nova.close().catch(() => {});
  return /linkedin\.com|about:blank/.test(url) ? null : url;
}

// salva print e botões para depurar layouts novos
async function salvarDiagnostico(pagina, vaga) {
  try {
    const pasta = path.join(__dirname, '..', '..', 'dados', 'linkedin');
    fs.mkdirSync(pasta, { recursive: true });
    const base = path.join(pasta, `${new Date().toISOString().slice(0, 10)}-vaga-${vaga.id}`);
    await pagina.screenshot({ path: `${base}.png`, fullPage: false }).catch(() => {});
    const botoes = await pagina.evaluate(() => [...document.querySelectorAll('button, a')]
      .filter((e) => e.getBoundingClientRect().width > 0)
      .map((e) => ({ tag: e.tagName, texto: (e.innerText || '').trim().slice(0, 60), aria: e.getAttribute('aria-label'), classe: String(e.className || '').slice(0, 80), href: e.getAttribute('href') }))
      .filter((b) => b.texto || b.aria).slice(0, 80)).catch(() => []);
    fs.writeFileSync(`${base}.json`, JSON.stringify({ url: pagina.url(), titulo: await pagina.title().catch(() => ''), botoes }, null, 2));
    return `${base}.png`;
  } catch { return null; }
}

// devolve os campos a atualizar no banco e um resumo para o log
async function resolverVaga(vaga, { pagina, contexto, config, repo }) {
  await pagina.goto(vaga.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await pausa(2500, 4500);
  await lerPagina(pagina).catch(() => {});
  const info = await pagina.evaluate(lerVagaLinkedin);

  if (info.pedeLogin) return { erro: 'O LinkedIn pediu login. Rode "npm run gupy:login", entre no LinkedIn nessa janela e feche.' };
  if (info.fechada) return { dados: { status: 'descartada', motivo_status: 'LinkedIn: a vaga não aceita mais candidaturas' }, resumo: 'encerrada' };

  const base = {
    titulo: info.titulo || vaga.titulo, empresa: info.empresa || vaga.empresa,
    local: info.local || vaga.local, modelo: info.modelo || vaga.modelo, descricao: info.descricao || vaga.descricao,
  };
  if (info.simplificada && !info.externo) {
    return { dados: { ...base, status: 'para_voce', motivo_status: 'Candidatura simplificada do LinkedIn: essa é com você, pelo app (o bot não usa a sua conta do LinkedIn para se candidatar)' }, resumo: `candidatura simplificada (botão principal: "${info.botao}")` };
  }

  let destino = info.externo ? desembrulhar(info.externo) : null;
  if (!destino && info.temBotao) destino = await descobrirDestino(pagina, contexto);
  if (!destino) {
    const print = await salvarDiagnostico(pagina, vaga);
    if (print) info.botao = `${info.botao || 'nenhum'}" · print em "${print}`;
  }
  // sem botão de candidatura a vaga quase sempre já foi encerrada
  if (!destino && !info.temBotao) return { dados: { ...base, status: 'descartada', motivo_status: 'LinkedIn: a vaga não tem mais botão de candidatura (provavelmente encerrada)' }, resumo: 'sem botão de candidatura: provavelmente encerrada' };
  if (!destino) return { dados: { ...base, status: 'erro', motivo_status: 'LinkedIn: não achei o link de candidatura na página da vaga' }, resumo: `sem link (botão principal: "${info.botao || 'nenhum'}")` };

  const url = normalizarUrl(destino) || destino;
  const plataforma = detectarPlataformaEnvio(url);
  // já veio por outro caminho (ex.: portal da Gupy)
  const outra = await repo.vagas.buscarPorUrl(url, vaga.id);
  if (outra) {
    return { dados: { ...base, url_candidatura: url, plataforma_envio: plataforma, status: 'descartada', motivo_status: `Mesma vaga já está no sistema (#${outra.id})` }, resumo: 'repetida' };
  }
  const { nota, justificativa } = await pontuar({ ...vaga, ...base, url_candidatura: url }, { config });
  const aprovada = nota >= config.notaMinima;
  return {
    dados: {
      ...base, url_candidatura: url, plataforma_envio: plataforma, nota, justificativa,
      status: aprovada ? 'na_fila' : 'descartada',
      motivo_status: aprovada ? `Candidatura em: ${new URL(url).hostname}` : `Nota ${nota} abaixo do mínimo (${config.notaMinima})`,
    },
    resumo: `${plataforma} (${new URL(url).hostname}), nota ${nota}`,
  };
}

async function coletar(ctx, { abrir = abrirNavegador } = {}) {
  const { repo } = ctx;
  if (!repo) return [];
  const pendentes = (await repo.vagas.listar({ status: 'na_fila', limite: 500 }))
    .filter((v) => v.plataforma_envio === 'linkedin')
    .slice(0, POR_VEZ);
  if (!pendentes.length) {
    await ctx.log('info', 'linkedin', 'Nenhuma vaga do LinkedIn esperando para descobrir o link de candidatura.');
    return [];
  }
  const nav = await abrir();
  try {
    for (const resumo of pendentes) {
      const vaga = await repo.vagas.obter(resumo.id);
      try {
        const r = await resolverVaga(vaga, { pagina: nav.pagina, contexto: nav.contexto, config: ctx.config, repo });
        if (r.erro) { await ctx.log('erro', 'linkedin', r.erro); break; }
        await repo.vagas.atualizar(vaga.id, r.dados);
        await ctx.log('info', 'linkedin', `${r.dados.titulo || vaga.titulo}: ${r.resumo}.`);
      } catch (e) {
        await ctx.log('erro', 'linkedin', `${vaga.titulo}: ${e.message.split('\n')[0]}`);
      }
      await pausa(4000, 9000);
    }
  } finally {
    await nav.fechar().catch(() => {});
  }
  return []; // as vagas já estão no banco, aqui só são atualizadas
}

module.exports = { tipo: 'coleta', coletar, resolverVaga, lerVagaLinkedin, desembrulhar, POR_VEZ };
