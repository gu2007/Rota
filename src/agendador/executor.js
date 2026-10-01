// Executor: a cada 30s garante a agenda do dia e roda os horários vencidos,
// respeitando as travas (plataforma ativa, pausa e limite diário).

const { planejarDia } = require('./planejador');
const { lerConfiguracoes } = require('../config');
const { dataLocal, horarioLocal, fimDoDia, MINUTO } = require('../util/tempo');
const { normalizarUrl, detectarPlataformaEnvio } = require('../util/url');
const { pontuar } = require('../ia/pontuador');
const { ModuloPendente } = require('../plataformas/base');
const modulosPadrao = require('../plataformas');
const { LISTAS } = require('../db/modelo');
const acompanhamento = require('../acompanhamento/processos');
const whatsapp = require('../notificacao/whatsapp');

const TOLERANCIA_ATRASO = 20; // min; com o PC desligado, a ação vira "perdida" em vez de rodar horas depois

async function planejarHoje(repo, { aPartirDe = new Date(), rng } = {}) {
  const hoje = dataLocal(aPartirDe);
  const config = lerConfiguracoes(await repo.config.obter());
  const inicioJanela = horarioLocal(hoje, config.janelaInicio);
  const fim = horarioLocal(hoje, config.janelaFim);
  const inicio = aPartirDe > inicioJanela ? aPartirDe : inicioJanela;

  const plataformas = [];
  for (const p of await repo.plataformas.listar()) {
    if (!p.ativa) continue;
    const feitas = await repo.agenda.contarExecutados(hoje, p.codigo);
    const quantidade = Math.max(0, p.limite_diario - feitas);
    if (quantidade > 0) plataformas.push({ codigo: p.codigo, quantidade });
  }

  const plano = inicio < fim ? planejarDia({ plataformas, inicio, fim, rng }) : [];
  await repo.agenda.inserirMuitos(hoje, plano);
  await repo.eventos.registrar('info', 'agendador', `Agenda de ${hoje}: ${plano.length} ações sorteadas entre ${config.janelaInicio} e ${config.janelaFim}.`);
  return plano;
}

// Ressorteia o que ainda não rodou hoje (ao mudar limites ou janela)
async function replanejarHoje(repo) {
  await repo.agenda.limparPendentes(dataLocal());
  return planejarHoje(repo);
}

// Entrada única para vagas de qualquer coletor ou adicionadas à mão
async function registrarVaga(repo, bruta, { origem_plataforma, origem_coleta }) {
  const url = normalizarUrl(bruta.url);
  if (!url || !bruta.titulo) return { ignorada: true, motivo: 'sem URL válida ou título' };

  const config = lerConfiguracoes(await repo.config.obter());
  const urlEnvio = normalizarUrl(bruta.url_candidatura) || url;
  const vaga = {
    ...bruta, url, url_candidatura: urlEnvio, origem_plataforma, origem_coleta,
    plataforma_envio: bruta.plataforma_envio || detectarPlataformaEnvio(urlEnvio),
  };

  const { nota, justificativa } = await pontuar(vaga, { config });
  const aprovada = nota >= config.notaMinima;
  const resultado = await repo.vagas.inserir({
    ...vaga, nota, justificativa,
    status: aprovada ? 'na_fila' : 'descartada',
    motivo_status: aprovada ? null : `Nota ${nota} abaixo do mínimo (${config.notaMinima})`,
  });
  return { ...resultado, nota, aprovada };
}

// Perguntas que só você responde vão para o painel e a vaga fica "aguardando" até
// serem respondidas. Retorna o motivo ou null.
async function guardarPendentes(repo, vaga, r) {
  if (r.resultado !== 'pulada' || !r.pendentes?.length) return null;
  for (const p of r.pendentes) await repo.perguntas.registrar({ ...p, vaga_id: vaga.id });
  const n = r.pendentes.length;
  return `Esperando você responder ${n} pergunta${n > 1 ? 's' : ''} em Perguntas: ${r.pendentes.map((p) => `"${p.pergunta.slice(0, 80)}"`).join('; ')}`;
}

function criarExecutor(repo, { intervaloMs = 30 * 1000, modulos = modulosPadrao } = {}) {
  let timer = null;
  let ocupado = false;
  let diaConferido = null;
  let ultimoLembrete = 0;

  const log = (nivel, origem, msg) => repo.eventos.registrar(nivel, origem, msg);

  async function montarContexto() {
    const [bruto, perfil, respostasFixas] = await Promise.all([
      repo.config.obter(), repo.perfil.obter(), repo.respostas.listar(),
    ]);
    const listas = {};
    for (const nome of Object.keys(LISTAS)) listas[nome] = await repo.listas.listar(nome);
    const pessoais = await repo.pessoais.obterTodos();
    const respondidas = await repo.perguntas.respondidas();
    return { config: lerConfiguracoes(bruto), perfil, listas, pessoais, respostasFixas, respondidas, log, repo };
  }

  async function pausarAteAmanha(plataforma, motivo) {
    await repo.plataformas.atualizar(plataforma, { pausada_ate: fimDoDia(), motivo_pausa: motivo });
    await log('aviso', plataforma, `Pausada até amanhã: ${motivo}`);
  }

  async function executarColeta(item, plataforma, modulo, ctx) {
    const encontradas = await modulo.coletar(ctx);
    let novas = 0, naFila = 0;
    for (const bruta of encontradas) {
      const r = await registrarVaga(repo, bruta, {
        origem_plataforma: plataforma.codigo,
        origem_coleta: { email: 'email', gupy_portal: 'busca' }[plataforma.codigo] || 'site',
      });
      if (r.nova) novas++;
      if (r.nova && r.aprovada) naFila++;
    }
    await repo.agenda.marcar(item.id, 'executado', `${novas} vagas novas`);
    // aproveita a leitura do Gmail para acompanhar os processos seletivos
    if (plataforma.codigo === 'email') {
      try {
        await acompanhamento.verificar({ repo, log });
        await acompanhamento.notificar({ repo, log });
      } catch (e) {
        await log('erro', 'processos', e.message);
      } finally {
        await whatsapp.desconectar(); // o WhatsApp abre um Chrome: fecha para não ocupar memória o dia todo
      }
    }
    await log('info', plataforma.codigo, `Coleta: ${encontradas.length} encontradas, ${novas} novas, ${naFila} foram para a fila.`);
  }

  async function executarCandidatura(item, plataforma, modulo, ctx) {
    // fora do modo teste, vagas já testadas também são enviadas de verdade
    const vaga = await repo.vagas.proximaDaFila(plataforma.codigo, ctx.config.notaMinima, { incluirTestadas: !ctx.config.modoTeste });
    if (!vaga) {
      await repo.agenda.marcar(item.id, 'ignorado', 'fila vazia');
      return;
    }

    const r = await modulo.candidatar(vaga, ctx);
    await repo.candidaturas.registrar({
      vaga_id: vaga.id, plataforma: plataforma.codigo, resultado: r.resultado,
      modo_teste: ctx.config.modoTeste, motivo: r.motivo, respostas: r.respostas,
    });

    const aguardando = await guardarPendentes(repo, vaga, r);
    const statusVaga = aguardando ? 'aguardando' : r.paraVoce ? 'para_voce' : { enviada: 'candidatada', simulada: 'testada', pulada: 'pulada', erro: 'erro', captcha: 'na_fila' }[r.resultado];
    await repo.vagas.atualizar(vaga.id, { status: statusVaga, motivo_status: aguardando || r.motivo || null });
    await repo.agenda.marcar(item.id, 'executado', r.resultado);

    if (r.resultado === 'captcha') {
      await pausarAteAmanha(plataforma.codigo, 'CAPTCHA/verificação apareceu');
    } else {
      await log(r.resultado === 'erro' ? 'erro' : 'info', plataforma.codigo,
        `${vaga.titulo} (${vaga.empresa || 'empresa não informada'}): ${r.resultado}${r.motivo ? ` — ${r.motivo}` : ''}`);
    }
  }

  async function executarItem(item, agora) {
    const atraso = (agora - new Date(item.horario)) / MINUTO;
    if (atraso > TOLERANCIA_ATRASO) return repo.agenda.marcar(item.id, 'perdido', 'sistema estava desligado');

    const plataforma = (await repo.plataformas.listar()).find((p) => p.codigo === item.plataforma);
    if (!plataforma || !plataforma.ativa) return repo.agenda.marcar(item.id, 'ignorado', 'plataforma desativada');
    if (plataforma.pausada_ate && new Date(plataforma.pausada_ate) > agora) {
      return repo.agenda.marcar(item.id, 'ignorado', 'plataforma pausada');
    }
    const feitas = await repo.agenda.contarExecutados(item.data, item.plataforma);
    if (feitas >= plataforma.limite_diario) return repo.agenda.marcar(item.id, 'ignorado', 'limite diário atingido');

    const modulo = modulos[plataforma.codigo];
    if (!modulo) return repo.agenda.marcar(item.id, 'ignorado', 'módulo pendente');
    const ctx = await montarContexto();
    try {
      if (plataforma.tipo === 'coleta') await executarColeta(item, plataforma, modulo, ctx);
      else await executarCandidatura(item, plataforma, modulo, ctx);
    } catch (erro) {
      if (erro instanceof ModuloPendente) {
        await repo.agenda.marcar(item.id, 'ignorado', 'módulo pendente');
      } else {
        await repo.agenda.marcar(item.id, 'executado', 'erro');
        await log('erro', plataforma.codigo, erro.message);
      }
    }
  }

  async function tick(agora = new Date()) {
    if (ocupado) return; // tick anterior ainda rodando
    ocupado = true;
    try {
      const hoje = dataLocal(agora);
      if (diaConferido !== hoje) {
        const itens = await repo.agenda.doDia(hoje);
        if (itens.length === 0) await planejarHoje(repo, { aPartirDe: agora });
        diaConferido = hoje;
      }
      const vencidos = (await repo.agenda.doDia(hoje)).filter((i) => i.status === 'pendente' && new Date(i.horario) <= agora);
      for (const item of vencidos) await executarItem(item, agora);

      // lembretes de véspera dos prazos
      if (agora - ultimoLembrete > 30 * MINUTO) {
        ultimoLembrete = agora;
        const config = lerConfiguracoes(await repo.config.obter());
        if (agora >= horarioLocal(hoje, config.janelaInicio) && agora <= horarioLocal(hoje, config.janelaFim)) {
          await acompanhamento.lembrar({ repo, log }).catch((e) => log('erro', 'processos', e.message));
          await whatsapp.desconectar();
        }
      }
    } catch (erro) {
      console.error('[executor]', erro);
      await log('erro', 'executor', erro.message).catch(() => {});
    } finally {
      ocupado = false;
    }
  }

  return {
    tick,
    iniciar() {
      tick();
      timer = setInterval(tick, intervaloMs);
    },
    parar() {
      clearInterval(timer);
    },
  };
}

module.exports = { criarExecutor, planejarHoje, replanejarHoje, registrarVaga, guardarPendentes };
