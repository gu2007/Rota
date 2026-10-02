// Cadastra experiências e formações de um arquivo, sem duplicar (atualiza o que já existe).
//   npm run perfil:importar            -> lê dados/perfil-importar.json
// O arquivo fica em dados/ (não vai para o GitHub).
const fs = require('fs');
const path = require('path');
const { ambiente } = require('../src/config');

const ARQUIVO = path.join(__dirname, '..', 'dados', 'perfil-importar.json');
const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
// mesmo item = mesma empresa/instituição (uma contém a outra)
const chaves = { experiencias: 'empresa', formacoes: 'instituicao' };
const mesmo = (a, b) => a && b && (a.includes(b) || b.includes(a));

async function main() {
  if (!fs.existsSync(ARQUIVO)) throw new Error(`Não achei ${ARQUIVO}`);
  const dados = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
  const repo = require('../src/db').repo();
  await repo.iniciar(ambiente.banco);
  for (const [lista, campo] of Object.entries(chaves)) {
    const atuais = await repo.listas.listar(lista);
    for (const item of dados[lista] || []) {
      const existente = atuais.find((a) => mesmo(norm(a[campo]), norm(item[campo])));
      if (existente) {
        await repo.listas.atualizar(lista, existente.id, item);
        console.log(`  atualizado  ${lista}: ${item.cargo || item.curso} — ${item[campo]}`);
      } else {
        await repo.listas.criar(lista, item);
        console.log(`  novo        ${lista}: ${item.cargo || item.curso} — ${item[campo]}`);
      }
    }
    const sobra = (await repo.listas.listar(lista)).filter((a) => !(dados[lista] || []).some((i) => mesmo(norm(a[campo]), norm(i[campo]))));
    for (const s of sobra) console.log(`  (já existia, não mexi) ${lista}: ${s.cargo || s.curso} — ${s[campo] || ''}`);
  }
  await repo.encerrar();
  console.log('\n  Pronto. Confira em Perfil > Formação e Experiências.\n');
}

main().catch((e) => { console.error('\nErro:', e.message, '\n'); process.exit(1); });
