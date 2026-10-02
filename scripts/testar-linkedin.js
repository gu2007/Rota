// LinkedIn: busca vagas novas (página pública, sem usar a sua conta) e abre as da fila para
// descobrir onde é a candidatura (Gupy ou site da empresa). Não se candidata.
//   npm run testar:linkedin            -> busca e abre até 10
//   npm run testar:linkedin 20         -> abre até 20
//   npm run testar:linkedin <link>     -> só essa vaga
const { ambiente, lerConfiguracoes } = require('../src/config');
const { registrarVaga } = require('../src/agendador/executor');
const { normalizarUrl } = require('../src/util/url');
const linkedin = require('../src/plataformas/linkedin');

async function main() {
  const repo = require('../src/db').repo();
  await repo.iniciar(ambiente.banco);
  const log = async (nivel, origem, msg) => { console.log(`  [${origem}] ${msg}`); await repo.eventos.registrar(nivel, origem, msg); };
  const config = lerConfiguracoes(await repo.config.obter());
  const args = process.argv.slice(2);
  const link = args.find((a) => /^https?:/i.test(a));
  const porVez = Number(args.find((a) => /^\d+$/.test(a))) || 10;
  console.log('\n=== Rota · LinkedIn: buscar vagas e descobrir onde é a candidatura (nada é enviado) ===\n');

  if (link) {
    const r = await registrarVaga(repo, { url: normalizarUrl(link), titulo: 'Vaga do LinkedIn (teste)' }, { origem_plataforma: 'manual', origem_coleta: 'manual' });
    // força a fila no teste, mesmo com a nota do título provisório
    await repo.vagas.atualizar(r.id, { status: 'na_fila', plataforma_envio: 'linkedin' });
  } else {
    // 1) busca: muitas vagas de uma vez; a nota decide quem entra na fila
    console.log(`1) Buscando no LinkedIn: ${config.termosBusca.join(' · ') || '(sem termos em Ajustes)'}\n`);
    const achadas = await linkedin.buscarVagas({ config, log }, { paginas: 3 });
    let novas = 0, fila = 0;
    for (const v of achadas) {
      const r = await registrarVaga(repo, v, { origem_plataforma: 'linkedin', origem_coleta: 'busca' });
      if (!r.nova) continue;
      novas++;
      if (r.aprovada) {
        fila++;
        console.log(`  + [${String(r.nota).padStart(3)}] ${v.titulo}${v.empresa ? ` — ${v.empresa}` : ''}${v.local ? ` (${v.local})` : ''}`);
      }
    }
    console.log(`\n  ${achadas.length} vagas encontradas · ${novas} novas · ${fila} entraram na fila (as outras ficaram abaixo da nota mínima)\n`);
  }

  // 2) abre as da fila para achar o link de candidatura
  const antes = (await repo.vagas.listar({ status: 'na_fila', limite: 500 })).filter((v) => v.plataforma_envio === 'linkedin');
  console.log(`2) ${antes.length} vagas do LinkedIn esperando. Abrindo até ${porVez}. O Chrome vai abrir: não mexa nele.\n`);
  await linkedin.coletar({ repo, config, log, buscar: false }, { porVez });

  const fila = (await repo.vagas.listar({ status: 'na_fila', limite: 500 }));
  const conta = (p) => fila.filter((v) => v.plataforma_envio === p).length;
  console.log(`\n  Fila agora: ${conta('sites')} de sites de empresas · ${conta('gupy')} da Gupy · ${conta('linkedin')} ainda para abrir no LinkedIn\n`);
  await repo.encerrar();
}

main().catch((e) => { console.error('\nErro:', e.message, '\n'); process.exit(1); });
