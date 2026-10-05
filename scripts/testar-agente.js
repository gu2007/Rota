// Teste "só IA": em cada plataforma, uma vaga é feita do começo ao fim pelo agente de IA
// (sem as regras), no MODO TESTE (nada é enviado). Mede quantas ele leva até o botão final
// e lista tudo o que ele preencheu, para você conferir se acertou.
// Vaga que não é de TI é descartada e ele já tenta a próxima da mesma plataforma.
//   npm run testar:agente              -> 1 vaga da Gupy, do InfoJobs, da Catho e de site de empresa
//   npm run testar:agente infojobs     -> só uma vaga do InfoJobs
//   npm run testar:agente catho enviar -> UMA candidatura DE VERDADE (pergunta antes de enviar)
//   npm run candidatar catho 10        -> até 10 candidaturas DE VERDADE na Catho (confirma uma vez no começo)
//   npm run testar:agente linkedin     -> uma vaga achada no LinkedIn (candidatura no site da empresa)
//   npm run testar:agente 439 212      -> essas vagas (pelo número)
const fs = require('fs');
const path = require('path');
const { ambiente, lerConfiguracoes } = require('../src/config');
const { LISTAS } = require('../src/db/modelo');
const { abrirNavegador, pausa } = require('../src/navegador/navegador');
const { aceitarCookies } = require('../src/navegador/cookies');
const { lerCampos } = require('../src/candidatura/leitor-pagina');
const aprendizado = require('../src/candidatura/aprendizado');
const gupy = require('../src/plataformas/gupy');
const { agir } = require('../src/agente/agente');
const ia = require('../src/ia/gemini');
const { conferirArea } = require('../src/ia/conferir-area');
const { areaPorRegras, tituloDeTI } = require('../src/ia/pontuador');
const { garantirLogins } = require('../src/navegador/sessoes');
const infojobsBusca = require('../src/coleta/infojobs-busca');
const linkedin = require('../src/plataformas/linkedin');
const cathoBusca = require('../src/coleta/catho-busca');
const portalGupy = require('../src/plataformas/portal-gupy');
const { registrarVaga } = require('../src/agendador/executor');
const { jaCandidatada } = require('../src/agendador/repetidas');

const GRUPOS = [
  // as que já chegaram até o fim no modo teste (npm run candidatar testadas)
  { nome: 'Testadas', so: true, filtro: (v) => v.status === 'testada' && ['gupy', 'sites', 'infojobs', 'linkedin_easy'].includes(v.plataforma_envio) },
  // achada no LinkedIn, candidatura no site da empresa/Gupy (a Candidatura simplificada do LinkedIn fica de fora)
  { nome: 'LinkedIn', filtro: (v) => v.origem_plataforma === 'linkedin' && ['gupy', 'sites', 'infojobs'].includes(v.plataforma_envio) },
  { nome: 'Easy Apply', filtro: (v) => v.plataforma_envio === 'linkedin_easy' || (v.status === 'para_voce' && /^Candidatura simplificada/.test(v.motivo_status || '')) },
  { nome: 'Gupy', filtro: (v) => v.plataforma_envio === 'gupy' },
  { nome: 'InfoJobs', filtro: (v) => v.plataforma_envio === 'infojobs' },
  { nome: 'Catho', filtro: (v) => /catho\.com/.test(v.url_candidatura || v.url) && tituloDeTI(v.titulo) },
  { nome: 'Site de empresa', filtro: (v) => v.plataforma_envio === 'sites' && !/catho\.com/.test(v.url_candidatura || v.url) },
];
const NAO_SERVE = /não é de tecnologia|fora de TI|já se candidatou|repetida|Mesma vaga|encerrad|não está mais dispon/i;
const MAX_TENTATIVAS = 10; // vagas por plataforma até achar uma de TI aberta (multiplicado pela quantidade)

async function main() {
  const repo = require('../src/db').repo();
  await repo.iniciar(ambiente.banco);
  const log = async (nivel, origem, msg) => { if (origem === 'agente') console.log(`      ${msg}`); };
  // "enviar": uma candidatura de verdade, com confirmação (o PowerShell engole o "--", por isso é uma palavra)
  const enviar = process.argv.slice(2).includes('enviar');
  const quantidade = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a) && Number(a) <= 50)) || (process.argv.slice(2).includes('todas') ? 50 : process.argv.slice(2).includes('lote') ? 10 : 1);
  const config = { ...lerConfiguracoes(await repo.config.obter()), modoTeste: !enviar };
  const listas = {};
  for (const nome of Object.keys(LISTAS)) listas[nome] = await repo.listas.listar(nome);
  const memoria = aprendizado.carregar();
  const ctx = {
    config, perfil: await repo.perfil.obter(), listas, pessoais: await repo.pessoais.obterTodos(),
    respostasFixas: await repo.respostas.listar(), respondidas: await repo.perguntas.respondidas(),
    aprendidas: Object.values(memoria.respostas || {}).map((a) => ({ pergunta: a.pergunta, resposta: String(a.valor) })),
  };
  console.log(enviar
    ? `\n=== Rota · agente de IA: ${quantidade > 1 ? `até ${quantidade} candidaturas` : 'UMA candidatura'} DE VERDADE (vou pedir confirmação antes) ===\n`
    : '\n=== Rota · teste "só IA": o agente faz a candidatura inteira (modo teste: NADA é enviado) ===\n');
  if (!ia.disponivel()) { console.log('  Precisa da GEMINI_API_KEY no .env.\n'); return repo.encerrar(); }

  // filas de candidatas por plataforma
  const args = process.argv.slice(2);
  // número pequeno (até 50) é a quantidade; número grande é o nº de uma vaga
  const ids = args.filter((a) => /^\d+$/.test(a) && Number(a) > 50).map(Number);
  const filas = [];
  if (ids.length) {
    for (const id of ids) { const v = await repo.vagas.obter(id); if (v) filas.push({ grupo: `#${id}`, vagas: [v], explicita: true }); }
  } else {
    const nomes = args.filter((x) => /^[a-z]/i.test(x) && !['enviar', 'lote', 'todas'].includes(x)).map((x) => x.toLowerCase());
    // InfoJobs: busca vagas novas na hora (já em São Paulo), para não testar só as antigas da fila
    if (!nomes.length || nomes.some((n) => 'infojobs'.startsWith(n))) {
      console.log('  Buscando vagas novas no InfoJobs (São Paulo)...');
      const cidade = String(config.localizacao || 'São Paulo').split(';')[0].split(',')[0].trim();
      const nav = await abrirNavegador();
      try {
        const achadas = await infojobsBusca.buscar(nav.pagina, { termos: config.termosBusca, maxDias: Math.max(config.maxDias || 2, 7), cidade });
        let novas = 0;
        for (const v of achadas) { const r = await registrarVaga(repo, v, { origem_plataforma: 'infojobs', origem_coleta: 'site' }).catch(() => ({})); if (r.nova) novas++; }
        console.log(`      ${achadas.length} vagas achadas, ${novas} novas.\n`);
      } finally { await nav.fechar().catch(() => {}); }
    }
    // LinkedIn: busca vagas novas de estágio e descobre onde é a candidatura (Easy Apply ou site da empresa).
    // O filtro f_AL=true do LinkedIn (só Easy Apply) foi testado: com estágio de TI em SP ele enche a lista de vagas que não têm nada a ver.
    const querEasy = nomes.some((n) => 'easy apply'.startsWith(n));
    const querLinkedin = nomes.some((n) => 'linkedin'.startsWith(n));
    if (querEasy || querLinkedin) {
      console.log(`  Buscando vagas novas de estágio no LinkedIn...`);
      const achadas = await linkedin.buscarVagas({ config, log: async () => {} }, { paginas: 3 });
      let novas = 0;
      for (const v of achadas) { const r = await registrarVaga(repo, v, { origem_plataforma: 'linkedin', origem_coleta: 'busca' }).catch(() => ({})); if (r.nova) novas++; }
      console.log(`      ${achadas.length} vagas achadas, ${novas} novas. Abrindo as da fila para conferir (TI, cidade, nº de candidatos)...`);
      await linkedin.coletar({ repo, config, buscar: false, log: async (n, o, m) => { if (o === 'linkedin') console.log(`      ${m}`); } }, { porVez: 15 });
      console.log();
    }
    const quer = (nome) => !nomes.length || nomes.some((n) => nome.startsWith(n));
    const gravar = async (achadas, origem) => { let novas = 0; for (const v of achadas) { const r = await registrarVaga(repo, v, { origem_plataforma: origem, origem_coleta: origem === 'gupy_portal' ? 'busca' : 'site' }).catch(() => ({})); if (r.nova) novas++; } return novas; };
    if (quer('gupy')) {
      console.log('  Buscando vagas novas no portal da Gupy...');
      const achadas = await portalGupy.coletar({ config, log: async () => {} }).catch((e) => { console.log(`      erro: ${e.message}`); return []; });
      console.log(`      ${achadas.length} vagas achadas, ${await gravar(achadas, 'gupy_portal')} novas.\n`);
    }
    if (quer('catho')) {
      console.log('  Buscando vagas novas na Catho (São Paulo)...');
      const cidade = String(config.localizacao || 'São Paulo').split(';')[0].split(',')[0].trim();
      const nav = await abrirNavegador();
      try {
        const achadas = await cathoBusca.buscar(nav.pagina, { termos: config.termosBusca, maxDias: Math.max(config.maxDias || 2, 7), cidade });
        console.log(`      ${achadas.length} vagas achadas, ${await gravar(achadas, 'catho')} novas.\n`);
      } finally { await nav.fechar().catch(() => {}); }
    }
    const todas = [];
    for (const status of ['na_fila', 'testada', 'erro', 'pulada', 'aguardando', 'para_voce']) todas.push(...await repo.vagas.listar({ status, limite: 1000 }));
    for (const g of GRUPOS.filter((x) => (!nomes.length && !x.so) || nomes.some((n) => x.nome.toLowerCase().startsWith(n)))) {
      const vagas = todas
        // título claramente de outra área já fica de fora; o resto a IA confere pela descrição
        .filter((x) => g.filtro(x) && !NAO_SERVE.test(x.motivo_status || '') && (x.nota ?? 0) >= config.notaMinima && !/fora de TI/.test(areaPorRegras(x).motivo))
        .sort((a, b) => (a.status === 'na_fila' ? 0 : 1) - (b.status === 'na_fila' ? 0 : 1) || b.id - a.id)
        .slice(0, Math.min(80, MAX_TENTATIVAS * quantidade));
      if (vagas.length) filas.push({ grupo: g.nome, vagas });
      else console.log(`  ${g.nome}: nenhuma vaga de TI na fila para testar (rode npm run rodar um tempo para achar).`);
    }
  }
  if (!filas.length) { console.log('\n  Nada para testar.\n'); return repo.encerrar(); }
  console.log('\n  O Chrome vai abrir: não mexa nele.\n');
  console.log('  Entrando nas plataformas antes (InfoJobs, Catho)...');
  const sessoes = await garantirLogins({ log: async (n, o, m) => { if (o === 'login') console.log(`      ${m}`); } }).catch(() => ({}));
  console.log();

  if (enviar && quantidade > 1) {
    const previa = filas.flatMap((x) => x.vagas.map((v) => `#${v.id} ${v.titulo} — ${v.empresa || ''}`)).slice(0, quantidade);
    if (filas.some((x) => x.grupo === 'Testadas')) console.log(`  Vagas que chegaram ao fim no modo teste (a IA confere TI e cidade de novo antes de cada envio):\n${previa.map((p) => `    • ${p}`).join('\n')}\n`);
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    const resp = await new Promise((ok) => rl.question(`  Vou ENVIAR DE VERDADE até ${quantidade} candidaturas em: ${filas.map((x) => x.grupo).join(', ')} (só vagas de TI em ${config.localizacao || 'São Paulo'}, conferidas pela descrição). Confirma? Digite "sim": `, ok));
    rl.close();
    if (resp.trim().toLowerCase() !== 'sim') { console.log('\n  Cancelado: nada foi enviado.\n'); return repo.encerrar(); }
    console.log();
  }
  const pastaBase = path.join(__dirname, '..', 'dados', 'agente', new Date().toISOString().replace(/[:.]/g, '-'));
  const relatorio = [];
  for (const { grupo, vagas, explicita } of filas) {
    let feitas = 0;
    for (const resumo of vagas) {
      const vaga = await repo.vagas.obter(resumo.id);
      const url = vaga.url_candidatura || vaga.url;
      console.log(`  [${grupo}] #${vaga.id} ${vaga.titulo} — ${vaga.empresa || ''}\n      ${url}`);
      const pastaPrints = path.join(pastaBase, `vaga-${vaga.id}`);
      if (enviar) {
        const repetida = await jaCandidatada(repo, vaga);
        if (repetida) {
          await repo.vagas.atualizar(vaga.id, { status: 'descartada', motivo_status: `Você já se candidatou a esta vaga (#${repetida.id})` });
          console.log(`      => repetida: você já se candidatou a ela (#${repetida.id}). Indo para a próxima...\n`);
          continue;
        }
      }
      const nav = await abrirNavegador();
      let r; let vazios = []; let descartada = null;
      try {
        await nav.pagina.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await pausa(2500, 4000);
        await aceitarCookies(nav.pagina);
        // só vaga de TI (lendo a descrição) e ainda aberta
        const texto = await nav.pagina.innerText('body').catch(() => '');
        if (/vaga (encerrada|expirada|n[aã]o est[aá] mais dispon)|n[aã]o est[aá] mais dispon[ií]vel|no longer (available|accepting)/i.test(texto.slice(0, 5000))) descartada = 'vaga encerrada';
        if (!descartada) {
          const descricao = String(vaga.descricao || '').length >= 400 ? vaga.descricao : texto.slice(0, 8000);
          const area = await conferirArea({ ...vaga, descricao }, { config });
          if (!area.ok) descartada = area.motivo;
        }
        if (!descartada && enviar && quantidade === 1) {
          const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
          const resp = await new Promise((ok) => rl.question(`      Enviar a candidatura DE VERDADE para esta vaga? Digite "sim": `, ok));
          rl.close();
          if (resp.trim().toLowerCase() !== 'sim') { console.log('      Cancelado: nada foi enviado.\n'); break; }
        }
        if (!descartada) {
          r = await agir({
            pagina: nav.pagina, contexto: nav.contexto, ctx, vaga, preencherFn: gupy.preencher, log,
            inicio: true, pastaPrints, loginSocialFn: gupy.fazerLogin,
          });
          const ultima = nav.contexto.pages().at(-1);
          vazios = ultima ? (await ultima.evaluate(lerCampos).catch(() => [])).filter((c) => c.obrigatorio && !c.preenchido && c.rotulo).map((c) => c.rotulo) : [];
        }
      } catch (e) {
        r = { resultado: 'erro', motivo: e.message.split('\n')[0], respostas: [], passos: 0 };
      } finally {
        if (enviar && r) { console.log('      A janela fica aberta 20 s para você ver o resultado...'); await pausa(20000, 20000); }
        await nav.fechar().catch(() => {});
      }
      if (descartada) {
        await repo.vagas.atualizar(vaga.id, { status: 'descartada', motivo_status: descartada });
        console.log(`      => descartada (${descartada.slice(0, 120)})${explicita ? '' : '. Indo para a próxima...'}\n`);
        if (explicita) relatorio.push({ grupo, id: vaga.id, titulo: vaga.titulo, chegou: false, resultado: 'descartada', motivo: descartada, passos: 0 });
        continue;
      }
      const chegou = ['simulada', 'enviada'].includes(r.resultado);
      // testada: o próximo teste pega outra vaga (e no modo real ela é enviada pelo npm run rodar)
      if (r.resultado === 'ja_candidatado') await repo.vagas.atualizar(vaga.id, { status: 'candidatada', motivo_status: r.motivo });
      if (r.resultado === 'encerrada') await repo.vagas.atualizar(vaga.id, { status: 'descartada', motivo_status: r.motivo });
      if (r.resultado === 'enviada') {
        await repo.vagas.atualizar(vaga.id, { status: 'candidatada', motivo_status: r.motivo });
        await repo.candidaturas.registrar({ vaga_id: vaga.id, plataforma: vaga.plataforma_envio || 'sites', resultado: 'enviada', modo_teste: false, motivo: r.motivo, respostas: r.respostas || [] });
      } else if (chegou) await repo.vagas.atualizar(vaga.id, { status: 'testada', motivo_status: r.motivo });
      console.log(`      => ${chegou ? 'CHEGOU NO BOTÃO FINAL' : 'NÃO TERMINOU'} em ${r.passos} passos — ${r.motivo}`);
      for (const x of r.respostas || []) console.log(`         • ${String(x.pergunta).slice(0, 70)} → ${String(x.resposta).slice(0, 60)}`);
      if (vazios.length) console.log(`         obrigatórios que ficaram vazios: ${vazios.slice(0, 6).join(' | ')}`);
      console.log(`         prints de cada passo: ${pastaPrints}\n`);
      relatorio.push({ grupo, id: vaga.id, titulo: vaga.titulo, empresa: vaga.empresa, url, chegou, resultado: r.resultado, motivo: r.motivo, passos: r.passos, preenchidos: r.respostas, vazios });
      feitas++;
      if (feitas >= quantidade) break;
      // entre uma candidatura de verdade e outra, uma pausa (parece gente, não robô)
      if (enviar) { const s2 = 40 + Math.round(Math.random() * 50); console.log(`      próxima em ${s2} s...\n`); await pausa(s2 * 1000, s2 * 1000); }
    }
    if (!feitas && !explicita) console.log(`  ${grupo}: nenhuma das ${vagas.length} vagas da fila era de TI e aberta.\n`);
  }

  fs.mkdirSync(pastaBase, { recursive: true });
  fs.writeFileSync(path.join(pastaBase, 'relatorio.json'), JSON.stringify(relatorio, null, 2));
  const ok = relatorio.filter((x) => x.chegou).length;
  console.log('  ===== RESULTADO =====');
  for (const x of relatorio) console.log(`  ${x.chegou ? 'OK   ' : 'FALHA'} ${x.grupo.padEnd(16)} #${x.id} — ${String(x.motivo).slice(0, 90)}`);
  console.log(`\n  ${ok} de ${relatorio.length} chegaram ao botão final sozinhas. Confira acima se o que a IA preencheu está certo.`);
  console.log(`  Relatório e prints: ${pastaBase}\n`);
  await repo.encerrar();
}

main().catch((e) => { console.error('\nErro no teste:', e.message, '\n'); process.exit(1); });
