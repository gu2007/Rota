// Catho: busca pela página de vagas (no navegador do Rota, já logado com "npm run entrar catho").
// Endereço da busca: /vagas/<termo>/<cidade>-sp/ ; cada vaga é um <article> com data, título, empresa e cidade.
const { pausa } = require('../navegador/navegador');
const { temDesafio } = require('../candidatura/leitor-pagina');
const { aceitarCookies } = require('../navegador/cookies');
const { tituloDeTI } = require('../ia/pontuador');

const semAcento = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const slug = (t) => semAcento(t).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const urlBusca = (termo, cidade) => `https://www.catho.com.br/vagas/${slug(termo)}/${slug(cidade)}-sp/`;

// "Publicada em 04/09" / "Publicada hoje" / "Publicada ontem" -> dias
function diasDesde(texto, agora = new Date()) {
  const t = semAcento(texto);
  if (/hoje|hora|minuto/.test(t)) return 0;
  if (/ontem/.test(t)) return 1;
  const m = t.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!m) return null;
  let ano = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : agora.getFullYear();
  let data = new Date(ano, Number(m[2]) - 1, Number(m[1]));
  if (!m[3] && data > agora) data = new Date(ano - 1, Number(m[2]) - 1, Number(m[1]));
  return Math.floor((agora - data) / 86400000);
}

// roda na página
function lerCartoes() {
  const vistos = new Set();
  return [...document.querySelectorAll('a[href]')]
    .filter((a) => /catho\.com\.br\/vagas\/[^/]+\/\d+/.test(a.href) && !vistos.has(a.href.split('?')[0]) && vistos.add(a.href.split('?')[0]))
    .map((a) => {
      const card = a.closest('article, li') || a.parentElement;
      const linhas = (card?.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean);
      const local = (linhas.find((l) => /^\d+ vagas? - /.test(l)) || '').replace(/^\d+ vagas? - /, '') || null;
      const titulo = (a.innerText || '').trim();
      const i = linhas.indexOf(titulo);
      const empresa = i >= 0 && linhas[i + 1] && !/^\d+ vagas?/.test(linhas[i + 1]) ? linhas[i + 1].replace(/\s*Por que\?$/, '') : null;
      return { url: a.href.split('?')[0], titulo, empresa, local, data: linhas.find((l) => /^publicada/i.test(l)) || '' };
    });
}

async function buscar(pagina, { termos, maxDias = 2, cidade = 'São Paulo', log = async () => {} }) {
  const porUrl = new Map();
  for (const termo of termos) {
    try {
      // filtro "Data de publicação" da Catho: 1 = dois dias, 2 = três dias, 7 = semana, 15 = quinze dias
      const lastdays = maxDias <= 2 ? 1 : maxDias <= 3 ? 2 : maxDias <= 7 ? 7 : 15;
      await pagina.goto(`${urlBusca(termo, cidade)}?lastdays=${lastdays}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await pausa(2500, 4500);
      await aceitarCookies(pagina);
      if (await pagina.evaluate(temDesafio).catch(() => null)) { await log('aviso', 'catho', 'A Catho pediu verificação anti-robô: busca parada por agora.'); break; }
      for (const c of await pagina.evaluate(lerCartoes).catch(() => [])) {
        // quando acha pouca coisa, a Catho completa a lista com vagas de qualquer área: só fica título de TI
        if (!c.titulo || !tituloDeTI(c.titulo)) continue;
        const dias = diasDesde(c.data);
        if (dias != null && maxDias != null && dias > maxDias) continue;
        const remoto = /home office|remot|work from home/i.test(`${c.titulo} ${c.local}`);
        // outra cidade só serve se for remota
        if (!remoto && c.local && semAcento(c.local) !== semAcento(cidade)) continue;
        porUrl.set(c.url, {
          url: c.url, titulo: c.titulo, empresa: c.empresa, local: c.local ? `${c.local}, SP` : null,
          modelo: remoto ? 'remoto' : null, descricao: null, plataforma_envio: 'sites',
        });
      }
    } catch (e) {
      await log('erro', 'catho', `Busca "${termo}": ${e.message.split('\n')[0]}`);
    }
    await pausa(3000, 7000);
  }
  await log('info', 'catho', `Catho: ${porUrl.size} vagas recentes em ${cidade} para ${termos.length} termos.`);
  return [...porUrl.values()];
}

module.exports = { buscar, diasDesde, lerCartoes, urlBusca };
