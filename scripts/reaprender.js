// Reprocessa todas as gravações do modo aprender (útil quando o aprendizado muda).
// npm run reaprender

const fs = require('fs');
const path = require('path');
const { aprender, carregar, PASTA } = require('../src/candidatura/aprendizado');

const arquivos = fs.existsSync(PASTA) ? fs.readdirSync(PASTA).filter((f) => /^gravacao-.*\.json$/.test(f)).sort() : [];
if (!arquivos.length) { console.log('\n  Nenhuma gravação encontrada em dados/aprendizado.\n'); process.exit(0); }
for (const f of arquivos) {
  const { eventos } = JSON.parse(fs.readFileSync(path.join(PASTA, f), 'utf8'));
  aprender(eventos || []);
}
const m = carregar();
console.log(`\n  ${arquivos.length} gravações relidas.`);
console.log(`  Botões: ${m.botoesCandidatar.length} de começar, ${m.botoesAvancar.length} de avançar, ${m.botoesFinal.length} de finalizar, ${m.botoesFechar.length} de fechar aviso`);
console.log(`  Respostas objetivas: ${Object.keys(m.respostas).length} · Textos (exemplos para a IA): ${(m.textos || []).length}`);
for (const t of m.textos || []) console.log(`     • ${t.pergunta.slice(0, 70)}`);
console.log();
