// Repositório SQL Server: todo acesso ao banco passa por aqui.
// demo.js expõe as mesmas funções, só que em memória.

const sql = require('mssql');
const { CAMPOS_PERFIL, LISTAS, OBRIGATORIO, filtrar } = require('./modelo');
const { DADOS_PESSOAIS } = require('./padroes');
const cofre = require('../util/cofre');
const { chavePergunta } = require('../candidatura/aprendizado');

let pool;

async function iniciar(cfg) {
  pool = await new sql.ConnectionPool({
    server: cfg.server,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    options: { encrypt: cfg.encrypt, trustServerCertificate: cfg.trustCert },
    pool: { max: 5 },
  }).connect();
}

async function encerrar() {
  if (pool) await pool.close();
}

// parâmetros no formato { nome: [tipo, valor] }
async function q(texto, params = {}) {
  const req = pool.request();
  for (const [nome, [tipo, valor]] of Object.entries(params)) req.input(nome, tipo, valor);
  return req.query(texto);
}

const TEXTO = sql.NVarChar(sql.MAX);

const perfil = {
  async obter() {
    const r = await q('SELECT * FROM dbo.perfil WHERE id = 1');
    return r.recordset[0] || { id: 1 };
  },
  async salvar(dados) {
    const campos = filtrar(dados, CAMPOS_PERFIL);
    const nomes = Object.keys(campos);
    const params = {};
    nomes.forEach((n) => (params[n] = [TEXTO, campos[n]]));
    const sets = nomes.map((n) => `${n} = @${n}`).concat('atualizado_em = SYSUTCDATETIME()');
    await q(
      `IF NOT EXISTS (SELECT 1 FROM dbo.perfil WHERE id = 1) INSERT INTO dbo.perfil (id) VALUES (1);
       UPDATE dbo.perfil SET ${sets.join(', ')} WHERE id = 1;`,
      params,
    );
    return perfil.obter();
  },
};

// listas do perfil
function checarLista(nome) {
  if (!LISTAS[nome]) throw Object.assign(new Error(`Lista desconhecida: ${nome}`), { status: 404 });
  return LISTAS[nome];
}

function paramsLista(nome, campos) {
  const params = {};
  for (const [n, v] of Object.entries(campos)) {
    params[n] = [n === 'carga_horaria' ? sql.Int : TEXTO, n === 'carga_horaria' && v != null ? Number(v) : v];
  }
  return params;
}

const listas = {
  async listar(nome) {
    checarLista(nome);
    const r = await q(`SELECT * FROM dbo.${nome} ORDER BY id`);
    return r.recordset;
  },
  async criar(nome, dados) {
    const campos = filtrar(dados, checarLista(nome));
    if (!campos[OBRIGATORIO[nome]]) {
      throw Object.assign(new Error(`O campo "${OBRIGATORIO[nome]}" é obrigatório`), { status: 400 });
    }
    const nomes = Object.keys(campos);
    const r = await q(
      `INSERT INTO dbo.${nome} (${nomes.join(', ')}) OUTPUT INSERTED.* VALUES (${nomes.map((n) => '@' + n).join(', ')})`,
      paramsLista(nome, campos),
    );
    return r.recordset[0];
  },
  async atualizar(nome, id, dados) {
    const campos = filtrar(dados, checarLista(nome));
    const nomes = Object.keys(campos);
    if (!nomes.length) return null;
    const r = await q(
      `UPDATE dbo.${nome} SET ${nomes.map((n) => `${n} = @${n}`).join(', ')} OUTPUT INSERTED.* WHERE id = @id`,
      { ...paramsLista(nome, campos), id: [sql.Int, id] },
    );
    return r.recordset[0] || null;
  },
  async remover(nome, id) {
    checarLista(nome);
    await q(`DELETE FROM dbo.${nome} WHERE id = @id`, { id: [sql.Int, id] });
  },
};

const CHAVES_PESSOAIS = DADOS_PESSOAIS.map((d) => d.chave);
const pessoais = {
  // para o bot, tudo decifrado; nunca mandar isso para o navegador
  async obterTodos() {
    const r = await q('SELECT chave, valor_cifrado FROM dbo.dados_pessoais');
    const saida = {};
    for (const l of r.recordset) {
      try { saida[l.chave] = cofre.decifrar(l.valor_cifrado); } catch { /* chave errada/ausente: ignora */ }
    }
    return saida;
  },
  async salvar(valores) {
    for (const [chave, valor] of Object.entries(valores)) {
      if (!CHAVES_PESSOAIS.includes(chave)) continue;
      if (valor === null) {
        await q('DELETE FROM dbo.dados_pessoais WHERE chave = @chave', { chave: [sql.NVarChar(60), chave] });
        continue;
      }
      if (!String(valor).trim()) continue;
      await q(
        `MERGE dbo.dados_pessoais AS alvo USING (SELECT @chave AS chave) AS o ON alvo.chave = o.chave
         WHEN MATCHED THEN UPDATE SET valor_cifrado = @valor, atualizado_em = SYSUTCDATETIME()
         WHEN NOT MATCHED THEN INSERT (chave, valor_cifrado) VALUES (@chave, @valor);`,
        { chave: [sql.NVarChar(60), chave], valor: [TEXTO, cofre.cifrar(String(valor).trim())] },
      );
    }
  },
};

const respostas = {
  async listar() {
    const r = await q('SELECT * FROM dbo.respostas_fixas ORDER BY ordem, chave');
    return r.recordset;
  },
  async salvar(lista) {
    for (const { chave, resposta } of lista) {
      await q('UPDATE dbo.respostas_fixas SET resposta = @resposta WHERE chave = @chave', {
        chave: [sql.NVarChar(60), chave],
        resposta: [sql.NVarChar(500), resposta === '' ? null : resposta],
      });
    }
    return respostas.listar();
  },
};

const config = {
  async obter() {
    const r = await q('SELECT chave, valor FROM dbo.configuracoes');
    return Object.fromEntries(r.recordset.map((l) => [l.chave, l.valor]));
  },
  async salvar(valores) {
    for (const [chave, valor] of Object.entries(valores)) {
      await q(
        `MERGE dbo.configuracoes AS alvo
         USING (SELECT @chave AS chave) AS origem ON alvo.chave = origem.chave
         WHEN MATCHED THEN UPDATE SET valor = @valor
         WHEN NOT MATCHED THEN INSERT (chave, valor) VALUES (@chave, @valor);`,
        { chave: [sql.NVarChar(60), chave], valor: [sql.NVarChar(1000), valor == null ? null : String(valor)] },
      );
    }
    return config.obter();
  },
};

const plataformas = {
  async listar() {
    const r = await q('SELECT * FROM dbo.plataformas ORDER BY ordem');
    return r.recordset;
  },
  async atualizar(codigo, dados) {
    const sets = [];
    const params = { codigo: [sql.NVarChar(30), codigo] };
    if (dados.ativa !== undefined) { sets.push('ativa = @ativa'); params.ativa = [sql.Bit, !!dados.ativa]; }
    if (dados.limite_diario !== undefined) {
      sets.push('limite_diario = @limite');
      params.limite = [sql.Int, Math.max(0, Math.min(100, Number(dados.limite_diario) || 0))];
    }
    if (dados.pausada_ate !== undefined) {
      sets.push('pausada_ate = @pausada_ate, motivo_pausa = @motivo');
      params.pausada_ate = [sql.DateTime2, dados.pausada_ate ? new Date(dados.pausada_ate) : null];
      params.motivo = [sql.NVarChar(300), dados.motivo_pausa || null];
    }
    if (!sets.length) return null;
    const r = await q(`UPDATE dbo.plataformas SET ${sets.join(', ')} OUTPUT INSERTED.* WHERE codigo = @codigo`, params);
    return r.recordset[0] || null;
  },
};

// vagas
const COLUNAS_VAGA = `id, url, url_candidatura, origem_plataforma, origem_coleta, plataforma_envio,
  titulo, empresa, local, modelo, nota, justificativa, status, motivo_status, coletada_em`;

const vagas = {
  async listar({ status, q: busca, limite = 200 } = {}) {
    const r = await q(
      `SELECT TOP (@limite) ${COLUNAS_VAGA} FROM dbo.vagas
       WHERE (@status IS NULL OR status = @status)
         AND (@busca IS NULL OR titulo LIKE @busca OR empresa LIKE @busca)
       ORDER BY coletada_em DESC`,
      {
        limite: [sql.Int, limite],
        status: [sql.NVarChar(20), status || null],
        busca: [sql.NVarChar(200), busca ? `%${busca}%` : null],
      },
    );
    return r.recordset;
  },
  async obter(id) {
    const r = await q('SELECT * FROM dbo.vagas WHERE id = @id', { id: [sql.Int, id] });
    return r.recordset[0] || null;
  },
  // insere só se a URL ainda não existe; retorna { id, nova }
  async inserir(v) {
    const r = await q(
      `DECLARE @hash BINARY(32) = CAST(HASHBYTES('SHA2_256', @url) AS BINARY(32));
       IF EXISTS (SELECT 1 FROM dbo.vagas WHERE url_hash = @hash)
         SELECT id, CAST(0 AS BIT) AS nova FROM dbo.vagas WHERE url_hash = @hash;
       ELSE
         INSERT INTO dbo.vagas (url, url_candidatura, origem_plataforma, origem_coleta, plataforma_envio,
                                titulo, empresa, local, modelo, descricao, nota, justificativa, status, motivo_status)
         OUTPUT INSERTED.id, CAST(1 AS BIT) AS nova
         VALUES (@url, @url_candidatura, @origem_plataforma, @origem_coleta, @plataforma_envio,
                 @titulo, @empresa, @local, @modelo, @descricao, @nota, @justificativa, @status, @motivo_status);`,
      {
        url: [sql.NVarChar(1000), v.url],
        url_candidatura: [sql.NVarChar(1000), v.url_candidatura || null],
        origem_plataforma: [sql.NVarChar(30), v.origem_plataforma],
        origem_coleta: [sql.NVarChar(20), v.origem_coleta],
        plataforma_envio: [sql.NVarChar(30), v.plataforma_envio || null],
        titulo: [sql.NVarChar(200), v.titulo],
        empresa: [sql.NVarChar(160), v.empresa || null],
        local: [sql.NVarChar(120), v.local || null],
        modelo: [sql.NVarChar(30), v.modelo || null],
        descricao: [TEXTO, v.descricao || null],
        nota: [sql.Int, v.nota ?? null],
        justificativa: [sql.NVarChar(1000), v.justificativa || null],
        status: [sql.NVarChar(20), v.status || 'nova'],
        motivo_status: [sql.NVarChar(300), v.motivo_status ? String(v.motivo_status).slice(0, 300) : null],
      },
    );
    const linha = r.recordset[0];
    return { id: linha.id, nova: !!linha.nova };
  },
  async atualizar(id, dados) {
    const permitidos = {
      status: sql.NVarChar(20), motivo_status: sql.NVarChar(300), nota: sql.Int,
      justificativa: sql.NVarChar(1000), plataforma_envio: sql.NVarChar(30),
      url_candidatura: sql.NVarChar(1000), titulo: sql.NVarChar(200), empresa: sql.NVarChar(160),
      local: sql.NVarChar(120), modelo: sql.NVarChar(30), descricao: TEXTO,
    };
    // trunca no tamanho da coluna para o SQL Server não recusar a gravação
    const limites = { motivo_status: 300, justificativa: 1000, url_candidatura: 1000, titulo: 200, empresa: 160, local: 120, modelo: 30 };
    const params = { id: [sql.Int, id] };
    const sets = [];
    for (const [campo, tipo] of Object.entries(permitidos)) {
      if (dados[campo] === undefined) continue;
      sets.push(`${campo} = @${campo}`);
      const valor = limites[campo] && typeof dados[campo] === 'string' ? dados[campo].slice(0, limites[campo]) : dados[campo];
      params[campo] = [tipo, valor];
    }
    if (!sets.length) return vagas.obter(id);
    const r = await q(`UPDATE dbo.vagas SET ${sets.join(', ')} OUTPUT INSERTED.* WHERE id = @id`, params);
    return r.recordset[0] || null;
  },
  // outra vaga já usa este endereço de candidatura?
  async buscarPorUrl(url, excetoId = 0) {
    const r = await q(
      `SELECT TOP 1 id, status, titulo, empresa FROM dbo.vagas
       WHERE id <> @id AND (url_hash = CAST(HASHBYTES('SHA2_256', @url) AS BINARY(32)) OR url_candidatura = @url)`,
      { id: [sql.Int, excetoId], url: [sql.NVarChar(1000), url] },
    );
    return r.recordset[0] || null;
  },
  // incluirTestadas: aceita também vagas que já passaram pelo modo teste
  async proximaDaFila(plataforma, notaMinima, { incluirTestadas = false } = {}) {
    const r = await q(
      `SELECT TOP 1 * FROM dbo.vagas
       WHERE (status = 'na_fila' OR (@testadas = 1 AND status = 'testada'))
         AND plataforma_envio = @plataforma AND nota >= @nota
       ORDER BY CASE WHEN status = 'na_fila' THEN 0 ELSE 1 END, nota DESC, coletada_em ASC`,
      { plataforma: [sql.NVarChar(30), plataforma], nota: [sql.Int, notaMinima], testadas: [sql.Bit, incluirTestadas ? 1 : 0] },
    );
    return r.recordset[0] || null;
  },
  async contarPorStatus() {
    const r = await q('SELECT status, COUNT(*) AS total FROM dbo.vagas GROUP BY status');
    return Object.fromEntries(r.recordset.map((l) => [l.status, l.total]));
  },
};

const candidaturas = {
  async listar({ limite = 200 } = {}) {
    const r = await q(
      `SELECT TOP (@limite) c.*, v.titulo, v.empresa, v.url, v.nota
       FROM dbo.candidaturas c JOIN dbo.vagas v ON v.id = c.vaga_id
       ORDER BY c.criada_em DESC`,
      { limite: [sql.Int, limite] },
    );
    return r.recordset.map((c) => ({ ...c, respostas: c.respostas ? JSON.parse(c.respostas) : [] }));
  },
  async registrar(c) {
    const r = await q(
      `INSERT INTO dbo.candidaturas (vaga_id, plataforma, resultado, modo_teste, motivo, respostas)
       OUTPUT INSERTED.id VALUES (@vaga_id, @plataforma, @resultado, @modo_teste, @motivo, @respostas)`,
      {
        vaga_id: [sql.Int, c.vaga_id],
        plataforma: [sql.NVarChar(30), c.plataforma],
        resultado: [sql.NVarChar(20), c.resultado],
        modo_teste: [sql.Bit, !!c.modo_teste],
        motivo: [sql.NVarChar(500), c.motivo ? String(c.motivo).slice(0, 500) : null],
        respostas: [TEXTO, c.respostas ? JSON.stringify(c.respostas) : null],
      },
    );
    return r.recordset[0].id;
  },
  // contagens a partir de datas UTC calculadas no JS
  async contar({ desde }) {
    const r = await q(
      `SELECT COUNT(*) AS total FROM dbo.candidaturas
       WHERE resultado IN ('enviada','simulada') AND (@desde IS NULL OR criada_em >= @desde)`,
      { desde: [sql.DateTime2, desde || null] },
    );
    return r.recordset[0].total;
  },
};

const agenda = {
  async doDia(data) {
    const r = await q(
      `SELECT id, CONVERT(varchar(10), data, 23) AS data, plataforma, horario, status, resultado, executado_em
       FROM dbo.agenda WHERE data = CAST(@data AS DATE) ORDER BY horario`,
      { data: [sql.VarChar(10), data] },
    );
    return r.recordset;
  },
  async inserirMuitos(data, itens) {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      for (const item of itens) {
        await new sql.Request(tx)
          .input('data', sql.VarChar(10), data)
          .input('plataforma', sql.NVarChar(30), item.plataforma)
          .input('horario', sql.DateTime2, item.horario)
          .query('INSERT INTO dbo.agenda (data, plataforma, horario) VALUES (CAST(@data AS DATE), @plataforma, @horario)');
      }
      await tx.commit();
    } catch (erro) {
      await tx.rollback();
      throw erro;
    }
  },
  async marcar(id, status, resultado) {
    await q(
      `UPDATE dbo.agenda SET status = @status, resultado = @resultado, executado_em = SYSUTCDATETIME() WHERE id = @id`,
      { id: [sql.Int, id], status: [sql.NVarChar(20), status], resultado: [sql.NVarChar(40), resultado || null] },
    );
  },
  async limparPendentes(data) {
    await q(`DELETE FROM dbo.agenda WHERE data = CAST(@data AS DATE) AND status = 'pendente'`, {
      data: [sql.VarChar(10), data],
    });
  },
  async contarExecutados(data, plataforma) {
    const r = await q(
      `SELECT COUNT(*) AS total FROM dbo.agenda
       WHERE data = CAST(@data AS DATE) AND plataforma = @plataforma AND status = 'executado'`,
      { data: [sql.VarChar(10), data], plataforma: [sql.NVarChar(30), plataforma] },
    );
    return r.recordset[0].total;
  },
};

// perguntas: respondidas uma vez no painel, valem para todas as vagas (a IA reconhece variações)
const lerPergunta = (p) => ({ ...p, opcoes: p.opcoes ? JSON.parse(p.opcoes) : [], vagas: p.vagas ? JSON.parse(p.vagas) : [] });

const perguntas = {
  async listar() {
    const r = await q(`SELECT * FROM dbo.perguntas ORDER BY CASE WHEN resposta IS NULL THEN 0 ELSE 1 END, vezes DESC, criada_em DESC`);
    return r.recordset.map(lerPergunta);
  },
  async contarPendentes() {
    const r = await q('SELECT COUNT(*) AS total FROM dbo.perguntas WHERE resposta IS NULL');
    return r.recordset[0].total;
  },
  async respondidas() {
    const r = await q('SELECT pergunta, tipo, resposta FROM dbo.perguntas WHERE resposta IS NOT NULL ORDER BY respondida_em DESC');
    return r.recordset;
  },
  // guarda (ou soma) a pergunta e liga à vaga que está esperando
  async registrar({ pergunta, tipo, opcoes = [], vaga_id }) {
    const chave = chavePergunta(pergunta);
    const atual = (await q('SELECT * FROM dbo.perguntas WHERE chave = @chave', { chave: [sql.NVarChar(400), chave] })).recordset[0];
    if (!atual) {
      await q(`INSERT INTO dbo.perguntas (chave, pergunta, tipo, opcoes, vagas) VALUES (@chave, @pergunta, @tipo, @opcoes, @vagas)`, {
        chave: [sql.NVarChar(400), chave], pergunta: [sql.NVarChar(1000), String(pergunta).slice(0, 1000)],
        tipo: [sql.NVarChar(20), tipo || null], opcoes: [TEXTO, JSON.stringify(opcoes || [])],
        vagas: [TEXTO, JSON.stringify(vaga_id ? [vaga_id] : [])],
      });
      return;
    }
    const lida = lerPergunta(atual);
    const vagasIds = [...new Set([...lida.vagas, ...(vaga_id ? [vaga_id] : [])])];
    // as opções mudam de empresa para empresa: guarda as mais recentes
    await q(`UPDATE dbo.perguntas SET vezes = vezes + 1, vagas = @vagas, opcoes = @opcoes, tipo = @tipo WHERE id = @id`, {
      id: [sql.Int, atual.id], vagas: [TEXTO, JSON.stringify(vagasIds)],
      opcoes: [TEXTO, JSON.stringify(opcoes?.length ? opcoes : lida.opcoes)], tipo: [sql.NVarChar(20), tipo || atual.tipo],
    });
  },
  // salva a resposta e devolve à fila as vagas que só esperavam por ela
  async responder(id, resposta) {
    const r = await q(`UPDATE dbo.perguntas SET resposta = @resposta, respondida_em = SYSUTCDATETIME() OUTPUT INSERTED.* WHERE id = @id`, {
      id: [sql.Int, id], resposta: [TEXTO, resposta],
    });
    const p = r.recordset[0];
    if (!p) return null;
    return { pergunta: lerPergunta(p), liberadas: resposta ? await perguntas.liberarVagas() : 0 };
  },
  // vaga "aguardando" sem pergunta pendente volta para a fila
  async liberarVagas() {
    const pendentes = (await q('SELECT vagas FROM dbo.perguntas WHERE resposta IS NULL')).recordset;
    const presas = new Set(pendentes.flatMap((p) => (p.vagas ? JSON.parse(p.vagas) : [])));
    const aguardando = (await q(`SELECT id FROM dbo.vagas WHERE status = 'aguardando'`)).recordset.map((v) => v.id);
    const livres = aguardando.filter((id) => !presas.has(id));
    for (const id of livres) {
      await q(`UPDATE dbo.vagas SET status = 'na_fila', motivo_status = 'Você respondeu a pergunta: vai tentar de novo' WHERE id = @id`, { id: [sql.Int, id] });
    }
    return livres.length;
  },
  async remover(id) {
    await q('DELETE FROM dbo.perguntas WHERE id = @id', { id: [sql.Int, id] });
    return perguntas.liberarVagas();
  },
};

const processos = {
  async listar(limite = 200) {
    const r = await q(`SELECT TOP (@limite) p.*, CONVERT(varchar(10), p.prazo_data, 23) AS prazo_dia, v.url AS vaga_url FROM dbo.processos p LEFT JOIN dbo.vagas v ON v.id = p.vaga_id
                       ORDER BY p.recebido_em DESC`, { limite: [sql.Int, limite] });
    return r.recordset;
  },
  async idsLidos() {
    const r = await q('SELECT email_id FROM dbo.processos');
    return new Set(r.recordset.map((l) => l.email_id));
  },
  async registrar(p) {
    const r = await q(
      `IF NOT EXISTS (SELECT 1 FROM dbo.processos WHERE email_id = @email_id)
         INSERT INTO dbo.processos (email_id, vaga_id, empresa, vaga_titulo, situacao, resumo, acao, prazo, assunto, recebido_em, link, prazo_data, prazo_hora)
         OUTPUT INSERTED.id
         VALUES (@email_id, @vaga_id, @empresa, @vaga_titulo, @situacao, @resumo, @acao, @prazo, @assunto, @recebido_em, @link, CAST(@prazo_data AS DATE), @prazo_hora);`,
      {
        email_id: [sql.NVarChar(400), String(p.email_id).slice(0, 400)], vaga_id: [sql.Int, p.vaga_id || null],
        empresa: [sql.NVarChar(160), p.empresa ? String(p.empresa).slice(0, 160) : null],
        vaga_titulo: [sql.NVarChar(200), p.vaga_titulo ? String(p.vaga_titulo).slice(0, 200) : null],
        situacao: [sql.NVarChar(30), p.situacao], resumo: [sql.NVarChar(1000), p.resumo ? String(p.resumo).slice(0, 1000) : null],
        acao: [sql.NVarChar(500), p.acao ? String(p.acao).slice(0, 500) : null], prazo: [sql.NVarChar(40), p.prazo ? String(p.prazo).slice(0, 40) : null],
        assunto: [sql.NVarChar(300), p.assunto ? String(p.assunto).slice(0, 300) : null], recebido_em: [sql.DateTime2, new Date(p.recebido_em || Date.now())],
        link: [sql.NVarChar(1000), p.link ? String(p.link).slice(0, 1000) : null],
        prazo_data: [sql.VarChar(10), p.prazo_data || null], prazo_hora: [sql.NVarChar(5), p.prazo_hora || null],
      },
    );
    return r.recordset[0]?.id || null;
  },
  async naoNotificados() {
    const r = await q('SELECT *, CONVERT(varchar(10), prazo_data, 23) AS prazo_dia FROM dbo.processos WHERE notificado = 0 ORDER BY recebido_em');
    return r.recordset;
  },
  async marcarNotificado(id) {
    await q('UPDATE dbo.processos SET notificado = 1 WHERE id = @id', { id: [sql.Int, id] });
  },
  // prazos que vencem na data (AAAA-MM-DD) e ainda não tiveram lembrete
  async lembretesPara(data) {
    const r = await q(`SELECT *, CONVERT(varchar(10), prazo_data, 23) AS prazo_dia FROM dbo.processos
                       WHERE prazo_data = CAST(@data AS DATE) AND lembrete_enviado = 0 AND situacao <> 'reprovado'`, { data: [sql.VarChar(10), data] });
    return r.recordset;
  },
  async marcarLembrete(id) {
    await q('UPDATE dbo.processos SET lembrete_enviado = 1 WHERE id = @id', { id: [sql.Int, id] });
  },
  // para refazer a leitura depois de uma melhoria
  async limpar() { await q('DELETE FROM dbo.processos'); },
};

const eventos = {
  async listar(limite = 50) {
    const r = await q('SELECT TOP (@limite) * FROM dbo.eventos ORDER BY id DESC', { limite: [sql.Int, limite] });
    return r.recordset;
  },
  async registrar(nivel, origem, mensagem) {
    await q('INSERT INTO dbo.eventos (nivel, origem, mensagem) VALUES (@nivel, @origem, @mensagem)', {
      nivel: [sql.NVarChar(10), nivel],
      origem: [sql.NVarChar(40), origem],
      mensagem: [sql.NVarChar(1000), String(mensagem).slice(0, 1000)],
    });
  },
};

module.exports = {
  nome: 'SQL Server',
  iniciar, encerrar, perfil, listas, pessoais, respostas, config, plataformas, vagas, candidaturas, agenda, eventos, perguntas, processos,
};
