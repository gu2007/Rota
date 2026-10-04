// Modo contínuo: o Rota fica o dia todo buscando vagas em todas as fontes e se candidatando.
//   npm run rodar          (Ctrl+C para parar)
// Respeita o "modo teste" de Ajustes: com ele ligado, preenche tudo mas não envia nada.
// Não rode junto com "npm start": os dois usam o mesmo Chrome do Rota.
//
// Cada volta: busca nas fontes que estão "na hora" (LinkedIn, Gupy, Gmail, InfoJobs, Indeed, internet),
// abre as vagas do LinkedIn/Indeed para achar o link de candidatura e se candidata a 1 vaga da fila.
// Se travar, a janela fica aberta com o aviso de ajuda: você termina e o Rota aprende.

const fs = require('fs');
const path = require('path');
const { ambiente, lerConfiguracoes } = require('../src/config');
const { registrarVaga, guardarPendentes } = require('../src/agendador/executor');
const { LISTAS } = require('../src/db/modelo');
const modulos = require('../src/plataformas');
const indeed = require('../src/plataformas/indeed');
const { abrirNavegador } = require('../src/navegador/navegador');
const infojobsBusca = require('../src/coleta/infojobs-busca');
const webBusca = require('../src/coleta/web-busca');
const { observar } = require('../src/candidatura/observador');
const ia = require('../src/ia/gemini');
const { jaCandidatada } = require('../src/agendador/repetidas');
const { garantirLogins } = require('../src/navegador/sessoes');

const ARQUIVO_ESTADO = path.join(__dirname, '..', 'dados', 'rodar-estado.json');
const MINUTO = 60 * 1000;

// de quanto em quanto tempo cada fonte é buscada (minutos). A ordem é a ordem da volta.
const FONTES = [
  { codigo: 'linkedin', nome: 'LinkedIn', a_cada: 120 },
  { codigo: 'gupy_portal', nome: 'portal da Gupy', a_cada: 120 },
  { codigo: 'email', nome: 'Gmail', a_cada: 30 },
  { codigo: 'infojobs', nome: 'InfoJobs', a_cada: 180 },
  { codigo: 'indeed', nome: 'Indeed', a_cada: 180 },
  { codigo: 'web', nome: 'internet (IA)', a_cada: 360 },
];
const CANDIDATURA = ['sites', 'gupy', 'infojobs']; // onde o Rota consegue se candidatar
const PAUSA_ENTRE = [2, 5];   // minutos entre uma candidatura e outra (parece gente, não robô)
const ESPERA_FILA_VAZIA = 15; // minutos

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const hora = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const lerEstado = () => { try { return JSON.parse(fs.readFileSync(ARQUIVO_ESTADO, 'utf8')); } catch { return {}; } };
const salvarEstado = (e) => { fs.mkdirSync(path.dirname(ARQUIVO_ESTADO), { recursive: true }); fs.writeFileSync(ARQUIVO_ESTADO, JSON.stringify(e, null, 2)); };

async function main() {
  const repo = require('../src/db').repo();
  await repo.iniciar(ambiente.banco);
  const log = async (nivel, origem, msg) => {
    console.log(`  ${hora()} [${origem}] ${msg}`);
    await repo.eventos.registrar(nivel, origem, msg).catch(() => {});
  };
  let parar = false;
  process.on('SIGINT', () => {
    if (parar) process.exit(0);
    parar = true;
    console.log('\n  Parando depois do passo atual... (Ctrl+C de novo para sair na hora)\n');
  });

  async function montarContexto() {
    const config = lerConfiguracoes(await repo.config.obter());
    const listas = {};
    for (const nome of Object.keys(LISTAS)) listas[nome] = await repo.listas.listar(nome);
    return {
      config, perfil: await repo.perfil.obter(), listas, pessoais: await repo.pessoais.obterTodos(),
      respostasFixas: await repo.respostas.listar(), respondidas: await repo.perguntas.respondidas(), log, repo,
    };
  }

  // grava as vagas achadas; a nota (e o filtro de TI) decide quem entra na fila
  async function registrar(vagas, origem, coleta) {
    let novas = 0, fila = 0;
    for (const v of vagas) {
      const r = await registrarVaga(repo, v, { origem_plataforma: origem, origem_coleta: coleta }).catch(() => ({}));
      if (!r.nova) continue;
      novas++;
      if (r.aprovada) {
        fila++;
        console.log(`      + [${String(r.nota).padStart(3)}] ${v.titulo}${v.empresa ? ` — ${v.empresa}` : ''}${v.local ? ` (${v.local})` : ''}`);
      }
    }
    return { novas, fila };
  }

  async function buscarFonte(fonte, ctx) {
    const { config } = ctx;
    switch (fonte.codigo) {
      case 'linkedin': return { vagas: await modulos.linkedin.buscarVagas(ctx, { paginas: 3 }), coleta: 'busca' };
      case 'gupy_portal': return { vagas: await modulos.gupy_portal.coletar(ctx), coleta: 'busca' };
      case 'email': {
        if (!modulos.email.configurado()) return { vagas: [], coleta: 'email', pulou: 'falta GMAIL_USUARIO e GMAIL_SENHA_APP no .env' };
        const vagas = await modulos.email.coletar(ctx);
        // aproveita para acompanhar os processos seletivos
        try {
          const acompanhamento = require('../src/acompanhamento/processos');
          await acompanhamento.verificar({ repo, log });
          await acompanhamento.notificar({ repo, log });
        } catch (e) { await log('erro', 'processos', e.message); }
        finally { await require('../src/notificacao/whatsapp').desconectar().catch(() => {}); }
        return { vagas, coleta: 'email' };
      }
      case 'infojobs': {
        const nav = await abrirNavegador();
        const cidade = String(config.localizacao || 'São Paulo').split(';')[0].split(',')[0].trim();
        try { return { vagas: await infojobsBusca.buscar(nav.pagina, { termos: config.termosBusca, maxDias: config.maxDias, cidade, log }), coleta: 'site' }; }
        finally { await nav.fechar().catch(() => {}); }
      }
      case 'indeed': return { vagas: await indeed.coletar(ctx, { porVez: 0 }), coleta: 'site' };
      case 'web': return { vagas: await webBusca.buscar({ config, log }), coleta: 'site' };
      default: return { vagas: [], coleta: 'site' };
    }
  }

  // abre as vagas do LinkedIn/Indeed que estão na fila para achar onde é a candidatura
  async function resolverPendentes(ctx) {
    const fila = await repo.vagas.listar({ status: 'na_fila', limite: 1000 });
    if (fila.some((v) => v.plataforma_envio === 'linkedin')) {
      await modulos.linkedin.coletar({ ...ctx, buscar: false }, { porVez: 5 }).catch((e) => log('erro', 'linkedin', e.message));
    }
    if (fila.some((v) => v.plataforma_envio === 'indeed')) {
      await indeed.coletar(ctx, { buscar: false, porVez: 5 }).catch((e) => log('erro', 'indeed', e.message));
    }
  }

  async function proximaVaga(config, pausadas) {
    const opcoes = [];
    for (const p of CANDIDATURA) {
      if (pausadas.has(p)) continue;
      const v = await repo.vagas.proximaDaFila(p, config.notaMinima, { incluirTestadas: !config.modoTeste });
      if (v) opcoes.push({ ...v, _plataforma: p });
    }
    // melhor nota primeiro; as que nunca foram testadas antes das já testadas
    opcoes.sort((a, b) => (a.status === 'na_fila' ? 0 : 1) - (b.status === 'na_fila' ? 0 : 1) || (b.nota || 0) - (a.nota || 0));
    return opcoes[0] || null;
  }

  async function candidatar(vaga, ctx) {
    const plataforma = vaga._plataforma;
    console.log(`\n  ${hora()} >> Candidatura ${ctx.config.modoTeste ? '(teste)' : 'DE VERDADE'}: ${vaga.titulo} — ${vaga.empresa || ''} [nota ${vaga.nota}]`);
    console.log(`     ${vaga.url_candidatura || vaga.url}`);
    const repetida = await jaCandidatada(repo, vaga);
    if (repetida) {
      await repo.vagas.atualizar(vaga.id, { status: 'descartada', motivo_status: `Você já se candidatou a esta vaga (#${repetida.id})` });
      console.log(`     = REPETIDA — você já se candidatou a ela (#${repetida.id}). Pulando.`);
      return { resultado: 'descartada' };
    }
    let observado = null;
    const aoTravar = process.env.NAVEGADOR_OCULTO === 'true' ? undefined : async ({ contexto, pagina, resultado }) => {
      console.log(`\n     O Rota travou: ${String(resultado.motivo || resultado.resultado).slice(0, 200)}`);
      console.log('     >> Termine você mesmo na janela do Chrome (faixa laranja). Eu fico olhando e aprendo.');
      console.log('     >> Se clicar em Enviar, a candidatura vai DE VERDADE. Quando acabar ou desistir, FECHE a janela.\n');
      observado = await observar(contexto, pagina, { log: (m) => console.log(m), salvarPessoais: (p) => repo.pessoais.salvar(p) });
      return observado;
    };
    const r = await modulos[plataforma].candidatar(vaga, ctx, { aoTravar });
    if (observado?.enviada) { r.resultado = 'enviada'; r.motivo = 'Enviada por você (o Rota observou)'; }
    if (r.resultado !== 'descartada') {
      await repo.candidaturas.registrar({ vaga_id: vaga.id, plataforma, resultado: r.resultado, modo_teste: ctx.config.modoTeste && !observado?.enviada, motivo: r.motivo, respostas: r.respostas });
    }
    const aguardando = await guardarPendentes(repo, vaga, r);
    const status = /já se candidatou/i.test(r.motivo || '') ? 'candidatada' : aguardando ? 'aguardando' : r.paraVoce ? 'para_voce' : { simulada: 'testada', pulada: 'pulada', erro: 'erro', captcha: 'na_fila', enviada: 'candidatada', descartada: 'descartada' }[r.resultado];
    await repo.vagas.atualizar(vaga.id, { status, motivo_status: aguardando || r.motivo || null });
    if (r.resolvidoPor === 'agente') console.log('     (as regras travaram e o agente de IA terminou)');
    console.log(`     = ${r.resultado.toUpperCase()}${r.motivo ? ` — ${String(r.motivo).slice(0, 220)}` : ''}`);
    return r;
  }

  const inicio = await montarContexto();
  console.log('\n=== Rota · modo contínuo (Ctrl+C para parar) ===\n');
  console.log(inicio.config.modoTeste
    ? '  MODO TESTE ligado: preenche os formulários, mas NÃO envia nada (desligue em Ajustes quando quiser enviar de verdade).'
    : '  MODO REAL: as candidaturas são ENVIADAS de verdade.');
  if (!ia.disponivel()) console.log('  Aviso: sem GEMINI_API_KEY no .env: sem filtro da IA e sem busca na internet.');
  console.log(`  Fontes: ${FONTES.map((f) => `${f.nome} (a cada ${f.a_cada >= 60 ? `${f.a_cada / 60}h` : `${f.a_cada} min`})`).join(' · ')}\n`);

  const pausadas = new Map(); // plataforma de candidatura -> até quando (CAPTCHA)
  let ultimoLogin = 0;
  while (!parar) {
    const ctx = await montarContexto().catch(() => null);
    if (!ctx) { await espera(MINUTO); continue; }
    for (const [p, ate] of pausadas) if (Date.now() > ate) pausadas.delete(p);

    // 0) entra no InfoJobs/Catho antes de buscar e se candidatar (a cada 6 h confere de novo)
    if (Date.now() - ultimoLogin > 6 * 60 * MINUTO) {
      console.log(`\n  ${hora()} Entrando nas plataformas (InfoJobs, Catho)...`);
      await garantirLogins({ log }).catch((e) => log('erro', 'login', e.message));
      ultimoLogin = Date.now();
    }
    // 1) busca nas fontes que estão na hora
    const estado = lerEstado();
    for (const fonte of FONTES) {
      if (parar) break;
      const ultima = estado[fonte.codigo] ? new Date(estado[fonte.codigo]).getTime() : 0;
      if (Date.now() - ultima < fonte.a_cada * MINUTO) continue;
      console.log(`\n  ${hora()} Buscando vagas: ${fonte.nome}...`);
      try {
        const r = await buscarFonte(fonte, ctx);
        if (r.pulou) console.log(`      (pulei: ${r.pulou})`);
        const { novas, fila } = await registrar(r.vagas, fonte.codigo === 'gupy_portal' ? 'gupy_portal' : fonte.codigo, r.coleta);
        console.log(`      ${fonte.nome}: ${r.vagas.length} achadas · ${novas} novas · ${fila} na fila`);
      } catch (e) {
        await log('erro', fonte.codigo, e.message.split('\n')[0]);
      }
      estado[fonte.codigo] = new Date().toISOString();
      salvarEstado(estado);
    }
    if (parar) break;

    // 2) LinkedIn/Indeed: descobre onde é a candidatura
    await resolverPendentes(ctx).catch(() => {});
    if (parar) break;

    // 3) uma candidatura
    const vaga = await proximaVaga(ctx.config, pausadas);
    if (vaga) {
      try {
        const r = await candidatar(vaga, ctx);
        if (r.resultado === 'captcha') { pausadas.set(vaga._plataforma, Date.now() + 6 * 60 * MINUTO); await log('aviso', vaga._plataforma, 'CAPTCHA: candidaturas nessa plataforma pausadas por 6 horas.'); }
      } catch (e) {
        await log('erro', vaga._plataforma, `${vaga.titulo}: ${e.message.split('\n')[0]}`);
        await repo.vagas.atualizar(vaga.id, { status: 'erro', motivo_status: e.message.slice(0, 300) }).catch(() => {});
      }
      // vaga descartada pelo filtro não conta como candidatura: já segue
      const min = PAUSA_ENTRE[0] + Math.random() * (PAUSA_ENTRE[1] - PAUSA_ENTRE[0]);
      console.log(`\n  ${hora()} Próxima candidatura em ${Math.round(min)} min.`);
      for (let t = 0; t < min * 60 && !parar; t += 5) await espera(5000);
      continue;
    }

    // fila vazia: espera a próxima fonte ficar na hora
    const estado2 = lerEstado();
    const proxima = Math.min(...FONTES.map((f) => (estado2[f.codigo] ? new Date(estado2[f.codigo]).getTime() : 0) + f.a_cada * MINUTO));
    const min = Math.max(5, Math.min(ESPERA_FILA_VAZIA, Math.ceil((proxima - Date.now()) / MINUTO)));
    console.log(`\n  ${hora()} Fila vazia. Nova volta em ${min} min.`);
    for (let t = 0; t < min * 60 && !parar; t += 5) await espera(5000);
  }
  console.log('  Rota parado.\n');
  await repo.encerrar();
}

main().catch((e) => { console.error('\nErro no modo contínuo:', e.message, '\n'); process.exit(1); });
