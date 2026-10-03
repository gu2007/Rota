// Busca vagas e faz uma candidatura agora, sem esperar a agenda. Só envia de verdade com --enviar.
// npm run testar:gupy [-- <link>] | enviar:gupy [-- <link>] | testar:sites | enviar:sites
// Resultado no Histórico do painel; prints em dados/gupy/.

const { ambiente, lerConfiguracoes } = require('../src/config');
const { registrarVaga, guardarPendentes } = require('../src/agendador/executor');
const { LISTAS } = require('../src/db/modelo');
const portal = require('../src/plataformas/portal-gupy');
const modulos = require('../src/plataformas');
const ia = require('../src/ia/gemini');
const { normalizarUrl } = require('../src/util/url');
const { observar } = require('../src/candidatura/observador');

async function main() {
  const repo = require('../src/db').repo();
  await repo.iniciar(ambiente.banco);
  const log = async (nivel, origem, msg) => { console.log(`  [${origem}] ${msg}`); await repo.eventos.registrar(nivel, origem, msg); };

  const args = process.argv.slice(2);
  // O PowerShell engole o "--" de "npm run x -- --enviar" e o npm repassa como npm_config_enviar
  const enviar = args.includes('--enviar') || process.env.npm_config_enviar === 'true';
  const plataforma = args.includes('--sites') ? 'sites' : 'gupy';
  const nomePlat = plataforma === 'sites' ? 'sites de empresas' : 'Gupy';
  const config = { ...lerConfiguracoes(await repo.config.obter()), modoTeste: !enviar };
  const listas = {};
  for (const nome of Object.keys(LISTAS)) listas[nome] = await repo.listas.listar(nome);
  const ctx = { config, perfil: await repo.perfil.obter(), listas, pessoais: await repo.pessoais.obterTodos(), respostasFixas: await repo.respostas.listar(), respondidas: await repo.perguntas.respondidas(), log };

  console.log(enviar
    ? '\n=== Rota · candidatura DE VERDADE (vai clicar em Finalizar) ===\n'
    : '\n=== Rota · teste principal (modo teste: NADA é enviado) ===\n');
  if (!ia.disponivel()) console.log('  Aviso: sem GEMINI_API_KEY no .env. Perguntas abertas vão fazer a vaga ser pulada.\n');
  if (!ctx.perfil.curriculo_arquivo) console.log('  Aviso: caminho do currículo vazio no Perfil.\n');

  let vaga;
  const link = args.find((a) => !a.startsWith('--'));
  if (link) {
    const url = normalizarUrl(link);
    const r = await registrarVaga(repo, { url, titulo: 'Vaga informada no teste' }, { origem_plataforma: 'manual', origem_coleta: 'manual' });
    vaga = await repo.vagas.obter(r.id);
    if (plataforma === 'sites') await repo.vagas.atualizar(vaga.id, { plataforma_envio: 'sites' });
  } else if (plataforma === 'sites') {
    // no teste a mesma vaga pode ser simulada de novo: é assim que se confere uma correção
    vaga = await repo.vagas.proximaDaFila('sites', config.notaMinima, { incluirTestadas: true });
    if (!vaga) {
      console.log('   Nenhuma vaga de site de empresa na fila. Rode "npm run testar:linkedin" para descobrir mais.\n');
      const sites = (await repo.vagas.listar({ limite: 5000 })).filter((v) => v.plataforma_envio === 'sites');
      const porStatus = sites.reduce((a, v) => ({ ...a, [v.status]: (a[v.status] || 0) + 1 }), {});
      console.log(`   Vagas de sites no banco: ${JSON.stringify(porStatus)} · nota mínima: ${config.notaMinima}`);
      for (const v of sites.slice(0, 8)) console.log(`     #${v.id} [${v.nota ?? '—'}] ${v.status} · ${v.titulo} — ${v.empresa || ''} · ${String(v.motivo_status || '').slice(0, 80)}`);
      console.log();
      return repo.encerrar();
    }
  } else {
    console.log('1) Buscando vagas no portal da Gupy…');
    const encontradas = await portal.coletar(ctx);
    let novas = 0, fila = 0;
    for (const v of encontradas) {
      const r = await registrarVaga(repo, v, { origem_plataforma: 'gupy_portal', origem_coleta: 'busca' });
      if (r.nova) novas++;
      if (r.nova && r.aprovada) fila++;
    }
    console.log(`   ${encontradas.length} encontradas · ${novas} novas · ${fila} entraram na fila (nota ≥ ${config.notaMinima})\n`);
    vaga = await repo.vagas.proximaDaFila('gupy', config.notaMinima, { incluirTestadas: enviar });
    if (!vaga) {
      console.log('   Nenhuma vaga da Gupy na fila. Veja as notas em Vagas no painel ou ajuste os termos de busca.\n');
      return repo.encerrar();
    }
  }

  // vaga descartada pelo filtro de TI: já segue para a próxima da fila (até 10)
  for (let tentativa = 1; ; tentativa++) {
  console.log(`2) Candidatando em ${nomePlat} (${enviar ? 'DE VERDADE' : 'teste'}): ${vaga.titulo} — ${vaga.empresa || ''} [nota ${vaga.nota ?? '—'}]`);
  if (enviar) {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    const resposta = await new Promise((ok) => rl.question(`   ${vaga.url}\n   Confirma o envio REAL desta candidatura? Digite "sim": `, ok));
    rl.close();
    if (resposta.trim().toLowerCase() !== 'sim') {
      console.log('   Cancelado. Nada foi feito.\n');
      return repo.encerrar();
    }
  }
  console.log(`   ${vaga.url}\n   O Chrome vai abrir. Não mexa nele até terminar.\n`);

  // Se travar, a janela fica aberta: você termina e o Rota aprende olhando
  let observado = null;
  const podeAssumir = process.env.NAVEGADOR_OCULTO !== 'true'; // janela visível: nunca fecha sozinha quando trava
  const aoTravar = podeAssumir ? async ({ contexto, pagina, resultado }) => {
    console.log(`\n   O Rota travou: ${String(resultado.motivo || resultado.resultado).slice(0, 200)}`);
    console.log('   >> Termine você mesmo nessa janela do Chrome. Eu fico olhando e aprendo as respostas e os botões.');
    console.log('   >> Atenção: se você clicar em Enviar, a candidatura vai DE VERDADE (o modo teste vale só para o robô).');
    console.log('   >> Quando acabar (ou se desistir), FECHE a janela do Chrome.\n');
    observado = await observar(contexto, pagina, { log: (m) => console.log(m), salvarPessoais: (p) => repo.pessoais.salvar(p) });
    return observado;
  } : undefined;
  const r = await modulos[plataforma].candidatar(vaga, ctx, { aoTravar });
  // descartada (não é de TI): nem chegou a tentar, então não entra no histórico de candidaturas
  if (r.resultado !== 'descartada') await repo.candidaturas.registrar({ vaga_id: vaga.id, plataforma, resultado: r.resultado, modo_teste: !enviar, motivo: r.motivo, respostas: r.respostas });
  const aguardando = await guardarPendentes(repo, vaga, r);
  const status = aguardando ? 'aguardando' : r.paraVoce ? 'para_voce' : { simulada: 'testada', pulada: 'pulada', erro: 'erro', captcha: 'na_fila', enviada: 'candidatada', descartada: 'descartada' }[r.resultado];
  await repo.vagas.atualizar(vaga.id, { status, motivo_status: aguardando || r.motivo || null });
  if (r.resultado === 'descartada' && !link) {
    console.log(`3) Descartada — ${r.motivo}\n`);
    vaga = tentativa < 10 ? await repo.vagas.proximaDaFila(plataforma, config.notaMinima, { incluirTestadas: plataforma === 'sites' || enviar }) : null;
    if (!vaga) { console.log(tentativa < 10 ? '   A fila acabou.\n' : '   10 vagas descartadas seguidas: parei aqui.\n'); break; }
    console.log('   Indo para a próxima vaga da fila…\n');
    continue;
  }

  console.log(`3) Resultado: ${r.resultado.toUpperCase()}${r.motivo ? ` — ${r.motivo}` : ''}\n`);
  if (aguardando) console.log(`   → ${r.pendentes.length} pergunta(s) foram para a caixa "Perguntas" do painel. Responda lá e a vaga volta para a fila sozinha.\n`);
  for (const x of r.respostas) console.log(`   • ${x.pergunta}\n     → ${String(x.resposta).slice(0, 160)}  [${x.fonte}]`);
  if (observado) {
    const { novo, pessoais, enviada } = observado;
    const respostasNovas = Object.values(novo.respostas || {});
    console.log('\n   === O que o Rota aprendeu com você ===');
    for (const x of respostasNovas) console.log(`   • ${x.pergunta.slice(0, 70)} → ${String(x.valor).slice(0, 40)}`);
    for (const t of novo.textos || []) console.log(`   • (texto de exemplo) ${t.slice(0, 70)}`);
    const botoesNovos = [...novo.botoesAvancar, ...novo.botoesFinal, ...novo.botoesCandidatar, ...novo.botoesFechar];
    if (botoesNovos.length) console.log(`   • botões: ${botoesNovos.map((b) => `"${b}"`).join(', ')}`);
    if (pessoais.length) console.log(`   • guardado no cofre (criptografado): ${pessoais.join(', ')}`);
    if (!respostasNovas.length && !botoesNovos.length && !(novo.textos || []).length && !pessoais.length) console.log('   (nada novo)');
    if (enviada) {
      await repo.vagas.atualizar(vaga.id, { status: 'candidatada', motivo_status: 'Enviada por você (o Rota observou)' });
      await repo.candidaturas.registrar({ vaga_id: vaga.id, plataforma, resultado: 'enviada', modo_teste: false, motivo: 'Enviada por você (o Rota observou)', respostas: r.respostas });
      console.log('   Candidatura enviada por você: a vaga foi marcada como candidatada.');
    }
  }
  console.log(`\n   Prints de cada etapa: ${r.pasta}\n`);
  break;
  }
  await repo.encerrar();
}

main().catch((e) => {
  console.error('\nErro no teste:', e.message, '\n');
  process.exit(1);
});
