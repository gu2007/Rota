// Candidatura feita pelo agente de IA do começo ao fim (é o que o "npm run rodar" usa).
// Abre a vaga, aceita cookies, confere se ainda está aberta e se é de TI na sua cidade (pela descrição),
// e o agente faz o resto. Se ele travar, a janela fica aberta para você (o Rota observa e aprende).
const path = require('path');
const { abrirNavegador, pausa } = require('../navegador/navegador');
const { aceitarCookies } = require('../navegador/cookies');
const { avisar } = require('../navegador/aviso');
const { conferirArea } = require('../ia/conferir-area');
const aprendizado = require('../candidatura/aprendizado');
const { dataLocal } = require('../util/tempo');
const gupy = require('../plataformas/gupy');
const { agir } = require('./agente');

const ENCERRADA = /vaga (encerrada|expirada|finalizada)|n[aã]o est[aá] mais dispon[ií]vel|n[aã]o aceita mais candidaturas|no longer (available|accepting)|job (has )?expired/i;

async function candidatarComAgente(vaga, ctx, { abrir = abrirNavegador, aoTravar } = {}) {
  const pasta = path.join(__dirname, '..', '..', 'dados', 'agente', `${dataLocal()}-vaga-${vaga.id}`);
  const memoria = aprendizado.carregar();
  const nav = await abrir();
  let r;
  try {
    await nav.pagina.goto(vaga.url_candidatura || vaga.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await pausa(2500, 4000);
    await aceitarCookies(nav.pagina);
    const texto = await nav.pagina.innerText('body').catch(() => '');
    if (ENCERRADA.test(texto.slice(0, 5000))) {
      r = { resultado: 'descartada', motivo: 'Vaga encerrada', respostas: [] };
    } else {
      const descricao = String(vaga.descricao || '').length >= 400 ? vaga.descricao : texto.slice(0, 8000);
      const area = await conferirArea({ ...vaga, descricao }, { config: ctx.config });
      if (!area.ok) r = { resultado: 'descartada', motivo: area.motivo, respostas: [] };
    }
    if (!r) {
      await avisar(nav.pagina, 'trabalhando').catch(() => {});
      r = await agir({
        pagina: nav.pagina, contexto: nav.contexto, vaga, preencherFn: gupy.preencher, loginSocialFn: gupy.fazerLogin,
        inicio: true, pastaPrints: pasta, log: ctx.log || (async () => {}),
        ctx: { ...ctx, aprendidas: Object.values(memoria.respostas || {}).map((a) => ({ pergunta: a.pergunta, resposta: String(a.valor) })) },
      });
      if (r.resultado === 'ja_candidatado') r = { ...r, resultado: 'candidatada_antes', motivo: r.motivo || 'Você já se candidatou a esta vaga' };
      if (r.resultado === 'encerrada') r = { ...r, resultado: 'descartada' };
      // travou: a janela fica aberta para você terminar (o Rota observa e aprende)
      if (aoTravar && ['erro', 'pulada'].includes(r.resultado)) {
        r.observado = await aoTravar({ contexto: nav.contexto, pagina: nav.contexto.pages().at(-1) || nav.pagina, resultado: r }).catch(() => null);
        if (r.observado?.enviada) r = { ...r, resultado: 'enviada', motivo: 'Enviada por você (o Rota observou)' };
      }
    }
  } catch (e) {
    r = { resultado: 'erro', motivo: e.message.split('\n')[0], respostas: [] };
  } finally {
    await nav.fechar().catch(() => {});
  }
  return { ...r, pasta, resolvidoPor: 'agente' };
}

module.exports = { candidatarComAgente };
