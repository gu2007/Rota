// Leva o login da Gupy/LinkedIn do PC para o servidor.
// O Chrome do Windows protege os cookies com a conta do Windows, então copiar a pasta
// do perfil não funciona: aqui os cookies saem cifrados com a ROTA_CHAVE.
//   No PC:       npm run sessao:exportar   -> gera dados/sessao-completa.cofre
//   No servidor: npm run sessao:importar   (com o mesmo .env / ROTA_CHAVE)
require('../src/config');
const fs = require('fs');
const path = require('path');
const cofre = require('../src/util/cofre');
const { abrirNavegador } = require('../src/navegador/navegador');

const ARQUIVO = path.join(__dirname, '..', 'dados', 'sessao-completa.cofre');
const DOMINIOS = /gupy\.io|gupy\.com\.br|linkedin\.com|google\.com|smartrecruiters\.com|factorialhr/;

async function exportar() {
  const nav = await abrirNavegador({ headless: true });
  const cookies = (await nav.contexto.cookies()).filter((c) => DOMINIOS.test(c.domain));
  await nav.fechar();
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  fs.writeFileSync(ARQUIVO, cofre.cifrar(JSON.stringify(cookies)));
  const sites = [...new Set(cookies.map((c) => c.domain.replace(/^\./, '').split('.').slice(-2).join('.')))];
  console.log(`\n  ${cookies.length} cookies exportados (${sites.join(', ')}).`);
  console.log(`  Arquivo: ${ARQUIVO}`);
  console.log('  Ele está cifrado com a sua ROTA_CHAVE: só abre com o mesmo .env.\n');
}

async function importar() {
  if (!fs.existsSync(ARQUIVO)) throw new Error(`Não achei ${ARQUIVO}. Copie o arquivo do PC para cá antes.`);
  const cookies = JSON.parse(cofre.decifrar(fs.readFileSync(ARQUIVO, 'utf8')));
  const nav = await abrirNavegador({ headless: true });
  await nav.contexto.addCookies(cookies);
  // confere se o LinkedIn reconhece o login (a Gupy entra pelo LinkedIn)
  const abriu = await nav.pagina.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 45000 }).then(() => true).catch(() => false);
  const url = nav.pagina.url();
  await nav.fechar();
  console.log(`\n  ${cookies.length} cookies importados.`);
  if (!abriu || !/linkedin\.com/.test(url)) console.log('  LinkedIn: não deu para conferir (sem acesso ao site agora).');
  else console.log(`  LinkedIn: ${/login|signin|authwall|checkpoint/i.test(url) ? 'pediu login de novo (o LinkedIn pode desconfiar do IP novo)' : 'logado'}`);
  fs.rmSync(ARQUIVO); // não deixa a cópia parada no servidor
  console.log('  O arquivo de transferência foi apagado.\n');
}

const acao = process.argv[2];
(acao === 'exportar' ? exportar() : acao === 'importar' ? importar() : Promise.reject(new Error('Use: exportar ou importar')))
  .then(() => process.exit(0))
  .catch((e) => { console.error('\nErro:', e.message, '\n'); process.exit(1); });
