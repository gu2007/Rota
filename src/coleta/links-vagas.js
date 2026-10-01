// Extrai links de vagas do HTML de e-mails de alerta (LinkedIn, Gupy, InfoJobs, Indeed...).
// Links de rastreamento escondem o destino e são resolvidos à parte (resolverRedirecionamento).

const entidades = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" };
const decodificar = (t) => String(t || '')
  .replace(/&(nbsp|amp|lt|gt|quot|#39|#x27);/g, (m) => entidades[m] || m)
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

const textoDe = (html) => decodificar(String(html || '')
  .replace(/<img[^>]*alt=["']([^"']*)["'][^>]*>/gi, ' $1 ')
  .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// Texto de link que NÃO é título de vaga
const GENERICO = /^(ver (a )?vaga|ver mais|ver todas|candidat|aplicar|apply|saiba mais|clique aqui|acessar|view job|see (all|more)|mais vagas|visualizar|confira|inscreva|descadastr|unsubscribe|gerenciar|configura|ajuda|help|linkedin|gupy|infojobs|indeed|\d+ (novas? )?vagas?)/i;

// canon: endereço limpo e único da vaga
const PADROES = [
  {
    nome: 'linkedin',
    re: /linkedin\.com\/(?:comm\/)?jobs\/view\/(?:[^/?#"]*?-)?(\d{7,})/i,
    canon: (m) => `https://www.linkedin.com/jobs/view/${m[1]}`,
  },
  {
    // /jobs/123 (e-mails) e /job/<base64> (portal) viram o formato do portal, para não duplicar
    nome: 'gupy',
    re: /https?:\/\/([a-z0-9-]+)\.gupy\.io\/jobs?\/([A-Za-z0-9=_%-]+)/i,
    canon: (m) => gupyCanonica(m[1], m[2]),
  },
  { nome: 'infojobs', re: /https?:\/\/(?:www\.)?infojobs\.com\.br\/vaga-[^"'\s?#]+?\.aspx/i, canon: (m) => m[0] },
  { nome: 'indeed', re: /indeed\.com[^"'\s]*?[?&]jk=([a-f0-9]{10,})/i, canon: (m) => `https://br.indeed.com/viewjob?jk=${m[1]}` },
  { nome: 'catho', re: /https?:\/\/(?:www\.)?catho\.com\.br\/vagas\/[^"'\s?#]+\/\d+/i, canon: (m) => m[0] },
  { nome: 'vagas', re: /https?:\/\/(?:www\.)?vagas\.com\.br\/vagas\/v\d+[^"'\s?#]*/i, canon: (m) => m[0] },
  { nome: 'glassdoor', re: /https?:\/\/(?:www\.)?glassdoor\.com(?:\.br)?\/(?:job-listing|Vaga)\/[^"'\s?#]+/i, canon: (m) => m[0] },
];

// /jobs/12574730 -> /job/<base64 de {"jobId":12574730,"source":"gupy_portal"}>
function gupyCanonica(sub, id) {
  let jobId = /^\d+$/.test(id) ? id : null;
  if (!jobId) {
    try { jobId = String(JSON.parse(Buffer.from(decodeURIComponent(id), 'base64').toString('utf8')).jobId || ''); } catch { /* não era base64 */ }
  }
  if (!jobId) return `https://${sub.toLowerCase()}.gupy.io/job/${id}`;
  const b64 = Buffer.from(JSON.stringify({ jobId: Number(jobId), source: 'gupy_portal' })).toString('base64');
  return `https://${sub.toLowerCase()}.gupy.io/job/${b64}`;
}

// Rastreamento de e-mail marketing: só seguindo o redirecionamento se sabe o destino
const RASTREIO = /sendgrid\.net|mandrillapp|list-manage|mailchi\.mp|\/ls\/click|click\.|links\.|email\.|trk\.|track\.|r\.[a-z]+\.com|awstrack|hubspotlinks|rdstation|lnkd\.in/i;

function classificar(url) {
  const alvo = decodificar(url);
  // Links do LinkedIn às vezes vêm dentro de ?url= de um redirecionamento
  let texto = alvo;
  try { texto = decodeURIComponent(alvo); } catch { /* segue como está */ }
  for (const p of PADROES) {
    const m = texto.match(p.re);
    if (m) return { tipo: p.nome, url: p.canon(m) };
  }
  return null;
}

function extrairLinks(html) {
  const porUrl = new Map();
  const rastreios = new Set();
  const re = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const href = decodificar(m[1]).trim();
    const texto = textoDe(m[2]);
    const achado = classificar(href);
    if (!achado) {
      if (/^https?:/i.test(href) && RASTREIO.test(href) && texto && !GENERICO.test(texto) && texto.length >= 6) rastreios.add(href);
      continue;
    }
    const item = porUrl.get(achado.url) || { url: achado.url, tipo: achado.tipo, textos: [] };
    if (texto && !item.textos.includes(texto)) item.textos.push(texto);
    porUrl.set(achado.url, item);
  }
  const vagas = [...porUrl.values()].map((v) => ({ ...v, titulo: escolherTitulo(v.textos) }));
  return { vagas, rastreios: [...rastreios] };
}

// Texto de link com mais cara de título: nem genérico, nem enorme
function escolherTitulo(textos) {
  const bons = textos.filter((t) => t.length >= 4 && t.length <= 150 && !GENERICO.test(t));
  bons.sort((a, b) => b.length - a.length);
  return bons.find((t) => t.length <= 110) || bons[0] || null;
}

// Segue redirecionamentos sem baixar a página
async function resolverRedirecionamento(url, { fetchFn = fetch, saltos = 6 } = {}) {
  let atual = url;
  for (let i = 0; i < saltos; i++) {
    const achado = classificar(atual);
    if (achado) return achado;
    let resp;
    try { resp = await fetchFn(atual, { method: 'GET', redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0' } }); } catch { return null; }
    const destino = resp.headers.get('location');
    if (!destino) return null;
    atual = new URL(destino, atual).toString();
  }
  return classificar(atual);
}

module.exports = { extrairLinks, classificar, resolverRedirecionamento, gupyCanonica, textoDe, escolherTitulo };
