// InfoJobs usa o mesmo motor da Gupy; se pedir login, a vaga vai para "Para você".
const gupy = require('./gupy');

async function candidatar(vaga, ctx, opcoes = {}) {
  return gupy.candidatar(vaga, ctx, { ...opcoes, plataforma: 'infojobs' });
}

module.exports = { tipo: 'candidatura', candidatar };
