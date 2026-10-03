// Logins dos sites de vagas (InfoJobs, Catho, sites de empresas...). Ficam criptografados em
// dados/logins.cofre com a ROTA_CHAVE do .env: só o Rota abre. Nunca vão para o GitHub nem para o painel.
//   npm run login:salvar     -> cadastra (a senha não aparece na tela)
//   npm run login:listar     -> mostra os sites (sem senha)
//   npm run login:remover <site>

const fs = require('fs');
const path = require('path');
const { cifrar, decifrar, mascarar } = require('./cofre');

const ARQUIVO = path.join(__dirname, '..', '..', 'dados', 'logins.cofre');

function ler() {
  try { return JSON.parse(decifrar(fs.readFileSync(ARQUIVO, 'utf8').trim())); } catch { return {}; }
}
function gravar(todos) {
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  fs.writeFileSync(ARQUIVO, cifrar(JSON.stringify(todos)));
}

// "https://login.infojobs.com.br/..." -> "infojobs.com.br"
function dominioDe(texto) {
  let host = String(texto || '').trim().toLowerCase();
  try { host = new URL(/^https?:/.test(host) ? host : `https://${host}`).hostname; } catch { /* já é domínio */ }
  return host.replace(/^www\./, '');
}

// login do site da página (vale para subdomínios: login.infojobs.com.br usa o de infojobs.com.br)
function obter(urlOuHost) {
  const host = dominioDe(urlOuHost);
  const todos = ler();
  const dominio = Object.keys(todos).sort((a, b) => b.length - a.length).find((d) => host === d || host.endsWith(`.${d}`));
  return dominio ? { dominio, ...todos[dominio] } : null;
}

function salvar(site, usuario, senha) {
  const todos = ler();
  const dominio = dominioDe(site);
  todos[dominio] = { usuario: String(usuario).trim(), senha: String(senha) };
  gravar(todos);
  return dominio;
}

function remover(site) {
  const todos = ler();
  const dominio = dominioDe(site);
  const tinha = !!todos[dominio];
  delete todos[dominio];
  gravar(todos);
  return tinha;
}

const listar = () => Object.entries(ler()).map(([dominio, c]) => ({ dominio, usuario: mascarar(c.usuario) }));

module.exports = { obter, salvar, remover, listar, dominioDe };
