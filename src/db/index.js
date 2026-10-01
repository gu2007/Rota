// Escolhe o repositório pelo .env: demo (memória), SQL Server ou PostgreSQL.
const { ambiente } = require('../config');

function repo() {
  if (ambiente.demo) return require('./demo');
  return ambiente.banco.tipo === 'postgres' ? require('./postgres') : require('./sql');
}

module.exports = { repo };
