// Contrato dos módulos de plataforma.
// Coleta: coletar(ctx) -> vagas. Candidatura: candidatar(vaga, ctx) -> { resultado, motivo?, respostas? }.
// Módulo ainda não construído lança ModuloPendente; o agendador só registra, sem gastar vaga.

class ModuloPendente extends Error {
  constructor(plataforma) {
    super(`Módulo "${plataforma}" ainda não foi construído`);
    this.name = 'ModuloPendente';
  }
}

module.exports = { ModuloPendente };
