// Salva tudo no GitHub de uma vez: git add, commit e push.
//   npm run salvar                      -> mensagem automática com data e hora
//   npm run salvar "o que mudou"        -> mensagem sua
const { execFileSync } = require('child_process');

const git = (...args) => execFileSync('git', args, { stdio: 'inherit' });
const saida = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

try {
  if (!saida('status', '--porcelain')) {
    console.log('\n  Nada para salvar: tudo já está no GitHub.\n');
    process.exit(0);
  }
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const mensagem = process.argv.slice(2).join(' ').trim() || `Atualização ${agora}`;
  git('-c', 'core.safecrlf=false', 'add', '-A');
  git('commit', '-q', '-m', mensagem);
  git('push', '-q');
  console.log(`\n  Salvo no GitHub: "${mensagem}"\n`);
} catch (e) {
  console.error('\n  Não deu para salvar. Veja a mensagem do git acima.\n');
  process.exit(1);
}
