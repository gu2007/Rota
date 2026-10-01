// Muda o estado de uma vaga na mão (ex.: você mesmo enviou a candidatura).
//   npm run marcar 207 candidatada
//   npm run marcar 207 descartada
const { ambiente } = require('../src/config');

const ESTADOS = ['na_fila', 'candidatada', 'descartada', 'pulada', 'testada', 'erro', 'aguardando', 'para_voce'];

async function main() {
  const [id, status] = process.argv.slice(2);
  if (!Number(id) || !ESTADOS.includes(status)) {
    console.log(`\n  Uso: npm run marcar <id da vaga> <${ESTADOS.join(' | ')}>\n`);
    process.exit(1);
  }
  const repo = require('../src/db').repo();
  await repo.iniciar(ambiente.banco);
  const vaga = await repo.vagas.obter(Number(id));
  if (!vaga) {
    console.log(`\n  Não achei a vaga #${id}.\n`);
    return repo.encerrar();
  }
  await repo.vagas.atualizar(vaga.id, { status, motivo_status: 'Marcada por você' });
  if (status === 'candidatada') {
    await repo.candidaturas.registrar({ vaga_id: vaga.id, plataforma: vaga.plataforma_envio || 'manual', resultado: 'enviada', modo_teste: false, motivo: 'Enviada por você', respostas: [] });
  }
  console.log(`\n  #${vaga.id} ${vaga.titulo} — ${vaga.empresa || ''}: ${vaga.status} → ${status}\n`);
  await repo.encerrar();
}

main().catch((e) => { console.error('\nErro:', e.message, '\n'); process.exit(1); });
