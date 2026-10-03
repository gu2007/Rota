// InfoJobs: busca pela página pública de vagas (sem login), no navegador do Rota.
// Cada termo de Ajustes vira uma busca; as vagas vão para o banco e a nota decide quem entra na fila.
// A candidatura no InfoJobs pede login: entre uma vez na janela do Rota ("npm run gupy:login").

const { pausa } = require('../navegador/navegador');
const { temDesafio } = require('../candidatura/leitor-pagina');

const BASE = 'https://www.infojobs.com.br/empregos.aspx';
const MESES = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };

// "Hoje", "Ontem", "há 3 horas", "29 set" -> dias desde a publicação
function diasDesde(texto, agora = new Date()) {
  const t = String(texto || '').toLowerCase().trim();
  if (/hoje|hora|minuto|agora/.test(t)) return 0;
  if (/ontem/.test(t)) return 1;
  const m = t.match(/^(\d{1,2}) (jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)/);
  if (!m) return null;
  let data = new Date(agora.getFullYear(), MESES[m[2]], Number(m[1]));
  if (data > agora) data = new Date(agora.getFullYear() - 1, MESES[m[2]], Number(m[1]));
  return Math.floor((agora - data) / 86400000);
}

// roda na página: um cartão por vaga (título, data, empresa, local, trecho da descrição)
function lerCartoes() {
  const vistos = new Set();
  return [...document.querySelectorAll('a[href*="/vaga-de-"]')]
    .filter((a) => /__\d+\.aspx/.test(a.href) && !vistos.has(a.href) && vistos.add(a.href))
    .map((a) => {
      let c = a;
      for (let i = 0; i < 8 && c.parentElement && !/js_rowCard|js_vacancyLoad/.test(String(c.className)); i++) c = c.parentElement;
      const linhas = (c.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean);
      const titulo = (a.innerText || '').trim() || linhas[0] || '';
      const i = linhas.indexOf(titulo);
      const resto = linhas.slice(i >= 0 ? i + 1 : 1);
      const data = resto[0] || '';
      const semNota = resto.slice(1).filter((l) => !/^\d+,\d$/.test(l)); // "4,5" é a nota da empresa
      const local = semNota.find((l) => / - [A-Z]{2}$/.test(l)) || null;
      const empresa = semNota[0] && semNota[0] !== local ? semNota[0] : null;
      const modelo = semNota.find((l) => /^(presencial|h[ií]brido|home office|remoto)$/i.test(l)) || null;
      return { url: a.href.split('?')[0], titulo, data, empresa, local, modelo, trecho: linhas.slice(-1)[0] || '' };
    });
}

async function buscar(pagina, { termos, maxDias = 2, log = async () => {} }) {
  const porUrl = new Map();
  for (const termo of termos) {
    const url = `${BASE}?palabra=${encodeURIComponent(termo)}&campo=griddate&orden=desc`;
    try {
      await pagina.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await pausa(2500, 4500);
      if (await pagina.evaluate(temDesafio).catch(() => null)) {
        await log('aviso', 'infojobs', 'O InfoJobs pediu verificação anti-robô: busca parada por agora.');
        break;
      }
      for (const c of await pagina.evaluate(lerCartoes).catch(() => [])) {
        const dias = diasDesde(c.data);
        if (dias != null && maxDias != null && dias > maxDias) continue;
        const modelo = /h[ií]brido/i.test(c.modelo || '') ? 'hibrido' : /remoto|home/i.test(c.modelo || '') ? 'remoto' : c.modelo ? 'presencial' : null;
        porUrl.set(c.url, {
          url: c.url, titulo: c.titulo, empresa: c.empresa, modelo,
          local: c.local ? c.local.replace(/ - ([A-Z]{2})$/, ', $1') : null,
          descricao: null, plataforma_envio: 'infojobs',
        });
      }
    } catch (e) {
      await log('erro', 'infojobs', `Busca "${termo}": ${e.message.split('\n')[0]}`);
    }
    await pausa(3000, 7000);
  }
  await log('info', 'infojobs', `InfoJobs: ${porUrl.size} vagas recentes para ${termos.length} termos.`);
  return [...porUrl.values()];
}

module.exports = { buscar, diasDesde, lerCartoes };
