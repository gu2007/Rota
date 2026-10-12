// Define (ou troca) a senha do painel do Rota. Só o "hash" vai para o .env: a senha não fica salva.
//   npm run painel:senha
// Depois reinicie o Rota (no servidor: pm2 restart rota-painel).
const fs = require('fs');
const path = require('path');
const { gerarHash } = require('../src/painel/acesso');

function perguntarSenha(texto) {
  return new Promise((ok) => {
    process.stdout.write(texto);
    const entrada = process.stdin;
    entrada.setRawMode(true); entrada.resume(); entrada.setEncoding('utf8');
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
  console.log('\n=== Rota · senha do painel ===\n  Use pelo menos 10 caracteres. Ela não aparece enquanto você digita.\n');
  const a = await perguntarSenha('  Nova senha: ');
  if (a.length < 10) return console.log('\n  Muito curta: use pelo menos 10 caracteres.\n');
  const b = await perguntarSenha('  Repita a senha: ');
  if (a !== b) return console.log('\n  As duas senhas não são iguais. Nada foi mudado.\n');
  const arquivo = path.join(__dirname, '..', '.env');
  const linhas = fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8').split(/\r?\n/).filter((l) => !/^PAINEL_SENHA_HASH=/.test(l)) : [];
  while (linhas.length && !linhas[linhas.length - 1].trim()) linhas.pop();
  linhas.push(`PAINEL_SENHA_HASH=${gerarHash(a)}`);
  fs.writeFileSync(arquivo, `${linhas.join('\n')}\n`, { mode: 0o600 });
  console.log('\n  Pronto: senha do painel definida. Reinicie o Rota para valer.\n');
}

main().catch((e) => { console.error('\nErro:', e.message, '\n'); process.exit(1); });
