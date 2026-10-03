// Recalcula a nota das vagas ainda não tentadas. Descartes manuais são mantidos.
// npm run repontuar

const { ambiente, lerConfiguracoes } = require('../src/config');
const { pontuar, limparTitulo } = require('../src/ia/pontuador');
const { conferirArea, CONFIRMADA } = require('../src/ia/conferir-area');

async function main() {
  const repo = require('../src/db').repo();
  await repo.iniciar(ambiente.banco);
  const config = lerConfiguracoes(await repo.config.obter());

  const todas = await repo.vagas.listar({ limite: 5000 });

  // A versão antiga marcava "Candidatura simplificada" por engano (confundia com a lista
  // de outras vagas); essas voltam para a fila para conferir o botão
  for (const v of todas.filter((x) => ['pulada', 'para_voce'].includes(x.status) && /^Candidatura simplificada/.test(x.motivo_status || ''))) {
    await repo.vagas.atualizar(v.id, { status: 'na_fila', plataforma_envio: 'linkedin', motivo_status: 'Conferir de novo o botão de candidatura', titulo: limparTitulo(v.titulo) });
    v.status = 'na_fila';
    console.log(`  ↺ conferir de novo  ${limparTitulo(v.titulo)}`);
  }
  // descartes que não dependem da nota ficam como estão (repetida, encerrada, descartada por você)
  const DESCARTE_FIXO = /^(Descartada por você|Mesma vaga|LinkedIn:|Marcada por você)/;
  const alvo = todas.filter((v) => ['nova', 'na_fila', 'descartada'].includes(v.status) && !DESCARTE_FIXO.test(v.motivo_status || ''));

  let entraram = 0, sairam = 0;
  for (const resumo of alvo) {
    const vaga = await repo.vagas.obter(resumo.id); // listar não traz a descrição
    const titulo = limparTitulo(vaga.titulo); // títulos de e-mail vêm sujos
    // sem descrição, título genérico fica para conferir na hora de abrir a vaga
    const lida = !!vaga.descricao;
    let { nota, justificativa } = await pontuar({ ...vaga, titulo, descricaoLida: lida }, { config });
    // com descrição: a IA confere se é mesmo de tecnologia (uma vez só por vaga)
    if (nota >= config.notaMinima && vaga.descricao) {
      const area = await conferirArea({ ...vaga, titulo }, { config });
      if (!area.ok) { nota = 5; justificativa = area.motivo; } else if (area.motivo.includes(CONFIRMADA)) justificativa = `${justificativa}; ${area.motivo}`;
    }
    const aprovada = nota >= config.notaMinima;
    const status = aprovada ? 'na_fila' : 'descartada';
    if (status !== vaga.status) {
      if (aprovada) entraram++; else sairam++;
      console.log(`  ${aprovada ? '+ entrou ' : '- saiu   '} [${String(nota).padStart(3)}] ${vaga.titulo} — ${vaga.local || ''}  (${justificativa})`);
    }
    await repo.vagas.atualizar(vaga.id, {
      titulo, nota, justificativa, status,
      motivo_status: aprovada ? null : `Nota ${nota} abaixo do mínimo (${config.notaMinima})`,
    });
  }

  const fila = (await repo.vagas.listar({ status: 'na_fila', limite: 5000 })).length;
  console.log(`\n  ${alvo.length} vagas repontuadas · ${entraram} entraram na fila · ${sairam} saíram · fila agora: ${fila}\n`);
  await repo.encerrar();
}

main().catch((e) => { console.error('\nErro ao repontuar:', e.message, '\n'); process.exit(1); });
