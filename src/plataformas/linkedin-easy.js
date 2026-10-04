// Candidatura simplificada (Easy Apply) do LinkedIn, feita pelo agente de IA com a SUA conta.
// Atenção: o LinkedIn proíbe automação na conta e pode restringi-la. Por isso:
//   - no máximo ROTA_EASY_POR_DIA por dia (padrão 10), contando as do modo teste;
//   - pausas longas entre uma e outra (quem chama já espera alguns minutos);
//   - modo teste para antes de "Enviar candidatura".
const fs = require('fs');
const path = require('path');
const { abrirNavegador, pausa } = require('../navegador/navegador');
const { aceitarCookies } = require('../navegador/cookies');
const { avisar } = require('../navegador/aviso');
const { conferirArea } = require('../ia/conferir-area');
const aprendizado = require('../candidatura/aprendizado');
const { dataLocal } = require('../util/tempo');
const gupy = require('./gupy');

const ARQUIVO = path.join(__dirname, '..', '..', 'dados', 'easy-apply.json');
const POR_DIA = () => Number(process.env.ROTA_EASY_POR_DIA) || 10;
const hoje = () => dataLocal();
const lerContagem = () => { try { const j = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')); return j.dia === hoje() ? j.feitas : 0; } catch { return 0; } };
const anotar = () => { fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true }); fs.writeFileSync(ARQUIVO, JSON.stringify({ dia: hoje(), feitas: lerContagem() + 1 })); };

async function candidatar(vaga, ctx, { abrir = abrirNavegador, aoTravar } = {}) {
  if (lerContagem() >= POR_DIA()) return { resultado: 'pulada', motivo: `Limite de ${POR_DIA()} candidaturas simplificadas por dia (proteção da sua conta do LinkedIn): fica para amanhã`, respostas: [], adiar: true };
  const { agir } = require('../agente/agente');
  const pasta = path.join(__dirname, '..', '..', 'dados', 'linkedin-easy', `${hoje()}-vaga-${vaga.id}`);
  const memoria = aprendizado.carregar();
  const nav = await abrir();
  let r;
  try {
    await nav.pagina.goto(vaga.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await pausa(3000, 5000);
    await aceitarCookies(nav.pagina);
    if (/linkedin\.com\/(login|uas|checkpoint|authwall)/.test(nav.pagina.url())) {
      r = { resultado: 'pulada', motivo: 'O LinkedIn não está logado no Chrome do Rota: rode "npm run entrar linkedin"', respostas: [] };
    } else {
      // confere de novo pela descrição e pela cidade
      const texto = (await nav.pagina.innerText('body').catch(() => '')).slice(0, 8000);
      const area = await conferirArea({ ...vaga, descricao: String(vaga.descricao || '').length >= 400 ? vaga.descricao : texto }, { config: ctx.config });
      if (!area.ok) r = { resultado: 'descartada', motivo: area.motivo, respostas: [] };
    }
    if (!r) {
      anotar();
      await avisar(nav.pagina, 'trabalhando').catch(() => {});
      r = await agir({
        pagina: nav.pagina, contexto: nav.contexto, vaga, preencherFn: gupy.preencher, inicio: true, pastaPrints: pasta,
        ctx: { ...ctx, aprendidas: Object.values(memoria.respostas || {}).map((a) => ({ pergunta: a.pergunta, resposta: String(a.valor) })) },
        log: ctx.log || (async () => {}),
      });
      if (r.resultado === 'ja_candidatado') r = { ...r, resultado: 'pulada', motivo: 'Você já se candidatou a esta vaga' };
      r.resolvidoPor = 'agente';
    }
    // travou: a janela fica aberta para você terminar (o Rota observa e aprende)
    if (aoTravar && ['erro', 'pulada'].includes(r.resultado) && !/já se candidatou|não está logado/i.test(r.motivo || '')) {
      r.observado = await aoTravar({ contexto: nav.contexto, pagina: nav.contexto.pages().at(-1) || nav.pagina, resultado: r }).catch(() => null);
    }
  } catch (e) {
    r = { resultado: 'erro', motivo: e.message.split('\n')[0], respostas: [] };
  } finally {
    await nav.fechar().catch(() => {});
  }
  return { ...r, pasta };
}

module.exports = { tipo: 'candidatura', candidatar, lerContagem, POR_DIA };
