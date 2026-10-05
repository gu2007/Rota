// Coleta pelo job board público da Gupy: JSON, sem login nem navegador.

// A Gupy trocou o endereço (o antigo dá 404 desde out/2026). O novo é o que o portal.gupy.io usa;
// o antigo fica de reserva caso voltem atrás.
const ENDPOINTS = ['https://portal.gupy.io/api/job-search/jobs', 'https://employability-portal.gupy.io/api/v1/jobs'];
const CABECALHOS = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', Referer: 'https://portal.gupy.io/' };

// tenta os endereços na ordem; devolve o JSON do primeiro que responder
async function pedir(query, fetchFn) {
  let erro = null;
  for (const base of ENDPOINTS) {
    const resp = await fetchFn(`${base}?${query}`, { headers: CABECALHOS }).catch((e) => { erro = e.message; return null; });
    if (resp?.ok) return resp.json();
    if (resp) erro = `${resp.status}`;
  }
  throw new Error(`Portal Gupy não respondeu (${erro})`);
}
const POR_PAGINA = 30;
const MAX_PAGINAS = 3; // até 90 vagas por termo

const MODELOS = { 'on-site': 'presencial', hybrid: 'hibrido', remote: 'remoto' };

// a descrição vem em HTML; IA e pontuador só usam o texto
const semHtml = (html) => String(html || '')
  .replace(/<(br|\/p|\/li|\/h\d)\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

function converter(job) {
  const local = [job.city, job.state].filter(Boolean).join(', ') || null;
  return {
    url: job.jobUrl,
    titulo: job.name,
    empresa: job.careerPageName || null,
    local: (job.isRemoteWork || job.workplaceType === 'remote') && !local ? 'Remoto' : local,
    modelo: MODELOS[job.workplaceType] || (job.isRemoteWork ? 'remoto' : null),
    descricao: semHtml(job.description).slice(0, 8000),
    plataforma_envio: 'gupy',
  };
}

// filtros: "&type=vacancy_type_internship&state=São Paulo&city=São Paulo" (os mesmos do site)
async function buscar(termo, fetchFn, filtros = '') {
  const todos = [];
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const corpo = await pedir(`jobName=${encodeURIComponent(termo)}${filtros}&limit=${POR_PAGINA}&offset=${pagina * POR_PAGINA}`, fetchFn);
    const dados = Array.isArray(corpo.data) ? corpo.data : [];
    todos.push(...dados);
    if (dados.length < POR_PAGINA) break;
    await new Promise((r) => setTimeout(r, 800 + Math.random() * 1200));
  }
  return todos;
}

async function coletar(ctx, { fetchFn = fetch, agora = new Date() } = {}) {
  const termos = ctx.config.termosBusca.length ? ctx.config.termosBusca : ['estágio desenvolvedor'];
  const vistos = new Map();

  // o filtro de estágio é do próprio portal: o termo fica só com a área ("estágio desenvolvedor" -> "desenvolvedor")
  const soEstagio = !ctx.config.aceitaJunior;
  const area = [...new Set(termos.map((t) => String(t).replace(/est[aá]gio|estagi[aá]ri[oa]/gi, '').trim()).filter(Boolean))];
  const busca = soEstagio && area.length ? area : termos;
  const cidade = String(ctx.config.localizacao || 'São Paulo').split(';')[0].split(',')[0].trim();
  const tipo = soEstagio ? '&type=vacancy_type_internship' : '';
  const naCidade = `${tipo}&state=${encodeURIComponent(cidade === 'São Paulo' ? 'São Paulo' : '')}&city=${encodeURIComponent(cidade)}`;
  for (const termo of busca) {
    // 1) na sua cidade; 2) remotas de qualquer lugar
    const jobs = [...await buscar(termo, fetchFn, naCidade), ...(await buscar(termo, fetchFn, tipo).catch(() => [])).filter((j) => j.workplaceType === 'remote')];
    for (const job of jobs) {
      if (!job.jobUrl || !job.name || vistos.has(job.id) || /inactive|&/.test(String(job.jobUrl).split('/')[2] || '')) continue;
      if (job.applicationDeadline && new Date(`${String(job.applicationDeadline).slice(0, 10)}T23:59:59`) < agora) continue;
      vistos.set(job.id, converter(job));
    }
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 2500));
  }

  await ctx.log('info', 'gupy_portal', `Portal Gupy: ${vistos.size} vagas de ${soEstagio ? 'estágio ' : ''}em ${cidade} ou remotas, em ${busca.length} buscas.`);
  return [...vistos.values()];
}

// vaga da Gupy vinda por e-mail (só título): busca no portal pelo título e confere o id
async function completarPorId(jobId, titulo, { fetchFn = fetch } = {}) {
  if (!jobId || !titulo) return null;
  try {
    const corpo = await pedir(`jobName=${encodeURIComponent(String(titulo).slice(0, 80))}&limit=${POR_PAGINA}&offset=0`, fetchFn);
    const job = (Array.isArray(corpo.data) ? corpo.data : []).find((j) => String(j.id) === String(jobId));
    return job ? converter(job) : null;
  } catch { return null; }
}

module.exports = { tipo: 'coleta', coletar, converter, semHtml, completarPorId };
