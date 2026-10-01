// Mostra como seriam os próximos dias de agenda, sem usar o banco.
// npm run simular -- [dias]   (padrão: 3)

const { planejarDia } = require('../src/agendador/planejador');
const { PLATAFORMAS, CONFIGURACOES } = require('../src/db/padroes');
const { dataLocal, horarioLocal } = require('../src/util/tempo');

const dias = Number(process.argv[2]) || 3;
const hora = (d) => d.toTimeString().slice(0, 8);

for (let i = 0; i < dias; i++) {
  const dia = new Date();
  dia.setDate(dia.getDate() + i);
  const data = dataLocal(dia);

  const plano = planejarDia({
    plataformas: PLATAFORMAS.map((p) => ({ codigo: p.codigo, quantidade: p.limite_diario })),
    inicio: horarioLocal(data, CONFIGURACOES.janela_inicio),
    fim: horarioLocal(data, CONFIGURACOES.janela_fim),
  });

  console.log(`\n=== ${data} — ${plano.length} ações ===`);
  for (const p of PLATAFORMAS) {
    const horarios = plano.filter((x) => x.plataforma === p.codigo).map((x) => x.horario);
    const gaps = horarios.slice(1).map((h, j) => Math.round((h - horarios[j]) / 60000));
    console.log(`\n${p.nome.padEnd(20)} ${horarios.length}/${p.limite_diario}`);
    console.log('  horários:', horarios.map((h) => hora(h).slice(0, 5)).join(' '));
    if (gaps.length) console.log(`  intervalos (min): ${gaps.join(', ')}   menor: ${Math.min(...gaps)}  maior: ${Math.max(...gaps)}`);
  }
}
console.log();
