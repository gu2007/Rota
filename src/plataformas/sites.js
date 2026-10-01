// Candidatura em sites de empresas (SmartRecruiters, Greenhouse, Lever...) com o motor da Gupy.
// Não cria conta nem passa CAPTCHA: nesses casos a vaga vai para "Para você".

const gupy = require('./gupy');

async function candidatar(vaga, ctx, opcoes = {}) {
  return gupy.candidatar(vaga, ctx, { ...opcoes, plataforma: 'sites' });
}

module.exports = { tipo: 'candidatura', candidatar };
