// Entra nas plataformas de vagas ANTES de buscar e se candidatar (pedido do Gustavo).
// O Chrome do Rota guarda a sessão: entrando uma vez, as buscas e candidaturas já acontecem logadas.
// Ordem: botão do LinkedIn (se houver); senão o login salvo (npm run login:salvar).

const { abrirNavegador, pausa } = require('./navegador');
const { aceitarCookies } = require('./cookies');
const { entrarComSenha } = require('./login');
const logins = require('../util/logins');

// área do candidato: logado abre direto; sem login, cai na tela de login
const SITES = [
  { nome: 'InfoJobs', url: 'https://www.infojobs.com.br/candidate/' },
  { nome: 'Catho', url: 'https://www.catho.com.br/area-candidato/' },
];

const temBotaoLinkedin = (pagina) => pagina.evaluate(() => [...document.querySelectorAll('button, a, [role=button]')]
  .some((e) => e.getBoundingClientRect().width > 0 && /^(entrar com |continuar com |sign in with |login com )?linkedin$/i.test((e.innerText || e.getAttribute('aria-label') || '').trim()))).catch(() => false);

async function garantirLogins({ log = async () => {}, abrir = abrirNavegador } = {}) {
  // require aqui dentro: gupy.js também usa este módulo indiretamente
  const { fazerLogin, naTelaDeLogin } = require('../plataformas/gupy');
  const nav = await abrir();
  const resultado = {};
  try {
    for (const site of SITES) {
      try {
        await nav.pagina.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await pausa(2500, 4000);
        await aceitarCookies(nav.pagina);
        if (!(await naTelaDeLogin(nav.pagina))) { resultado[site.nome] = 'já logado'; continue; }
        let r;
        if (await temBotaoLinkedin(nav.pagina)) {
          await log('info', 'login', `${site.nome}: entrando pelo LinkedIn...`);
          r = await fazerLogin(nav.pagina);
        } else {
          const cred = logins.obter(nav.pagina.url()) || logins.obter(site.url);
          if (!cred) { resultado[site.nome] = 'sem login salvo e sem botão do LinkedIn'; continue; }
          await log('info', 'login', `${site.nome}: entrando com o login salvo...`);
          r = await entrarComSenha(nav.pagina, cred);
        }
        // confere de novo na área do candidato
        await nav.pagina.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
        await pausa(2000, 3000);
        resultado[site.nome] = r.ok && !(await naTelaDeLogin(nav.pagina)) ? 'logado agora' : `não entrou: ${r.motivo || 'continuou na tela de login'}`;
      } catch (e) {
        resultado[site.nome] = `erro: ${e.message.split('\n')[0].slice(0, 120)}`;
      }
    }
  } finally {
    await nav.fechar().catch(() => {});
  }
  for (const [nome, st] of Object.entries(resultado)) await log(/não entrou|erro|sem login/.test(st) ? 'aviso' : 'info', 'login', `${nome}: ${st}`);
  return resultado;
}

module.exports = { garantirLogins, SITES };
