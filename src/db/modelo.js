// Campos aceitos em cada parte do perfil. O sql.js só monta queries com estes nomes,
// nunca com texto do navegador: é o que impede SQL injection nas colunas dinâmicas.

const CAMPOS_PERFIL = [
  'nome', 'email', 'telefone', 'cidade', 'linkedin_url', 'github_url',
  'portfolio_url', 'objetivo', 'resumo', 'curriculo_arquivo', 'foto_arquivo',
];

const LISTAS = {
  formacoes:    ['curso', 'instituicao', 'nivel', 'status', 'inicio', 'fim'],
  experiencias: ['cargo', 'empresa', 'inicio', 'fim', 'descricao'],
  projetos:     ['nome', 'descricao', 'tecnologias', 'repo_url', 'demo_url'],
  cursos:       ['nome', 'instituicao', 'carga_horaria', 'concluido_em'],
  habilidades:  ['nome', 'nivel'],
  textos:       ['titulo', 'texto'],   // textos seus que a IA usa como base
};

// o primeiro campo de cada lista é obrigatório (NOT NULL no banco)
const OBRIGATORIO = {
  formacoes: 'curso', experiencias: 'cargo', projetos: 'nome', cursos: 'nome', habilidades: 'nome', textos: 'titulo',
};

const STATUS_VAGA = ['nova', 'na_fila', 'descartada', 'candidatada', 'testada', 'pulada', 'erro', 'aguardando', 'para_voce'];

// só os campos permitidos; string vazia vira null
function filtrar(dados, campos) {
  const saida = {};
  for (const campo of campos) {
    if (dados[campo] === undefined) continue;
    const valor = dados[campo];
    saida[campo] = valor === '' ? null : valor;
  }
  return saida;
}

module.exports = { CAMPOS_PERFIL, LISTAS, OBRIGATORIO, STATUS_VAGA, filtrar };
