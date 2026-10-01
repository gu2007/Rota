// Testa a chave e o modelo do Gemini.
// npm run testar:ia

require('../src/config');
const ia = require('../src/ia/gemini');

(async () => {
  const chave = process.env.GEMINI_API_KEY || '';
  console.log(`\n  Modelo: ${process.env.GEMINI_MODELO || 'gemini-3.8-flash'}`);
  if (!chave) return console.log('  GEMINI_API_KEY está vazia no .env.\n');
  // nunca mostra a chave inteira
  console.log(`  Chave: ${chave.slice(0, 4)}…${chave.slice(-3)} (${chave.length} caracteres)${/\s|"|'/.test(chave) ? '  ← tem espaço ou aspas!' : ''}`);
  try {
    const r = await ia.responder({
      pergunta: 'Qual é o seu curso?',
      contexto: { perfil: { nome: 'Teste' }, listas: { formacoes: [{ curso: 'Sistemas de Informação', instituicao: 'Faculdade' }] }, respostasFixas: [] },
      vaga: { titulo: 'Teste', empresa: 'Teste', descricao: '' },
      limite: 100,
    });
    console.log(`  Resposta da IA: ${r}\n\n  ✓ Gemini funcionando.\n`);
  } catch (e) {
    console.log(`  ✗ ${e.message}\n`);
    process.exit(1);
  }
})();
