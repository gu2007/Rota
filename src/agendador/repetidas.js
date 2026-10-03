// Evita candidatura repetida: a mesma vaga chega por caminhos diferentes (LinkedIn, Gupy, e-mail)
// com links diferentes. Compara o número da vaga na Gupy e o par empresa + cargo.

const { normalizar, limparTitulo } = require('../ia/pontuador');

const gupyId = (url) => (String(url || '').match(/gupy\.io\/jobs\/(\d+)/) || [])[1] || null;
const chave = (v) => `${normalizar(v.empresa).replace(/[^a-z0-9]/g, '')}|${normalizar(limparTitulo(v.titulo)).replace(/[^a-z0-9]/g, '')}`;

// devolve a vaga já candidatada igual a esta, ou null
async function jaCandidatada(repo, vaga) {
  const feitas = await repo.vagas.listar({ status: 'candidatada', limite: 5000 });
  const id = gupyId(vaga.url_candidatura) || gupyId(vaga.url);
  const k = vaga.empresa ? chave(vaga) : null;
  return feitas.find((f) => f.id !== vaga.id && (
    (id && (gupyId(f.url_candidatura) === id || gupyId(f.url) === id)) || (k && f.empresa && chave(f) === k)
  )) || null;
}

module.exports = { jaCandidatada };
