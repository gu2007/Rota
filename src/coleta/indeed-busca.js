// Indeed: busca pela página pública de vagas, no navegador do Rota (sem login).
// Se o Indeed pedir verificação anti-robô, a busca para (o Rota nunca resolve CAPTCHA).
// Depois, plataformas/indeed.js abre cada vaga para descobrir onde é a candidatura.

const { pausa } = require('../navegador/navegador');
const { temDesafio } = require('../candidatura/leitor-pagina');

const BASE = 'https://br.indeed.com/jobs';

// roda na página
function lerCartoes() {
  const vistos = new Set();
  return [...document.querySelectorAll('a[data-jk]')]
    // cartão escondido (isca para robô) fica de fora
    .filter((a) => a.dataset.jk && a.getBoundingClientRect().width > 0 && !vistos.has(a.dataset.jk) && vistos.add(a.dataset.jk))
    .map((a) => {
      const c = a.closest('.job_seen_beacon, .cardOutline, li') || a.parentElement;
      const txt = (sel) => (c?.querySelector(sel)?.innerText || '').trim();
      return {
        jk: a.dataset.jk,
        titulo: (a.innerText || a.getAttribute('aria-label') || '').trim(),
        empresa: txt('[data-testid=company-name]') || null,
        local: txt('[data-testid=text-location]') || null,
        trecho: txt('[data-testid=jobsnippet_footer], .job-snippet, ul') || '',
      };
    });
}

async function buscar(pagina, { termos, local = 'São Paulo, SP', maxDias = 2, log = async () => {} }) {
  const porJk = new Map();
  for (const termo of termos) {
    const url = `${BASE}?q=${encodeURIComponent(termo)}&l=${encodeURIComponent(local)}&fromage=${Math.max(1, maxDias || 3)}&sort=date`;
    try {
      await pagina.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await pausa(3000, 5000);
      const desafio = await pagina.evaluate(temDesafio).catch(() => null) || /just a moment|um momento|verifica/i.test(await pagina.title().catch(() => ''));
      if (desafio) {
        await log('aviso', 'indeed', 'O Indeed pediu verificação anti-robô: busca parada por agora.');
        break;
      }
      for (const c of await pagina.evaluate(lerCartoes).catch(() => [])) {
        if (!c.titulo) continue;
        porJk.set(c.jk, {
          url: `https://br.indeed.com/viewjob?jk=${c.jk}`, titulo: c.titulo, empresa: c.empresa, local: c.local,
          modelo: /remot|home office/i.test(`${c.titulo} ${c.local}`) ? 'remoto' : /h[ií]brid/i.test(`${c.titulo} ${c.local}`) ? 'hibrido' : null,
          descricao: null, plataforma_envio: 'indeed',
        });
      }
    } catch (e) {
      await log('erro', 'indeed', `Busca "${termo}": ${e.message.split('\n')[0]}`);
    }
    await pausa(4000, 9000);
  }
  await log('info', 'indeed', `Indeed: ${porJk.size} vagas recentes para ${termos.length} termos.`);
  return [...porJk.values()];
}

module.exports = { buscar, lerCartoes };
