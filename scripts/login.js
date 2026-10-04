// Cadastra os logins que o Rota usa nos sites de vagas. Tudo fica criptografado em dados/logins.cofre.
//   npm run login:salvar            (pergunta o site, o e-mail e a senha; a senha não aparece)
//   npm run login:listar
//   npm run login:remover infojobs.com.br
require('dotenv').config();
const readline = require('readline');
const logins = require('../src/util/logins');

function perguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((ok) => rl.question(texto, (r) => { rl.close(); ok(r.trim()); }));
}

// senha sem eco: mostra * no lugar de cada letra
function perguntarSenha(texto) {
  return new Promise((ok) => {
    process.stdout.write(texto);
    const entrada = process.stdin;
    entrada.setRawMode(true);
    entrada.resume();
    entrada.setEncoding('utf8');
    let senha = '';
    const tecla = (c) => {
      if (c === '\r' || c === '\n' || c === '\u0004') {
        entrada.setRawMode(false); entrada.pause(); entrada.removeListener('data', tecla);
        process.stdout.write('\n'); ok(senha);
      } else if (c === '\u0003') { process.stdout.write('\n'); process.exit(1); }
      else if (c === '\u007f' || c === '\b') { if (senha) { senha = senha.slice(0, -1); process.stdout.write('\b \b'); } }
      else { senha += c; process.stdout.write('*'.repeat(c.length)); }
    };
    entrada.on('data', tecla);
  });
}

async function main() {
  const [acao, alvo] = process.argv.slice(2);
  if (acao === 'listar') {
    const lista = logins.listar();
    console.log(lista.length ? `\n${lista.map((l) => `  ${l.dominio}  (${l.usuario})`).join('\n')}\n` : '\n  Nenhum login salvo.\n');
    return;
  }
  if (acao === 'remover') {
    console.log(logins.remover(alvo) ? `\n  Login de ${logins.dominioDe(alvo)} apagado.\n` : '\n  Esse site não tinha login salvo.\n');
    return;
  }
  console.log('\n=== Rota · salvar login de um site (fica criptografado; só o Rota usa) ===\n');
  console.log('  Exemplos de site: linkedin.com, infojobs.com.br, catho.com.br, vagas.com.br');
  console.log('  Para o LinkedIn use o site linkedin.com: o Rota usa quando a sessão dele expira no meio de um login.\n');
  const site = await perguntar('  Site: ');
  if (!site) return console.log('  Cancelado.\n');
  const usuario = await perguntar('  E-mail ou usuário: ');
  const senha = await perguntarSenha('  Senha: ');
  if (!usuario || !senha) return console.log('  Cancelado: faltou e-mail ou senha.\n');
  const dominio = logins.salvar(site, usuario, senha);
  console.log(`\n  Pronto: login de ${dominio} salvo e criptografado em dados/logins.cofre.\n`);
}

main().catch((e) => { console.error('\nErro:', e.message, '\n'); process.exit(1); });
