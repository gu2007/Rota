// API REST do painel (/api). As rotas só validam a entrada e chamam o repositório.

const express = require('express');
const { lerConfiguracoes } = require('../config');
const { replanejarHoje, registrarVaga } = require('../agendador/executor');
const { STATUS_VAGA, LISTAS } = require('../db/modelo');
const { CONFIGURACOES, DADOS_PESSOAIS } = require('../db/padroes');
const { mascarar } = require('../util/cofre');
const ia = require('../ia/gemini');
const { escolherOpcao } = require('../candidatura/respostas');
const { dataLocal, inicioDoDia, inicioDaSemana } = require('../util/tempo');

// repassa erros das rotas async para o tratador do Express
const rota = (fn) => (req, res, next) => fn(req, res).catch(next);
const erro = (status, mensagem) => Object.assign(new Error(mensagem), { status });

function criarApi(repo, { demo }) {
  const api = express.Router();
  api.use(express.json({ limit: '1mb' }));

  api.get('/resumo', rota(async (req, res) => {
    const hoje = dataLocal();
    const [agenda, plataformas, porStatus, cfgBruta, candHoje, candSemana, candTotal, perguntasPendentes] = await Promise.all([
      repo.agenda.doDia(hoje),
      repo.plataformas.listar(),
      repo.vagas.contarPorStatus(),
      repo.config.obter(),
      repo.candidaturas.contar({ desde: inicioDoDia() }),
      repo.candidaturas.contar({ desde: inicioDaSemana() }),
      repo.candidaturas.contar({}),
      repo.perguntas.contarPendentes(),
    ]);
    const config = lerConfiguracoes(cfgBruta);
    const agora = new Date();

    const porPlataforma = plataformas.map((p) => {
      const itens = agenda.filter((a) => a.plataforma === p.codigo);
      const pausada = p.pausada_ate && new Date(p.pausada_ate) > agora;
      const feitas = itens.filter((a) => a.status === 'executado').length;
      const proxima = itens.find((a) => a.status === 'pendente' && new Date(a.horario) > agora);
      let estado = 'ativa';
      if (!p.ativa) estado = 'desligada';
      else if (pausada) estado = 'pausada';
      else if (feitas >= p.limite_diario) estado = 'limite';
      else if (!proxima) estado = 'encerrada';
      return { ...p, feitas, planejadas: itens.length, proxima: proxima?.horario || null, estado };
    });

    const proxima = agenda.find((a) => a.status === 'pendente' && new Date(a.horario) > agora) || null;
    res.json({
      demo, banco: repo.nome, hoje, agora,
      modoTeste: config.modoTeste, notaMinima: config.notaMinima,
      janela: { inicio: config.janelaInicio, fim: config.janelaFim },
      candidaturas: { hoje: candHoje, semana: candSemana, total: candTotal },
      vagas: porStatus,
      perguntasPendentes,
      plataformas: porPlataforma,
      proxima,
      agenda,
    });
  }));

  api.post('/agenda/replanejar', rota(async (req, res) => {
    const plano = await replanejarHoje(repo);
    res.json({ acoes: plano.length });
  }));

  api.get('/eventos', rota(async (req, res) => {
    res.json(await repo.eventos.listar(Math.min(200, Number(req.query.limite) || 50)));
  }));

  api.get('/vagas', rota(async (req, res) => {
    const { status, q } = req.query;
    if (status && !STATUS_VAGA.includes(status)) throw erro(400, 'Status inválido');
    res.json(await repo.vagas.listar({ status, q: q || undefined }));
  }));

  api.post('/vagas', rota(async (req, res) => {
    const { url, titulo, empresa, local, modelo, descricao } = req.body || {};
    if (!url || !titulo) throw erro(400, 'Informe pelo menos o link e o título da vaga');
    const r = await registrarVaga(repo, { url, titulo, empresa, local, modelo, descricao }, {
      origem_plataforma: 'manual', origem_coleta: 'manual',
    });
    if (r.ignorada) throw erro(400, 'Link inválido');
    if (!r.nova) throw erro(409, 'Essa vaga já está no sistema');
    res.status(201).json(r);
  }));

  api.patch('/vagas/:id', rota(async (req, res) => {
    const { status } = req.body || {};
    // descartar, devolver à fila ou marcar que você se candidatou por fora (ex.: LinkedIn)
    if (!['na_fila', 'descartada', 'candidatada'].includes(status)) throw erro(400, 'Só é possível mover para "na_fila", "descartada" ou "candidatada"');
    const motivos = { descartada: 'Descartada por você', candidatada: 'Você se candidatou (fora do bot)', na_fila: null };
    const v = await repo.vagas.atualizar(Number(req.params.id), { status, motivo_status: motivos[status] });
    if (!v) throw erro(404, 'Vaga não encontrada');
    res.json(v);
  }));

  api.get('/candidaturas', rota(async (req, res) => {
    res.json(await repo.candidaturas.listar({ limite: Math.min(500, Number(req.query.limite) || 200) }));
  }));

  api.get('/perfil', rota(async (req, res) => {
    const perfil = await repo.perfil.obter();
    const listas = {};
    for (const nome of Object.keys(LISTAS)) listas[nome] = await repo.listas.listar(nome);
    res.json({ perfil, listas });
  }));

  api.put('/perfil', rota(async (req, res) => res.json(await repo.perfil.salvar(req.body || {}))));

  api.post('/perfil/:lista', rota(async (req, res) => {
    res.status(201).json(await repo.listas.criar(req.params.lista, req.body || {}));
  }));

  api.put('/perfil/:lista/:id', rota(async (req, res) => {
    const item = await repo.listas.atualizar(req.params.lista, Number(req.params.id), req.body || {});
    if (!item) throw erro(404, 'Item não encontrado');
    res.json(item);
  }));

  api.delete('/perfil/:lista/:id', rota(async (req, res) => {
    await repo.listas.remover(req.params.lista, Number(req.params.id));
    res.status(204).end();
  }));

  // o navegador nunca recebe o valor, só se está preenchido e o final mascarado
  api.get('/pessoais', rota(async (req, res) => {
    const valores = await repo.pessoais.obterTodos();
    res.json(DADOS_PESSOAIS.map((d) => ({ ...d, preenchido: !!valores[d.chave], mascara: valores[d.chave] ? mascarar(valores[d.chave]) : null })));
  }));
  api.put('/pessoais', rota(async (req, res) => {
    const entrada = req.body || {};
    const valores = {};
    for (const d of DADOS_PESSOAIS) {
      if (entrada[d.chave] === null) valores[d.chave] = null;                 // apagar
      else if (typeof entrada[d.chave] === 'string' && entrada[d.chave].trim()) valores[d.chave] = entrada[d.chave].slice(0, 200);
    }
    await repo.pessoais.salvar(valores);
    res.status(204).end();
  }));

  api.get('/respostas', rota(async (req, res) => res.json(await repo.respostas.listar())));
  api.put('/respostas', rota(async (req, res) => {
    if (!Array.isArray(req.body)) throw erro(400, 'Envie uma lista de { chave, resposta }');
    res.json(await repo.respostas.salvar(req.body));
  }));

  api.get('/processos', rota(async (req, res) => res.json(await repo.processos.listar(300))));

  api.get('/perguntas', rota(async (req, res) => res.json(await repo.perguntas.listar())));
  api.put('/perguntas/:id', rota(async (req, res) => {
    const resposta = typeof req.body?.resposta === 'string' ? req.body.resposta.trim().slice(0, 4000) : '';
    if (!resposta) throw erro(400, 'Escreva ou escolha uma resposta');
    const r = await repo.perguntas.responder(Number(req.params.id), resposta);
    if (!r) throw erro(404, 'Pergunta não encontrada');
    let { liberadas } = r;
    // a IA verifica se a resposta serve para outras perguntas pendentes com o mesmo sentido
    let aproveitadas = 0;
    try {
      const pendentes = (await repo.perguntas.listar()).filter((p) => p.resposta == null);
      for (const x of await ia.aproveitarResposta({ pergunta: r.pergunta.pergunta, resposta, pendentes })) {
        const alvo = pendentes.find((p) => p.id === Number(x.id));
        const valor = alvo.opcoes.length ? escolherOpcao(alvo.opcoes, x.resposta) : String(x.resposta).trim();
        if (!valor) continue;
        const r2 = await repo.perguntas.responder(alvo.id, valor);
        liberadas += r2?.liberadas || 0;
        aproveitadas++;
      }
    } catch (e) {
      await repo.eventos.registrar('aviso', 'ia', `Não consegui aproveitar a resposta em outras perguntas: ${e.message}`);
    }
    res.json({ liberadas, aproveitadas });
  }));
  // "não quero responder": as vagas que esperavam por ela são puladas
  api.delete('/perguntas/:id', rota(async (req, res) => {
    const p = (await repo.perguntas.listar()).find((x) => x.id === Number(req.params.id));
    if (!p) throw erro(404, 'Pergunta não encontrada');
    for (const id of p.vagas) {
      const v = await repo.vagas.obter(id);
      if (v?.status === 'aguardando') await repo.vagas.atualizar(id, { status: 'pulada', motivo_status: 'Você preferiu não responder uma pergunta desta vaga' });
    }
    await repo.perguntas.remover(p.id);
    res.status(204).end();
  }));

  api.get('/configuracoes', rota(async (req, res) => res.json(await repo.config.obter())));
  api.put('/configuracoes', rota(async (req, res) => {
    const entrada = req.body || {};
    const valores = {};
    for (const chave of Object.keys(CONFIGURACOES)) if (entrada[chave] !== undefined) valores[chave] = entrada[chave];

    if (valores.nota_minima !== undefined) {
      const n = Number(valores.nota_minima);
      if (!(n >= 0 && n <= 100)) throw erro(400, 'Nota mínima deve ficar entre 0 e 100');
    }
    for (const c of ['janela_inicio', 'janela_fim']) {
      if (valores[c] !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(valores[c])) throw erro(400, 'Horário no formato HH:MM');
    }
    const final = { ...(await repo.config.obter()), ...valores };
    if (final.janela_inicio >= final.janela_fim) throw erro(400, 'O início da janela precisa ser antes do fim');

    res.json(await repo.config.salvar(valores));
  }));

  api.get('/plataformas', rota(async (req, res) => res.json(await repo.plataformas.listar())));
  api.patch('/plataformas/:codigo', rota(async (req, res) => {
    const { ativa, limite_diario, despausar } = req.body || {};
    const dados = { ativa, limite_diario };
    if (despausar) Object.assign(dados, { pausada_ate: null, motivo_pausa: null });
    const p = await repo.plataformas.atualizar(req.params.codigo, dados);
    if (!p) throw erro(404, 'Plataforma não encontrada');
    res.json(p);
  }));

  api.use((e, req, res, next) => {
    // erros do SQL Server causados pela entrada viram mensagem clara
    if ([2628, 8152].includes(e.number)) {
      const coluna = e.message.match(/column '([^']+)'/)?.[1];
      e.status = 400;
      e.message = coluna ? `O campo "${coluna}" ficou longo demais. Encurte o texto.` : 'Um dos campos ficou longo demais. Encurte o texto.';
    }
    if (!e.status || e.status >= 500) console.error(e);
    res.status(e.status || 500).json({ erro: e.status ? e.message : 'Erro interno. Veja o terminal do servidor.' });
  });

  return api;
}

module.exports = { criarApi };
