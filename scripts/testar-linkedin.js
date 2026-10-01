// Abre as vagas do LinkedIn da fila e descobre onde é a candidatura. Não se candidata.
// npm run testar:linkedin [-- <link>]

const { ambiente, lerConfiguracoes } = require('../src/config');
const { registrarVaga } = require('../src/agendador/executor');
const { normalizarUrl } = require('../src/util/url');
const linkedin = require('../src/plataformas/linkedin');

async function main() {
  const repo = require('../src/db').repo();
  await repo.iniciar(ambiente.banco);
  const log = async (nivel, origem, msg) => { console.log(`  [${origem}] ${msg}`); await repo.eventos.registrar(nivel, origem, msg); };
  const config = lerConfiguracoes(await repo.config.obter());
  console.log('\n=== Rota · LinkedIn: descobrir onde é a candidatura (nada é enviado) ===\n');

  const link = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (link) {
    const r = await registrarVaga(repo, { url: normalizarUrl(link), titulo: 'Vaga do LinkedIn (teste)' }, { origem_plataforma: 'manual', origem_coleta: 'manual' });
    // força a fila no teste, mesmo com a nota do título provisório
    await repo.vagas.atualizar(r.id, { status: 'na_fila', plataforma_envio: 'linkedin' });
  }
  const antes = (await repo.vagas.listar({ status: 'na_fila', limite: 500 })).filter((v) => v.plataforma_envio === 'linkedin');
  console.log(`  ${antes.length} vagas do LinkedIn esperando. Abrindo até ${linkedin.POR_VEZ}. O Chrome vai abrir: não mexa nele.\n`);
  await linkedin.coletar({ repo, config, log });
  console.log('');
  await repo.encerrar();
}

main().catch((e) => { console.error('\nErro:', e.message, '\n'); process.exit(1); });
