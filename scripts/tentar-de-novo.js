// Devolve para a fila as vagas puladas ou com erro.
// Ficam de fora: já candidatadas, com teste online, "não quero responder" e nota baixa.
// npm run tentar:de-novo

const { ambiente, lerConfiguracoes } = require('../src/config');

const NAO_VOLTA = /j[aá] se candidatou|etapa de teste|preferiu n[aã]o responder|descartada por voc/i;

async function main() {
  const repo = ambiente.demo ? require('../src/db/demo') : require('../src/db/sql');
  await repo.iniciar(ambiente.banco);
  const config = lerConfiguracoes(await repo.config.obter());

  const todas = await repo.vagas.listar({ limite: 5000 });
  const alvo = todas.filter((v) => ['pulada', 'erro'].includes(v.status)
    && (v.nota ?? 0) >= config.notaMinima
    && !NAO_VOLTA.test(v.motivo_status || ''));

  for (const v of alvo) {
    await repo.vagas.atualizar(v.id, { status: 'na_fila', motivo_status: 'Voltou para a fila para tentar de novo' });
    console.log(`  + [${String(v.nota).padStart(3)}] ${v.titulo} — ${v.empresa || ''}\n        antes: ${String(v.motivo_status || v.status).slice(0, 110)}`);
  }
  const ficaram = todas.filter((v) => ['pulada', 'erro'].includes(v.status)).length - alvo.length;
  const fila = (await repo.vagas.listar({ status: 'na_fila', limite: 5000 })).length;
  console.log(`\n  ${alvo.length} vagas voltaram para a fila · ${ficaram} continuam de fora · fila agora: ${fila}\n`);
  await repo.encerrar();
}

main().catch((e) => { console.error('\nErro:', e.message, '\n'); process.exit(1); });
