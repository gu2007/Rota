// Ponto de entrada: sobe o painel (Express) e liga o executor.
// npm start usa o banco do .env (SQL Server ou PostgreSQL); npm run demo usa dados em memória.

const path = require('path');
const express = require('express');
const { ambiente } = require('./config');
const { criarApi } = require('./rotas/api');
const { criarExecutor } = require('./agendador/executor');

async function main() {
  const repo = require('./db').repo();
  await repo.iniciar(ambiente.banco);

  const app = express();
  app.use('/api', criarApi(repo, { demo: ambiente.demo }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // no demo nada acessa a internet: os módulos das plataformas ficam desligados
  const executor = criarExecutor(repo, ambiente.demo ? { modulos: {} } : {});
  executor.iniciar();

  // só escuta em localhost para não expor o painel na rede
  const servidor = app.listen(ambiente.porta, '127.0.0.1', () => {
    console.log(`\n  Rota rodando em http://localhost:${ambiente.porta}`);
    console.log(`  Banco: ${repo.nome}${ambiente.demo ? '  (nada é salvo)' : ''}\n`);
  });

  const desligar = async () => {
    executor.parar();
    servidor.close();
    await repo.encerrar();
    process.exit(0);
  };
  process.on('SIGINT', desligar);
  process.on('SIGTERM', desligar);
}

main().catch((erro) => {
  console.error('\nNão foi possível iniciar o Rota:', erro.message);
  if (!ambiente.demo) console.error('Confira o .env e se o banco está rodando. Para testar sem banco: npm run demo\n');
  process.exit(1);
});
