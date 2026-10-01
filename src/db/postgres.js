// Repositório PostgreSQL (servidor ARM da Oracle, onde o SQL Server não roda).
// Mesmas funções do sql.js: o resto do sistema não sabe qual banco está usando.

const { Pool } = require('pg');
const { CAMPOS_PERFIL, LISTAS, OBRIGATORIO, filtrar } = require('./modelo');
const { DADOS_PESSOAIS } = require('./padroes');
const cofre = require('../util/cofre');
const { chavePergunta } = require('../candidatura/aprendizado');

let pool;

async function iniciar(cfg) {
  pool = new Pool({
    host: cfg.server, port: cfg.port, database: cfg.database, user: cfg.user, password: cfg.password, max: 5,
  });
  await pool.query('SELECT 1');
}

async function encerrar() {
  if (pool) await pool.end();
}

const q = (texto, params = []) => pool.query(texto, params);
const um = async (texto, params) => (await q(texto, params)).rows[0] || null;
const corta = (v, n) => (v == null ? null : String(v).slice(0, n));

const perfil = {
  async obter() {
    return (await um('SELECT * FROM perfil WHERE id = 1')) || { id: 1 };
  },
  async salvar(dados) {
    const campos = filtrar(dados, CAMPOS_PERFIL);
    const nomes = Object.keys(campos);
    await q('INSERT INTO perfil (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
    if (nomes.length) {
      const sets = nomes.map((n, i) => `${n} = $${i + 1}`).concat('atualizado_em = now()');
      await q(`UPDATE perfil SET ${sets.join(', ')} WHERE id = 1`, nomes.map((n) => campos[n]));
    }
    return perfil.obter();
  },
};

function checarLista(nome) {
  if (!LISTAS[nome]) throw Object.assign(new Error(`Lista desconhecida: ${nome}`), { status: 404 });
  return LISTAS[nome];
}
const valorLista = (n, v) => (n === 'carga_horaria' && v != null ? Number(v) : v);

const listas = {
  async listar(nome) {
    checarLista(nome);
    return (await q(`SELECT * FROM ${nome} ORDER BY id`)).rows;
  },
  async criar(nome, dados) {
    const campos = filtrar(dados, checarLista(nome));
    if (!campos[OBRIGATORIO[nome]]) {
      throw Object.assign(new Error(`O campo "${OBRIGATORIO[nome]}" é obrigatório`), { status: 400 });
    }
    const nomes = Object.keys(campos);
    return um(
      `INSERT INTO ${nome} (${nomes.join(', ')}) VALUES (${nomes.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
      nomes.map((n) => valorLista(n, campos[n])),
    );
  },
  async atualizar(nome, id, dados) {
    const campos = filtrar(dados, checarLista(nome));
    const nomes = Object.keys(campos);
    if (!nomes.length) return null;
    return um(
      `UPDATE ${nome} SET ${nomes.map((n, i) => `${n} = $${i + 1}`).join(', ')} WHERE id = $${nomes.length + 1} RETURNING *`,
      [...nomes.map((n) => valorLista(n, campos[n])), id],
    );
  },
  async remover(nome, id) {
    checarLista(nome);
    await q(`DELETE FROM ${nome} WHERE id = $1`, [id]);
  },
};

const CHAVES_PESSOAIS = DADOS_PESSOAIS.map((d) => d.chave);
const pessoais = {
  // para o bot, tudo decifrado; nunca mandar isso para o navegador
  async obterTodos() {
    const saida = {};
    for (const l of (await q('SELECT chave, valor_cifrado FROM dados_pessoais')).rows) {
      try { saida[l.chave] = cofre.decifrar(l.valor_cifrado); } catch { /* chave errada/ausente */ }
    }
    return saida;
  },
  async salvar(valores) {
    for (const [chave, valor] of Object.entries(valores)) {
      if (!CHAVES_PESSOAIS.includes(chave)) continue;
      if (valor === null) { await q('DELETE FROM dados_pessoais WHERE chave = $1', [chave]); continue; }
      if (!String(valor).trim()) continue;
      await q(
        `INSERT INTO dados_pessoais (chave, valor_cifrado) VALUES ($1, $2)
         ON CONFLICT (chave) DO UPDATE SET valor_cifrado = EXCLUDED.valor_cifrado, atualizado_em = now()`,
        [chave, cofre.cifrar(String(valor).trim())],
      );
    }
  },
};

const respostas = {
  async listar() {
    return (await q('SELECT * FROM respostas_fixas ORDER BY ordem, chave')).rows;
  },
  async salvar(lista) {
    for (const { chave, resposta } of lista) {
      await q('UPDATE respostas_fixas SET resposta = $2 WHERE chave = $1', [chave, resposta === '' ? null : corta(resposta, 500)]);
    }
    return respostas.listar();
  },
};

const config = {
  async obter() {
    return Object.fromEntries((await q('SELECT chave, valor FROM configuracoes')).rows.map((l) => [l.chave, l.valor]));
  },
  async salvar(valores) {
    for (const [chave, valor] of Object.entries(valores)) {
      await q(
        `INSERT INTO configuracoes (chave, valor) VALUES ($1, $2)
         ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
        [chave, valor == null ? null : corta(valor, 1000)],
      );
    }
    return config.obter();
  },
};

const plataformas = {
  async listar() {
    return (await q('SELECT * FROM plataformas ORDER BY ordem')).rows;
  },
  async atualizar(codigo, dados) {
    const sets = [];
    const params = [codigo];
    const p = (v) => { params.push(v); return `$${params.length}`; };
    if (dados.ativa !== undefined) sets.push(`ativa = ${p(!!dados.ativa)}`);
    if (dados.limite_diario !== undefined) sets.push(`limite_diario = ${p(Math.max(0, Math.min(100, Number(dados.limite_diario) || 0)))}`);
    if (dados.pausada_ate !== undefined) {
      sets.push(`pausada_ate = ${p(dados.pausada_ate ? new Date(dados.pausada_ate) : null)}`);
      sets.push(`motivo_pausa = ${p(dados.motivo_pausa || null)}`);
    }
    if (!sets.length) return null;
    return um(`UPDATE plataformas SET ${sets.join(', ')} WHERE codigo = $1 RETURNING *`, params);
  },
};

const COLUNAS_VAGA = `id, url, url_candidatura, origem_plataforma, origem_coleta, plataforma_envio,
  titulo, empresa, local, modelo, nota, justificativa, status, motivo_status, coletada_em`;

const vagas = {
  async listar({ status, q: busca, limite = 200 } = {}) {
    return (await q(
      `SELECT ${COLUNAS_VAGA} FROM vagas
       WHERE ($1::text IS NULL OR status = $1)
         AND ($2::text IS NULL OR titulo ILIKE $2 OR empresa ILIKE $2)
       ORDER BY coletada_em DESC LIMIT $3`,
      [status || null, busca ? `%${busca}%` : null, limite],
    )).rows;
  },
  async obter(id) {
    return um('SELECT * FROM vagas WHERE id = $1', [id]);
  },
  // insere só se a URL ainda não existe; retorna { id, nova }
  async inserir(v) {
    const nova = await um(
      `INSERT INTO vagas (url, url_candidatura, origem_plataforma, origem_coleta, plataforma_envio,
                          titulo, empresa, local, modelo, descricao, nota, justificativa, status, motivo_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (url) DO NOTHING RETURNING id`,
      [v.url, v.url_candidatura || null, v.origem_plataforma, v.origem_coleta, v.plataforma_envio || null,
        corta(v.titulo, 200), corta(v.empresa || null, 160), corta(v.local || null, 120), corta(v.modelo || null, 30),
        v.descricao || null, v.nota ?? null, corta(v.justificativa || null, 1000), v.status || 'nova', corta(v.motivo_status || null, 300)],
    );
    if (nova) return { id: nova.id, nova: true };
    return { id: (await um('SELECT id FROM vagas WHERE url = $1', [v.url])).id, nova: false };
  },
  async atualizar(id, dados) {
    const permitidos = ['status', 'motivo_status', 'nota', 'justificativa', 'plataforma_envio', 'url_candidatura',
      'titulo', 'empresa', 'local', 'modelo', 'descricao'];
    const limites = { motivo_status: 300, justificativa: 1000, url_candidatura: 1000, titulo: 200, empresa: 160, local: 120, modelo: 30 };
    const params = [id];
    const sets = [];
    for (const campo of permitidos) {
      if (dados[campo] === undefined) continue;
      const valor = limites[campo] && typeof dados[campo] === 'string' ? dados[campo].slice(0, limites[campo]) : dados[campo];
      params.push(valor);
      sets.push(`${campo} = $${params.length}`);
    }
    if (!sets.length) return vagas.obter(id);
    return um(`UPDATE vagas SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
  },
  async buscarPorUrl(url, excetoId = 0) {
    return um('SELECT id, status, titulo, empresa FROM vagas WHERE id <> $1 AND (url = $2 OR url_candidatura = $2) LIMIT 1', [excetoId, url]);
  },
  async proximaDaFila(plataforma, notaMinima, { incluirTestadas = false } = {}) {
    return um(
      `SELECT * FROM vagas
       WHERE (status = 'na_fila' OR ($3 AND status = 'testada')) AND plataforma_envio = $1 AND nota >= $2
       ORDER BY CASE WHEN status = 'na_fila' THEN 0 ELSE 1 END, nota DESC, coletada_em ASC LIMIT 1`,
      [plataforma, notaMinima, !!incluirTestadas],
    );
  },
  async contarPorStatus() {
    const r = await q('SELECT status, COUNT(*)::int AS total FROM vagas GROUP BY status');
    return Object.fromEntries(r.rows.map((l) => [l.status, l.total]));
  },
};

const candidaturas = {
  async listar({ limite = 200 } = {}) {
    const r = await q(
      `SELECT c.*, v.titulo, v.empresa, v.url, v.nota FROM candidaturas c JOIN vagas v ON v.id = c.vaga_id
       ORDER BY c.criada_em DESC LIMIT $1`, [limite],
    );
    return r.rows.map((c) => ({ ...c, respostas: c.respostas ? JSON.parse(c.respostas) : [] }));
  },
  async registrar(c) {
    const r = await um(
      `INSERT INTO candidaturas (vaga_id, plataforma, resultado, modo_teste, motivo, respostas)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [c.vaga_id, c.plataforma, c.resultado, !!c.modo_teste, corta(c.motivo || null, 500), c.respostas ? JSON.stringify(c.respostas) : null],
    );
    return r.id;
  },
  async contar({ desde }) {
    const r = await um(
      `SELECT COUNT(*)::int AS total FROM candidaturas
       WHERE resultado IN ('enviada','simulada') AND ($1::timestamptz IS NULL OR criada_em >= $1)`, [desde || null],
    );
    return r.total;
  },
};

const agenda = {
  async doDia(data) {
    return (await q(
      `SELECT id, to_char(data, 'YYYY-MM-DD') AS data, plataforma, horario, status, resultado, executado_em
       FROM agenda WHERE data = $1::date ORDER BY horario`, [data],
    )).rows;
  },
  async inserirMuitos(data, itens) {
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      for (const item of itens) {
        await cliente.query('INSERT INTO agenda (data, plataforma, horario) VALUES ($1::date, $2, $3)', [data, item.plataforma, item.horario]);
      }
      await cliente.query('COMMIT');
    } catch (erro) {
      await cliente.query('ROLLBACK');
      throw erro;
    } finally {
      cliente.release();
    }
  },
  async marcar(id, status, resultado) {
    await q('UPDATE agenda SET status = $2, resultado = $3, executado_em = now() WHERE id = $1', [id, status, corta(resultado || null, 40)]);
  },
  async limparPendentes(data) {
    await q(`DELETE FROM agenda WHERE data = $1::date AND status = 'pendente'`, [data]);
  },
  async contarExecutados(data, plataforma) {
    const r = await um(
      `SELECT COUNT(*)::int AS total FROM agenda WHERE data = $1::date AND plataforma = $2 AND status = 'executado'`, [data, plataforma],
    );
    return r.total;
  },
};

const lerPergunta = (p) => ({ ...p, opcoes: p.opcoes ? JSON.parse(p.opcoes) : [], vagas: p.vagas ? JSON.parse(p.vagas) : [] });

const perguntas = {
  async listar() {
    const r = await q('SELECT * FROM perguntas ORDER BY CASE WHEN resposta IS NULL THEN 0 ELSE 1 END, vezes DESC, criada_em DESC');
    return r.rows.map(lerPergunta);
  },
  async contarPendentes() {
    return (await um('SELECT COUNT(*)::int AS total FROM perguntas WHERE resposta IS NULL')).total;
  },
  async respondidas() {
    return (await q('SELECT pergunta, tipo, resposta FROM perguntas WHERE resposta IS NOT NULL ORDER BY respondida_em DESC')).rows;
  },
  async registrar({ pergunta, tipo, opcoes = [], vaga_id }) {
    const chave = chavePergunta(pergunta);
    const atual = await um('SELECT * FROM perguntas WHERE chave = $1', [chave]);
    if (!atual) {
      await q('INSERT INTO perguntas (chave, pergunta, tipo, opcoes, vagas) VALUES ($1, $2, $3, $4, $5)',
        [chave, corta(pergunta, 1000), tipo || null, JSON.stringify(opcoes || []), JSON.stringify(vaga_id ? [vaga_id] : [])]);
      return;
    }
    const lida = lerPergunta(atual);
    const vagasIds = [...new Set([...lida.vagas, ...(vaga_id ? [vaga_id] : [])])];
    await q('UPDATE perguntas SET vezes = vezes + 1, vagas = $2, opcoes = $3, tipo = $4 WHERE id = $1',
      [atual.id, JSON.stringify(vagasIds), JSON.stringify(opcoes?.length ? opcoes : lida.opcoes), tipo || atual.tipo]);
  },
  async responder(id, resposta) {
    const p = await um('UPDATE perguntas SET resposta = $2, respondida_em = now() WHERE id = $1 RETURNING *', [id, resposta]);
    if (!p) return null;
    return { pergunta: lerPergunta(p), liberadas: resposta ? await perguntas.liberarVagas() : 0 };
  },
  async liberarVagas() {
    const pendentes = (await q('SELECT vagas FROM perguntas WHERE resposta IS NULL')).rows;
    const presas = new Set(pendentes.flatMap((p) => (p.vagas ? JSON.parse(p.vagas) : [])));
    const aguardando = (await q(`SELECT id FROM vagas WHERE status = 'aguardando'`)).rows.map((v) => v.id);
    const livres = aguardando.filter((id) => !presas.has(id));
    for (const id of livres) {
      await q(`UPDATE vagas SET status = 'na_fila', motivo_status = 'Você respondeu a pergunta: vai tentar de novo' WHERE id = $1`, [id]);
    }
    return livres.length;
  },
  async remover(id) {
    await q('DELETE FROM perguntas WHERE id = $1', [id]);
    return perguntas.liberarVagas();
  },
};

const COLUNAS_PROCESSO = `p.*, to_char(p.prazo_data, 'YYYY-MM-DD') AS prazo_dia`;

const processos = {
  async listar(limite = 200) {
    return (await q(
      `SELECT ${COLUNAS_PROCESSO}, v.url AS vaga_url FROM processos p LEFT JOIN vagas v ON v.id = p.vaga_id
       ORDER BY p.recebido_em DESC LIMIT $1`, [limite],
    )).rows;
  },
  async idsLidos() {
    return new Set((await q('SELECT email_id FROM processos')).rows.map((l) => l.email_id));
  },
  async registrar(p) {
    const r = await um(
      `INSERT INTO processos (email_id, vaga_id, empresa, vaga_titulo, situacao, resumo, acao, prazo, assunto, recebido_em, link, prazo_data, prazo_hora)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::date, $13)
       ON CONFLICT (email_id) DO NOTHING RETURNING id`,
      [corta(p.email_id, 400), p.vaga_id || null, corta(p.empresa, 160), corta(p.vaga_titulo, 200), p.situacao, corta(p.resumo, 1000),
        corta(p.acao, 500), corta(p.prazo, 40), corta(p.assunto, 300), new Date(p.recebido_em || Date.now()), corta(p.link, 1000),
        p.prazo_data || null, p.prazo_hora || null],
    );
    return r?.id || null;
  },
  async naoNotificados() {
    return (await q(`SELECT ${COLUNAS_PROCESSO} FROM processos p WHERE notificado = FALSE ORDER BY recebido_em`)).rows;
  },
  async marcarNotificado(id) {
    await q('UPDATE processos SET notificado = TRUE WHERE id = $1', [id]);
  },
  async lembretesPara(data) {
    return (await q(
      `SELECT ${COLUNAS_PROCESSO} FROM processos p
       WHERE prazo_data = $1::date AND lembrete_enviado = FALSE AND situacao <> 'reprovado'`, [data],
    )).rows;
  },
  async marcarLembrete(id) {
    await q('UPDATE processos SET lembrete_enviado = TRUE WHERE id = $1', [id]);
  },
  async limpar() { await q('DELETE FROM processos'); },
};

const eventos = {
  async listar(limite = 50) {
    return (await q('SELECT * FROM eventos ORDER BY id DESC LIMIT $1', [limite])).rows;
  },
  async registrar(nivel, origem, mensagem) {
    await q('INSERT INTO eventos (nivel, origem, mensagem) VALUES ($1, $2, $3)', [nivel, origem, corta(mensagem, 1000)]);
  },
};

module.exports = {
  nome: 'PostgreSQL',
  iniciar, encerrar, perfil, listas, pessoais, respostas, config, plataformas, vagas, candidaturas, agenda, eventos, perguntas, processos,
  pool: () => pool,
};
