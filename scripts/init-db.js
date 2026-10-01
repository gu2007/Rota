// Cria o banco, as tabelas e os valores iniciais. Pode rodar de novo: não apaga nada.
// npm run db:init

const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const { ambiente } = require('../src/config');
const { PLATAFORMAS, RESPOSTAS_FIXAS, CONFIGURACOES } = require('../src/db/padroes');
const { gerarChave } = require('../src/util/cofre');

const b = ambiente.banco;
const conexao = (database) => ({
  server: b.server, port: b.port, user: b.user, password: b.password, database,
  options: { encrypt: b.encrypt, trustServerCertificate: b.trustCert },
});

async function main() {
  if (!b.server) throw new Error('DB_SERVER não definido no .env');

  // chave do cofre: gerada uma única vez
  if (!process.env.ROTA_CHAVE) {
    const arquivoEnv = path.join(__dirname, '..', '.env');
    fs.appendFileSync(arquivoEnv, `\n# Chave do cofre de dados pessoais. NÃO compartilhe e NÃO apague (sem ela os dados não abrem).\nROTA_CHAVE=${gerarChave()}\n`);
    console.log('✓ chave do cofre criada no .env (ROTA_CHAVE)');
  }

  // CREATE DATABASE precisa rodar conectado no master
  const master = await new sql.ConnectionPool(conexao('master')).connect();
  await master.request()
    .input('nome', sql.NVarChar, b.database)
    .query(`IF DB_ID(@nome) IS NULL EXEC('CREATE DATABASE [' + @nome + ']')`);
  await master.close();
  console.log(`✓ banco ${b.database}`);

  // GO não é SQL, é separador do SSMS: o schema roda bloco a bloco
  const pool = await new sql.ConnectionPool(conexao(b.database)).connect();
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  const blocos = schema.split(/^\s*GO\s*$/im).map((s) => s.trim()).filter((s) => s.replace(/--.*$/gm, '').trim());
  for (const bloco of blocos) await pool.request().query(bloco);
  console.log(`✓ tabelas (${blocos.length} blocos)`);

  await pool.request().query('IF NOT EXISTS (SELECT 1 FROM dbo.perfil) INSERT INTO dbo.perfil (id) VALUES (1)');

  for (const p of PLATAFORMAS) {
    await pool.request()
      .input('codigo', sql.NVarChar(30), p.codigo)
      .input('nome', sql.NVarChar(80), p.nome)
      .input('tipo', sql.NVarChar(20), p.tipo)
      .input('limite', sql.Int, p.limite_diario)
      .input('ordem', sql.Int, p.ordem)
      .query(`IF NOT EXISTS (SELECT 1 FROM dbo.plataformas WHERE codigo = @codigo)
              INSERT INTO dbo.plataformas (codigo, nome, tipo, limite_diario, ordem) VALUES (@codigo, @nome, @tipo, @limite, @ordem)`);
  }

  for (const r of RESPOSTAS_FIXAS) {
    await pool.request()
      .input('chave', sql.NVarChar(60), r.chave)
      .input('rotulo', sql.NVarChar(160), r.rotulo)
      .input('ajuda', sql.NVarChar(300), r.ajuda)
      .input('ordem', sql.Int, r.ordem)
      .input('resposta', sql.NVarChar(500), r.resposta || null)
      .query(`IF NOT EXISTS (SELECT 1 FROM dbo.respostas_fixas WHERE chave = @chave)
              INSERT INTO dbo.respostas_fixas (chave, rotulo, ajuda, ordem, resposta) VALUES (@chave, @rotulo, @ajuda, @ordem, @resposta)`);
  }

  for (const [chave, valor] of Object.entries(CONFIGURACOES)) {
    await pool.request()
      .input('chave', sql.NVarChar(60), chave)
      .input('valor', sql.NVarChar(1000), valor)
      .query(`IF NOT EXISTS (SELECT 1 FROM dbo.configuracoes WHERE chave = @chave)
              INSERT INTO dbo.configuracoes (chave, valor) VALUES (@chave, @valor)`);
  }
  console.log('✓ valores iniciais (plataformas, respostas fixas, configurações)');

  await pool.close();
  console.log('\nPronto. Agora rode: npm start\n');
}

main().catch((e) => {
  console.error('\n✗ Erro ao preparar o banco:', e.message, '\n');
  process.exit(1);
});
