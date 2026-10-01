// Leva o banco inteiro de um lugar para outro (ex.: SQL Server do PC -> PostgreSQL do servidor).
// O arquivo sai cifrado com a ROTA_CHAVE; os dados pessoais continuam cifrados como estão no banco.
//   Origem:  npm run dados:exportar   -> gera dados/banco.cofre
//   Destino: npm run dados:importar   (mesma ROTA_CHAVE; substitui o que houver no banco de destino)
const fs = require('fs');
const path = require('path');
const { ambiente } = require('../src/config');
const cofre = require('../src/util/cofre');

const ARQUIVO = path.join(__dirname, '..', 'dados', 'banco.cofre');

// ordem respeita as chaves estrangeiras (candidaturas depende de vagas)
const TABELAS = [
  'perfil', 'formacoes', 'experiencias', 'projetos', 'cursos', 'habilidades', 'textos',
  'respostas_fixas', 'configuracoes', 'plataformas', 'vagas', 'candidaturas', 'agenda',
  'eventos', 'dados_pessoais', 'perguntas', 'processos',
];

async function conectar() {
  const b = ambiente.banco;
  if (b.tipo === 'postgres') {
    const { Pool, types } = require('pg');
    types.setTypeParser(1082, (v) => v); // DATE fica como texto, sem fuso no meio
    const pool = new Pool({ host: b.server, port: b.port, database: b.database, user: b.user, password: b.password, max: 2 });
    return {
      ler: async (t) => (await pool.query(`SELECT * FROM ${t}`)).rows,
      pool,
      fechar: () => pool.end(),
    };
  }
  const sql = require('mssql');
  const pool = await new sql.ConnectionPool({
    server: b.server, port: b.port, database: b.database, user: b.user, password: b.password,
    options: { encrypt: b.encrypt, trustServerCertificate: b.trustCert },
  }).connect();
  return {
    ler: async (t) => (await pool.request().query(`SELECT * FROM dbo.${t}`)).recordset,
    fechar: () => pool.close(),
  };
}

async function exportar() {
  const db = await conectar();
  const tabelas = {};
  for (const t of TABELAS) {
    try { tabelas[t] = await db.ler(t); } catch (e) { console.log(`  ${t}: não existe na origem (${e.message.split('\n')[0]})`); }
  }
  await db.fechar();
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  fs.writeFileSync(ARQUIVO, cofre.cifrar(JSON.stringify({ versao: 1, criado: new Date().toISOString(), tabelas })));
  console.log();
  for (const [t, linhas] of Object.entries(tabelas)) console.log(`  ${t.padEnd(16)} ${linhas.length}`);
  console.log(`\n  Arquivo: ${ARQUIVO} (cifrado com a sua ROTA_CHAVE)\n`);
}

async function importar() {
  if (ambiente.banco.tipo !== 'postgres') throw new Error('A importação é para o servidor (DB_TIPO=postgres).');
  if (!fs.existsSync(ARQUIVO)) throw new Error(`Não achei ${ARQUIVO}. Copie o arquivo para cá antes.`);
  let pacote;
  try { pacote = JSON.parse(cofre.decifrar(fs.readFileSync(ARQUIVO, 'utf8'))); } catch {
    throw new Error('Não consegui abrir o arquivo: a ROTA_CHAVE deste .env é diferente da usada na exportação.');
  }

  const db = await conectar();
  const cliente = await db.pool.connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query(`TRUNCATE ${TABELAS.join(', ')} RESTART IDENTITY CASCADE`);
    console.log();
    for (const t of TABELAS) {
      const linhas = pacote.tabelas[t] || [];
      const info = (await cliente.query(
        'SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1', [t],
      )).rows;
      const colunas = info.map((r) => r.column_name);
      const datas = info.filter((r) => r.data_type === 'date').map((r) => r.column_name);
      for (const linha of linhas) {
        const cols = Object.keys(linha).filter((c) => colunas.includes(c));
        const valores = cols.map((c) => (datas.includes(c) && linha[c] ? String(linha[c]).slice(0, 10) : linha[c]));
        await cliente.query(
          `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
          valores,
        );
      }
      // o próximo id continua depois do maior importado
      if (colunas.includes('id') && t !== 'perfil') {
        await cliente.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 0) + 1, false)`);
      }
      console.log(`  ${t.padEnd(16)} ${linhas.length}`);
    }
    await cliente.query('COMMIT');
  } catch (e) {
    await cliente.query('ROLLBACK');
    throw e;
  } finally {
    cliente.release();
    await db.fechar();
  }
  fs.rmSync(ARQUIVO);
  console.log(`\n  Banco importado (exportado em ${new Date(pacote.criado).toLocaleString('pt-BR')}).`);
  console.log('  O arquivo de transferência foi apagado.\n');
}

const acao = process.argv[2];
const passos = { exportar, importar };
if (!passos[acao]) {
  console.log('Uso: node scripts/dados.js exportar | importar');
  process.exit(1);
}
passos[acao]().catch((e) => { console.error('\nErro:', e.message, '\n'); process.exit(1); });
