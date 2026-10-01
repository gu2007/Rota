// Coleta pelo job board público da Gupy: JSON, sem login nem navegador.

const ENDPOINT = 'https://employability-portal.gupy.io/api/v1/jobs';
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
    local: job.isRemoteWork && !local ? 'Remoto' : local,
    modelo: MODELOS[job.workplaceType] || (job.isRemoteWork ? 'remoto' : null),
    descricao: semHtml(job.description).slice(0, 8000),
    plataforma_envio: 'gupy',
  };
}

async function buscar(termo, fetchFn) {
  const todos = [];
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const url = `${ENDPOINT}?jobName=${encodeURIComponent(termo)}&limit=${POR_PAGINA}&offset=${pagina * POR_PAGINA}`;
    const resp = await fetchFn(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) throw new Error(`Portal Gupy respondeu ${resp.status} para "${termo}"`);
    const corpo = await resp.json();
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

  for (const termo of termos) {
    const jobs = await buscar(termo, fetchFn);
    for (const job of jobs) {
      if (!job.jobUrl || !job.name || vistos.has(job.id)) continue;
      if (job.applicationDeadline && new Date(`${job.applicationDeadline}T23:59:59`) < agora) continue;
      vistos.set(job.id, converter(job));
    }
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 2500));
  }

  await ctx.log('info', 'gupy_portal', `Portal Gupy: ${vistos.size} vagas encontradas em ${termos.length} buscas.`);
  return [...vistos.values()];
}

// vaga da Gupy vinda por e-mail (só título): busca no portal pelo título e confere o id
async function completarPorId(jobId, titulo, { fetchFn = fetch } = {}) {
  if (!jobId || !titulo) return null;
  try {
    const url = `${ENDPOINT}?jobName=${encodeURIComponent(String(titulo).slice(0, 80))}&limit=${POR_PAGINA}&offset=0`;
    const resp = await fetchFn(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) return null;
    const corpo = await resp.json();
    const job = (Array.isArray(corpo.data) ? corpo.data : []).find((j) => String(j.id) === String(jobId));
    return job ? converter(job) : null;
  } catch { return null; }
}

module.exports = { tipo: 'coleta', coletar, converter, semHtml, completarPorId };
