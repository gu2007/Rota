// Busca vagas no LinkedIn pela página pública de vagas (sem login): a sua conta não é usada.
// Cada termo de busca (Ajustes) vira algumas páginas de resultados; as vagas vão para o banco
// e a nota decide quem entra na fila. Depois, "testar:linkedin" descobre onde é a candidatura.

const fs = require('fs');
const path = require('path');
const { textoDe } = require('./links-vagas');

const BASE = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
const ARQUIVO = path.join(__dirname, '..', '..', 'dados', 'linkedin-busca.json');
const espera = (min, max) => new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));

// Um <li> por vaga: id, título, empresa, local e data
function lerResultados(html) {
  const vagas = [];
  for (const bloco of String(html || '').split(/<li[\s>]/).slice(1)) {
    const id = (bloco.match(/urn:li:jobPosting:(\d{6,})/) || bloco.match(/jobs\/view\/[^"?]*?-(\d{8,})/) || [])[1];
    const titulo = textoDe((bloco.match(/<h3[^>]*base-search-card__title[^>]*>([\s\S]*?)<\/h3>/) || [])[1]);
    if (!id || !titulo) continue;
    vagas.push({
      url: `https://www.linkedin.com/jobs/view/${id}`,
      titulo,
      empresa: textoDe((bloco.match(/<h4[^>]*base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/) || [])[1]) || null,
      local: textoDe((bloco.match(/job-search-card__location[^>]*>([\s\S]*?)<\/span>/) || [])[1]) || null,
      publicada: (bloco.match(/datetime="([\d-]+)"/) || [])[1] || null,
    });
  }
  return vagas;
}

// periodo: r86400 = 24h, r604800 = 7 dias
async function buscar({ termos, local = 'São Paulo', paginas = 2, periodo = 'r604800', fetchFn = fetch, log = () => {} }) {
  const porId = new Map();
  for (const termo of termos) {
    for (let p = 0; p < paginas; p++) {
      const url = `${BASE}?keywords=${encodeURIComponent(termo)}&location=${encodeURIComponent(local)}&f_TPR=${periodo}&start=${p * 10}`;
      let html = '';
      try {
        const resp = await fetchFn(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'Accept-Language': 'pt-BR,pt;q=0.9' } });
        if (resp.status === 429) { await log('aviso', 'linkedin', 'O LinkedIn pediu para ir mais devagar: parei a busca por agora.'); return [...porId.values()]; }
        if (!resp.ok) break;
        html = await resp.text();
      } catch { break; }
      const achadas = lerResultados(html);
      for (const v of achadas) if (!porId.has(v.url)) porId.set(v.url, { ...v, termo });
      if (achadas.length < 10) break; // acabou a lista desse termo
      await espera(1500, 3500);
    }
    await espera(1500, 3500);
  }
  return [...porId.values()];
}

// No máximo a cada 6 horas (a agenda chama várias vezes por dia)
function podeBuscar(horas = 6) {
  try { return Date.now() - JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')).em > horas * 3600 * 1000; } catch { return true; }
}
function anotarBusca(total) {
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify({ em: Date.now(), total }));
}

module.exports = { buscar, lerResultados, podeBuscar, anotarBusca };
