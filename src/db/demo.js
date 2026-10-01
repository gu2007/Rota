// Repositório em memória com as mesmas funções do sql.js, para rodar sem SQL Server.
// Tudo volta ao estado inicial ao reiniciar; empresas e vagas são fictícias.

const { CAMPOS_PERFIL, LISTAS, OBRIGATORIO, filtrar } = require('./modelo');
const { PLATAFORMAS, RESPOSTAS_FIXAS, CONFIGURACOES, DADOS_PESSOAIS } = require('./padroes');
const cofre = require('../util/cofre');
const { chavePergunta } = require('../candidatura/aprendizado');
const { dataLocal, horarioLocal, MINUTO } = require('../util/tempo');
const { planejarDia } = require('../agendador/planejador');

const clone = (o) => JSON.parse(JSON.stringify(o));
const ids = {};
const proximoId = (tabela) => (ids[tabela] = (ids[tabela] || 0) + 1);

const db = {
  perfil: { id: 1, nome: 'Pessoa Candidata', cidade: 'São Paulo, SP', objetivo: 'Estágio em desenvolvimento back-end', atualizado_em: new Date() },
  formacoes: [], experiencias: [], projetos: [], cursos: [], habilidades: [], textos: [],
  respostas_fixas: RESPOSTAS_FIXAS.map((r) => ({ ...r, resposta: r.resposta || null })),
  configuracoes: { ...CONFIGURACOES },
  plataformas: PLATAFORMAS.map((p) => ({ ...p, ativa: true, pausada_ate: null, motivo_pausa: null })),
  vagas: [], candidaturas: [], agenda: [], eventos: [],
  dados_pessoais: {},
  perguntas: [],
  processos: [],
};

const perfil = {
  async obter() { return clone(db.perfil); },
  async salvar(dados) {
    Object.assign(db.perfil, filtrar(dados, CAMPOS_PERFIL), { atualizado_em: new Date() });
    return clone(db.perfil);
  },
};

function checarLista(nome) {
  if (!LISTAS[nome]) throw Object.assign(new Error(`Lista desconhecida: ${nome}`), { status: 404 });
  return LISTAS[nome];
}

const listas = {
  async listar(nome) { checarLista(nome); return clone(db[nome]); },
  async criar(nome, dados) {
    const campos = filtrar(dados, checarLista(nome));
    if (!campos[OBRIGATORIO[nome]]) {
      throw Object.assign(new Error(`O campo "${OBRIGATORIO[nome]}" é obrigatório`), { status: 400 });
    }
    const item = { id: proximoId(nome), ...campos };
    db[nome].push(item);
    return clone(item);
  },
  async atualizar(nome, id, dados) {
    const item = db[nome]?.find((i) => i.id === id);
    if (!item) return null;
    Object.assign(item, filtrar(dados, checarLista(nome)));
    return clone(item);
  },
  async remover(nome, id) {
    checarLista(nome);
    db[nome] = db[nome].filter((i) => i.id !== id);
  },
};

const pessoais = {
  async obterTodos() {
    const saida = {};
    for (const [k, v] of Object.entries(db.dados_pessoais)) { try { saida[k] = cofre.decifrar(v); } catch {} }
    return saida;
  },
  async salvar(valores) {
    for (const [k, v] of Object.entries(valores)) {
      if (!DADOS_PESSOAIS.some((d) => d.chave === k)) continue;
      if (v === null) { delete db.dados_pessoais[k]; continue; }
      if (String(v).trim()) db.dados_pessoais[k] = cofre.cifrar(String(v).trim());
    }
  },
};

const respostas = {
  async listar() { return clone(db.respostas_fixas); },
  async salvar(lista) {
    for (const { chave, resposta } of lista) {
      const r = db.respostas_fixas.find((x) => x.chave === chave);
      if (r) r.resposta = resposta === '' ? null : resposta;
    }
    return clone(db.respostas_fixas);
  },
};

const config = {
  async obter() { return { ...db.configuracoes }; },
  async salvar(valores) {
    for (const [k, v] of Object.entries(valores)) db.configuracoes[k] = v == null ? null : String(v);
    return { ...db.configuracoes };
  },
};

const plataformas = {
  async listar() { return clone(db.plataformas); },
  async atualizar(codigo, dados) {
    const p = db.plataformas.find((x) => x.codigo === codigo);
    if (!p) return null;
    if (dados.ativa !== undefined) p.ativa = !!dados.ativa;
    if (dados.limite_diario !== undefined) p.limite_diario = Math.max(0, Math.min(100, Number(dados.limite_diario) || 0));
    if (dados.pausada_ate !== undefined) {
      p.pausada_ate = dados.pausada_ate ? new Date(dados.pausada_ate) : null;
      p.motivo_pausa = dados.motivo_pausa || null;
    }
    return clone(p);
  },
};

const vagas = {
  async listar({ status, q, limite = 200 } = {}) {
    const busca = q?.toLowerCase();
    return clone(
      db.vagas
        .filter((v) => !status || v.status === status)
        .filter((v) => !busca || v.titulo.toLowerCase().includes(busca) || (v.empresa || '').toLowerCase().includes(busca))
        .sort((a, b) => new Date(b.coletada_em) - new Date(a.coletada_em))
        .slice(0, limite)
        .map(({ descricao, ...resto }) => resto),
    );
  },
  async obter(id) { const v = db.vagas.find((x) => x.id === id); return v ? clone(v) : null; },
  async inserir(v) {
    const existente = db.vagas.find((x) => x.url === v.url);
    if (existente) return { id: existente.id, nova: false };
    const vaga = { status: 'nova', coletada_em: new Date(), ...v, id: proximoId('vagas') };
    db.vagas.push(vaga);
    return { id: vaga.id, nova: true };
  },
  async atualizar(id, dados) {
    const v = db.vagas.find((x) => x.id === id);
    if (!v) return null;
    for (const campo of ['status', 'motivo_status', 'nota', 'justificativa', 'plataforma_envio', 'url_candidatura', 'titulo', 'empresa', 'local', 'modelo', 'descricao']) {
      if (dados[campo] !== undefined) v[campo] = dados[campo];
    }
    return clone(v);
  },
  async buscarPorUrl(url, excetoId = 0) {
    const v = db.vagas.find((x) => x.id !== excetoId && (x.url === url || x.url_candidatura === url));
    return v ? clone(v) : null;
  },
  async proximaDaFila(plataforma, notaMinima, { incluirTestadas = false } = {}) {
    const fila = db.vagas
      .filter((v) => (v.status === 'na_fila' || (incluirTestadas && v.status === 'testada')) && v.plataforma_envio === plataforma && v.nota >= notaMinima)
      .sort((a, b) => (a.status === 'na_fila' ? 0 : 1) - (b.status === 'na_fila' ? 0 : 1) || b.nota - a.nota || new Date(a.coletada_em) - new Date(b.coletada_em));
    return fila[0] ? clone(fila[0]) : null;
  },
  async contarPorStatus() {
    const r = {};
    for (const v of db.vagas) r[v.status] = (r[v.status] || 0) + 1;
    return r;
  },
};

const candidaturas = {
  async listar({ limite = 200 } = {}) {
    return clone(
      db.candidaturas
        .slice()
        .sort((a, b) => new Date(b.criada_em) - new Date(a.criada_em))
        .slice(0, limite)
        .map((c) => {
          const v = db.vagas.find((x) => x.id === c.vaga_id) || {};
          return { ...c, titulo: v.titulo, empresa: v.empresa, url: v.url, nota: v.nota };
        }),
    );
  },
  async registrar(c) {
    const id = proximoId('candidaturas');
    db.candidaturas.push({ id, criada_em: new Date(), respostas: [], ...c });
    return id;
  },
  async contar({ desde }) {
    return db.candidaturas.filter(
      (c) => ['enviada', 'simulada'].includes(c.resultado) && (!desde || new Date(c.criada_em) >= desde),
    ).length;
  },
};

const agenda = {
  async doDia(data) {
    return clone(db.agenda.filter((a) => a.data === data).sort((a, b) => new Date(a.horario) - new Date(b.horario)));
  },
  async inserirMuitos(data, itens) {
    for (const i of itens) {
      db.agenda.push({ id: proximoId('agenda'), data, plataforma: i.plataforma, horario: i.horario, status: 'pendente', resultado: null, executado_em: null });
    }
  },
  async marcar(id, status, resultado) {
    const a = db.agenda.find((x) => x.id === id);
    if (a) Object.assign(a, { status, resultado: resultado || null, executado_em: new Date() });
  },
  async limparPendentes(data) {
    db.agenda = db.agenda.filter((a) => !(a.data === data && a.status === 'pendente'));
  },
  async contarExecutados(data, plataforma) {
    return db.agenda.filter((a) => a.data === data && a.plataforma === plataforma && a.status === 'executado').length;
  },
};

const eventos = {
  async listar(limite = 50) { return clone(db.eventos.slice(-limite).reverse()); },
  async registrar(nivel, origem, mensagem, quando = new Date()) {
    db.eventos.push({ id: proximoId('eventos'), nivel, origem, mensagem: String(mensagem), criado_em: quando });
  },
};

// dados de exemplo
const EMPRESAS = [
  'Nuvem Azul Tecnologia', 'Grupo Tríade', 'Banco Horizonte', 'Varejo Mais', 'Logix Transportes',
  'Saúde Conecta', 'EducaTech Brasil', 'Pix&Co Pagamentos', 'Rede Farol Seguros', 'Pátio Digital',
  'Atlas Energia', 'Moinho Software', 'Carbono Labs', 'Onda Telecom', 'Mercado Vivo',
];
const TITULOS = [
  ['Estágio em Desenvolvimento Back-end', 92], ['Estágio Desenvolvedor Node.js', 95], ['Estágio em Programação', 84],
  ['Estágio em Desenvolvimento de Sistemas', 88], ['Estágio TI - Desenvolvimento', 79], ['Estágio em Engenharia de Software', 81],
  ['Estágio Desenvolvedor Full Stack', 77], ['Estágio em Dados e Automação', 72], ['Estágio Suporte e Desenvolvimento', 66],
  ['Estágio em QA / Testes', 61], ['Estágio Desenvolvedor Java', 58], ['Desenvolvedor Pleno Node.js', 22],
  ['Estágio Administrativo', 12], ['Estágio Desenvolvimento Mobile', 69], ['Estágio em Banco de Dados SQL', 86],
  ['Jovem Aprendiz TI', 55], ['Estágio Desenvolvedor Python', 74], ['Estágio Infraestrutura Cloud', 70],
];
const ORIGENS = [['linkedin', 'email'], ['linkedin', 'site'], ['google', 'busca'], ['infojobs', 'email']];
const ENVIO = ['gupy', 'gupy', 'gupy', 'infojobs', 'sites'];
const MODELOS = ['presencial', 'hibrido', 'hibrido', 'remoto'];

function respostasExemplo(vaga) {
  return [
    { pergunta: 'Pretensão salarial', resposta: '(sua resposta fixa)', fonte: 'fixa' },
    { pergunta: 'Disponibilidade de horário', resposta: '(sua resposta fixa)', fonte: 'fixa' },
    { pergunta: `Por que você quer trabalhar na ${vaga.empresa}?`, resposta: '(texto gerado pela IA a partir do seu perfil — módulo de IA ainda não conectado)', fonte: 'ia' },
  ];
}

const perguntas = {
  async listar() {
    return clone(db.perguntas.slice().sort((a, b) => (a.resposta == null ? 0 : 1) - (b.resposta == null ? 0 : 1) || b.vezes - a.vezes));
  },
  async contarPendentes() { return db.perguntas.filter((p) => p.resposta == null).length; },
  async respondidas() {
    return clone(db.perguntas.filter((p) => p.resposta != null).map(({ pergunta, tipo, resposta }) => ({ pergunta, tipo, resposta })));
  },
  async registrar({ pergunta, tipo, opcoes = [], vaga_id }) {
    const chave = chavePergunta(pergunta);
    const atual = db.perguntas.find((p) => p.chave === chave);
    if (!atual) {
      db.perguntas.push({ id: proximoId('perguntas'), chave, pergunta, tipo, opcoes: opcoes || [], resposta: null, vagas: vaga_id ? [vaga_id] : [], vezes: 1, criada_em: new Date(), respondida_em: null });
      return;
    }
    atual.vezes++;
    if (vaga_id && !atual.vagas.includes(vaga_id)) atual.vagas.push(vaga_id);
    if (opcoes?.length) atual.opcoes = opcoes;
    if (tipo) atual.tipo = tipo;
  },
  async responder(id, resposta) {
    const p = db.perguntas.find((x) => x.id === id);
    if (!p) return null;
    Object.assign(p, { resposta, respondida_em: new Date() });
    return { pergunta: clone(p), liberadas: resposta ? await perguntas.liberarVagas() : 0 };
  },
  async liberarVagas() {
    const presas = new Set(db.perguntas.filter((p) => p.resposta == null).flatMap((p) => p.vagas));
    const livres = db.vagas.filter((v) => v.status === 'aguardando' && !presas.has(v.id));
    for (const v of livres) Object.assign(v, { status: 'na_fila', motivo_status: 'Você respondeu a pergunta: vai tentar de novo' });
    return livres.length;
  },
  async remover(id) {
    db.perguntas = db.perguntas.filter((p) => p.id !== id);
    return perguntas.liberarVagas();
  },
};

const processos = {
  async listar(limite = 200) { return clone(db.processos.slice().sort((a, b) => new Date(b.recebido_em) - new Date(a.recebido_em)).slice(0, limite)); },
  async idsLidos() { return new Set(db.processos.map((p) => p.email_id)); },
  async registrar(p) {
    if (db.processos.some((x) => x.email_id === p.email_id)) return null;
    const id = proximoId('processos');
    db.processos.push({ id, notificado: false, lembrete_enviado: false, criado_em: new Date(), ...p, prazo_dia: p.prazo_data || null, recebido_em: new Date(p.recebido_em || Date.now()) });
    return id;
  },
  async naoNotificados() { return clone(db.processos.filter((p) => !p.notificado)); },
  async marcarNotificado(id) { const p = db.processos.find((x) => x.id === id); if (p) p.notificado = true; },
  async lembretesPara(data) { return clone(db.processos.filter((p) => p.prazo_dia === data && !p.lembrete_enviado && p.situacao !== 'reprovado')); },
  async marcarLembrete(id) { const p = db.processos.find((x) => x.id === id); if (p) p.lembrete_enviado = true; },
  async limpar() { db.processos = []; },
};

async function popular() {
  let rng = 7;
  const aleatorio = () => ((rng = (rng * 9301 + 49297) % 233280) / 233280);
  const agora = Date.now();

  for (let i = 0; i < 90; i++) {
    const [titulo, notaBase] = TITULOS[i % TITULOS.length];
    const [origem, coleta] = ORIGENS[Math.floor(aleatorio() * ORIGENS.length)];
    const empresa = EMPRESAS[(i * 7) % EMPRESAS.length];
    const nota = Math.max(0, Math.min(100, notaBase + Math.round((aleatorio() - 0.5) * 10)));
    await vagas.inserir({
      url: `https://exemplo.invalid/vaga/${1000 + i}`,
      origem_plataforma: origem, origem_coleta: coleta,
      plataforma_envio: origem === 'infojobs' ? 'infojobs' : ENVIO[i % ENVIO.length],
      titulo, empresa, local: 'São Paulo, SP', modelo: MODELOS[i % MODELOS.length],
      nota, justificativa: nota >= 70 ? 'Estágio de desenvolvimento compatível com o seu perfil.' : 'Pouco compatível com o seu objetivo.',
      status: nota >= 70 ? 'na_fila' : 'descartada',
      motivo_status: nota >= 70 ? null : `Nota ${nota} abaixo do mínimo (70)`,
      coletada_em: new Date(agora - aleatorio() * 6 * 24 * 60 * MINUTO),
    });
  }

  // dias anteriores: algumas vagas da fila viram candidaturas
  const naFila = db.vagas.filter((v) => v.status === 'na_fila').sort((a, b) => b.nota - a.nota);
  const inicioDeHoje = new Date(); inicioDeHoje.setHours(0, 0, 0, 0);
  naFila.slice(0, 20).forEach((v, i) => {
    const quando = new Date(new Date(v.coletada_em).getTime() + (1 + aleatorio() * 10) * 60 * MINUTO);
    if (quando >= inicioDeHoje) return; // hoje é tratado pela agenda abaixo
    const pulada = i === 5 || i === 12;
    const resultado = pulada ? 'pulada' : 'simulada';
    v.status = pulada ? 'pulada' : 'testada';
    v.motivo_status = pulada ? 'Pergunta obrigatória sem resposta verdadeira: "Possui certificação AWS?"' : null;
    db.candidaturas.push({
      id: proximoId('candidaturas'), vaga_id: v.id, plataforma: v.plataforma_envio, resultado,
      modo_teste: true, motivo: v.motivo_status, respostas: pulada ? [] : respostasExemplo(v), criada_em: quando,
    });
  });

  // agenda de hoje: planeja o dia e marca como feito o que já passou
  const hoje = dataLocal();
  const cfg = db.configuracoes;
  const plano = planejarDia({
    plataformas: db.plataformas.map((p) => ({ codigo: p.codigo, quantidade: p.limite_diario })),
    inicio: horarioLocal(hoje, cfg.janela_inicio),
    fim: horarioLocal(hoje, cfg.janela_fim),
    rng: aleatorio,
  });
  await agenda.inserirMuitos(hoje, plano);
  for (const item of db.agenda) {
    if (new Date(item.horario) > new Date()) continue;
    const tipo = db.plataformas.find((p) => p.codigo === item.plataforma).tipo;
    item.executado_em = item.horario;
    if (tipo === 'coleta') {
      Object.assign(item, { status: 'executado', resultado: `${Math.floor(aleatorio() * 4)} vagas novas` });
      continue;
    }
    // consome a melhor vaga da fila, igual ao executor de verdade
    const vaga = await vagas.proximaDaFila(item.plataforma, 70);
    if (!vaga) {
      Object.assign(item, { status: 'ignorado', resultado: 'fila vazia' });
      continue;
    }
    Object.assign(item, { status: 'executado', resultado: 'simulada' });
    await vagas.atualizar(vaga.id, { status: 'testada' });
    db.candidaturas.push({
      id: proximoId('candidaturas'), vaga_id: vaga.id, plataforma: item.plataforma, resultado: 'simulada',
      modo_teste: true, motivo: null, respostas: respostasExemplo(vaga), criada_em: new Date(item.horario),
    });
  }

  // exemplos de perguntas (vagas fictícias ficam "aguardando")
  const esperando = db.vagas.filter((v) => v.status === 'na_fila').slice(0, 2);
  for (const v of esperando) v.status = 'aguardando';
  if (esperando[0]) {
    await perguntas.registrar({ pergunta: '1. Qual o seu Coeficiente de Rendimento (CR)?', tipo: 'radio', opcoes: ['Abaixo de 6', 'Entre 6 e 7', 'Entre 7 e 8', 'Entre 8 e 9', 'Acima de 9'], vaga_id: esperando[0].id });
    await perguntas.registrar({ pergunta: 'Você possui notebook próprio para trabalhar?', tipo: 'radio', opcoes: ['Sim', 'Não'], vaga_id: esperando[0].id });
  }
  if (esperando[1]) {
    await perguntas.registrar({ pergunta: 'Informe abaixo, de forma detalhada, a sua grade horária semanal da faculdade.', tipo: 'textarea', vaga_id: esperando[1].id });
    await perguntas.registrar({ pergunta: 'Qual o seu CR (coeficiente de rendimento)?', tipo: 'select', opcoes: ['Até 7', 'De 7 a 8,5', 'Acima de 8,5'], vaga_id: esperando[1].id });
  }

  // exemplos de processos (empresas fictícias)
  const candidatadas = db.vagas.filter((v) => v.status === 'testada').slice(0, 3);
  const exemplos = [
    { situacao: 'teste', resumo: 'Você foi aprovado na triagem e convidado para o teste de lógica.', acao: 'Fazer o teste online na Gupy', prazo: '05/10 às 23h59', prazo_data: dataLocal(new Date(agora + 86400000)), prazo_hora: '23:59', link: 'https://exemplo.gupy.io/candidates/applications' },
    { situacao: 'recebida', resumo: 'A empresa confirmou o recebimento da sua candidatura.' },
    { situacao: 'reprovado', resumo: 'A empresa seguiu com outros candidatos nesta vaga.' },
  ];
  candidatadas.forEach((v, i) => processos.registrar({
    email_id: `demo-${i}`, vaga_id: v.id, empresa: v.empresa, vaga_titulo: v.titulo, assunto: `Atualização da sua candidatura — ${v.empresa}`,
    recebido_em: new Date(agora - (i + 1) * 5 * 3600000), notificado: i > 0, ...exemplos[i],
  }));

  await eventos.registrar('info', 'sistema', 'Modo demo: dados de exemplo carregados (empresas fictícias).', new Date(agora - 60 * MINUTO));
  await eventos.registrar('aviso', 'gupy', 'Modo teste ligado: formulários são preenchidos, mas nada é enviado.', new Date(agora - 30 * MINUTO));
}

async function iniciar() { await popular(); }
async function encerrar() {}

module.exports = {
  nome: 'Demo (memória)',
  iniciar, encerrar, perfil, listas, pessoais, respostas, config, plataformas, vagas, candidaturas, agenda, eventos, perguntas, processos,
};
