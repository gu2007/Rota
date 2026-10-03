// Vagas achadas na internet pela IA (Pesquisa Google do Gemini).
// A IA pode errar o link: cada um é aberto e só fica se a página existir e falar de vaga.
// A área (TI) é conferida de novo antes da candidatura.

const ia = require('../ia/gemini');
const { normalizarUrl } = require('../util/url');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const LISTA = /\/(search|busca|vagas\/?$|jobs\/?$|empregos\.aspx)|[?&](q|keywords|palabra)=/i;

async function conferirLink(url, fetchFn) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    const resp = await fetchFn(url, { redirect: 'follow', signal: ctl.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' } });
    clearTimeout(t);
    if (!resp.ok) return null;
    const html = (await resp.text()).slice(0, 300000);
    if (!/vaga|est[aá]gio|estagi[aá]ri|intern|job|candidat|apply/i.test(html)) return null;
    if (/vaga (encerrada|expirada|n[aã]o est[aá] mais)|no longer (available|accepting)|job (has )?expired/i.test(html)) return null;
    return resp.url || url;
  } catch { return null; }
}

async function buscar({ config, log = async () => {}, fetchFn = fetch, iaFn = ia.buscarVagasNaWeb }) {
  if (!ia.disponivel()) { await log('aviso', 'web', 'Busca na web precisa da IA (GEMINI_API_KEY).'); return []; }
  const termos = config.termosBusca.length ? config.termosBusca : ['estágio desenvolvedor'];
  const local = String(config.localizacao || 'São Paulo').split(';')[0].trim() || 'São Paulo';
  const achadas = [];
  // poucas buscas por vez: cada uma é uma pesquisa no Google feita pela IA
  for (let i = 0; i < termos.length; i += 3) {
    const r = await iaFn({ termos: termos.slice(i, i + 3), local, dias: Math.max(2, config.maxDias || 3) }, { fetchFn }).catch(async (e) => { await log('aviso', 'web', e.message); return []; });
    achadas.push(...r);
  }
  const porUrl = new Map();
  for (const v of achadas) {
    if (LISTA.test(v.url)) continue;
    const final = await conferirLink(v.url, fetchFn);
    if (!final || LISTA.test(final)) continue;
    const url = normalizarUrl(final);
    if (url && !porUrl.has(url)) porUrl.set(url, { ...v, url, descricao: null });
  }
  await log('info', 'web', `Internet: a IA achou ${achadas.length} links; ${porUrl.size} são vagas abertas de verdade.`);
  return [...porUrl.values()];
}

module.exports = { buscar, conferirLink };
