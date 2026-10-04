// Faz o Rota (com o agente de IA) entrar na sua conta de uma plataforma de vagas.
// O Chrome do Rota guarda a sessão: depois disso, buscas e candidaturas já acontecem logadas.
//   npm run entrar catho
//   npm run entrar linkedin
//   npm run entrar infojobs
// No fim a janela fica aberta para você conferir. Feche a janela para terminar.
const fs = require('fs');
const path = require('path');
const { ambiente } = require('../src/config');
const { abrirNavegador, pausa } = require('../src/navegador/navegador');
const { aceitarCookies } = require('../src/navegador/cookies');
const { agir } = require('../src/agente/agente');
const gupy = require('../src/plataformas/gupy');
const logins = require('../src/util/logins');
const ia = require('../src/ia/gemini');

const semSenhaNaTela = async (p) => !(await p.locator('input[type=password]:visible').count().catch(() => 0));
const textoTem = async (p, re) => re.test((await p.innerText('body').catch(() => '')).slice(0, 20000));

// como saber que entrou em cada uma
const SITES = {
  catho: {
    nome: 'Catho', inicio: 'https://www.catho.com.br/area-candidato/', login: 'catho.com.br',
    logado: async (p) => /catho\.com\.br\/area-candidato/.test(p.url()) && await semSenhaNaTela(p) && await textoTem(p, /sair|meu curr[ií]culo|minhas candidaturas|meu perfil|ol[aá],/i),
  },
  linkedin: {
    nome: 'LinkedIn', inicio: 'https://www.linkedin.com/feed/', login: 'linkedin.com',
    logado: async (p) => /linkedin\.com\/(feed|in\/|mynetwork|jobs|notifications|messaging)/.test(p.url()) && await semSenhaNaTela(p),
  },
  infojobs: {
    nome: 'InfoJobs', inicio: 'https://www.infojobs.com.br/candidate/', login: 'infojobs.com.br',
    logado: async (p) => /^https:\/\/www\.infojobs\.com\.br\/(candidate|curriculo|candidato)/i.test(p.url()) && await semSenhaNaTela(p),
  },
};

async function main() {
  const chave = String(process.argv[2] || '').toLowerCase();
  const site = SITES[chave];
  if (!site) { console.log(`\n  Use: npm run entrar ${Object.keys(SITES).join(' | ')}\n`); return; }
  if (!ia.disponivel()) { console.log('\n  Precisa da GEMINI_API_KEY no .env.\n'); return; }
  const repo = require('../src/db').repo();
  await repo.iniciar(ambiente.banco);
  const perfil = await repo.perfil.obter();
  await repo.encerrar();

  console.log(`\n=== Rota · entrar no ${site.nome} ===\n`);
  const cred = logins.obter(site.login);
  console.log(`  Login salvo no cofre para ${site.login}: ${cred ? 'sim' : 'NÃO (o Rota só consegue pelo botão do LinkedIn, se o site tiver)'}`);
  if (chave === 'infojobs') console.log(`  Login salvo para linkedin.com (usado se o LinkedIn pedir a senha): ${logins.obter('linkedin.com') ? 'sim' : 'NÃO'}`);
  console.log('  O Chrome vai abrir. Não mexa nele até o fim.\n');

  const nav = await abrirNavegador();
  const pasta = path.join(__dirname, '..', 'dados', 'logins', `${chave}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  let r;
  try {
    await nav.pagina.goto(site.inicio, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await pausa(3000, 4500);
    await aceitarCookies(nav.pagina);
    if (await site.logado(nav.pagina)) {
      r = { resultado: 'logado', motivo: 'já estava logado', passos: 0 };
    } else {
      r = await agir({
        pagina: nav.pagina, contexto: nav.contexto, vaga: { titulo: `entrar no ${site.nome}` },
        ctx: { config: { modoTeste: true }, perfil, listas: {}, respostasFixas: [], pessoais: {} },
        preencherFn: gupy.preencher, loginSocialFn: gupy.fazerLogin, objetivo: 'login', logadoFn: site.logado, pastaPrints: pasta,
        log: async (n, o, m) => { if (o === 'agente') console.log(`  ${m}`); },
      });
    }
  } catch (e) {
    r = { resultado: 'erro', motivo: e.message.split('\n')[0] };
  }
  const pagina = nav.contexto.pages().at(-1) || nav.pagina;
  fs.mkdirSync(pasta, { recursive: true });
  await pagina.screenshot({ path: path.join(pasta, 'final.png') }).catch(() => {});
  console.log(`\n  Resultado: ${r.resultado === 'logado' ? `LOGADO no ${site.nome}` : `NÃO ENTROU — ${r.motivo}`}`);
  console.log(`  Página final: ${pagina.url().slice(0, 120)}`);
  console.log(`  Prints: ${pasta}`);
  console.log('\n  Confira na janela do Chrome. Se faltar algo (código por e-mail, CAPTCHA), faça você mesmo nela.');
  console.log('  Quando terminar, FECHE a janela do Chrome.\n');
  await new Promise((ok) => { nav.contexto.on('close', ok); setTimeout(ok, 15 * 60 * 1000); });
  await nav.fechar().catch(() => {});
}

main().catch((e) => { console.error('\nErro:', e.message, '\n'); process.exit(1); });
