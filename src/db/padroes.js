// Valores iniciais, usados pelo init-db e pelo modo demo.
// Depois de mudar, rode "npm run db:init": ele só insere o que ainda não existe.

const PLATAFORMAS = [
  // onde o bot procura vagas
  { codigo: 'gupy_portal', nome: 'Portal Gupy',     tipo: 'coleta',      limite_diario: 5,  ordem: 0 },
  { codigo: 'email',    nome: 'Alertas por e-mail', tipo: 'coleta',      limite_diario: 6,  ordem: 1 },
  { codigo: 'linkedin', nome: 'LinkedIn',           tipo: 'coleta',      limite_diario: 8,  ordem: 2 },
  // onde o bot se candidata
  { codigo: 'gupy',     nome: 'Gupy',               tipo: 'candidatura', limite_diario: 20, ordem: 4 },
  { codigo: 'infojobs', nome: 'InfoJobs',           tipo: 'candidatura', limite_diario: 20, ordem: 5 },
  { codigo: 'sites',    nome: 'Sites das empresas', tipo: 'candidatura', limite_diario: 20, ordem: 6 },
];

// perguntas objetivas comuns. A IA nunca responde estas: se vazia e obrigatória, a vaga é pulada.
const RESPOSTAS_FIXAS = [
  { chave: 'pretensao_salarial', rotulo: 'Pretensão salarial',           ajuda: 'Valor mensal ou "a combinar". Ex.: R$ 1.800 (bolsa)', ordem: 1 },
  { chave: 'modelo_trabalho',    rotulo: 'Modelos de trabalho aceitos',  ajuda: 'Presencial, híbrido e/ou remoto',                     ordem: 2 },
  { chave: 'distancia_maxima',   rotulo: 'Distância / regiões aceitas',  ajuda: 'Ex.: até 1h de deslocamento, zona sul e centro de SP', ordem: 3 },
  { chave: 'disponibilidade',    rotulo: 'Disponibilidade de horário',   ajuda: 'Ex.: 6h/dia no período da manhã',                      ordem: 4 },
  { chave: 'inicio',             rotulo: 'Quando pode começar',          ajuda: 'Ex.: imediato',                                         ordem: 5 },
  { chave: 'ingles',             rotulo: 'Nível de inglês',              ajuda: 'Básico, intermediário, avançado ou fluente',            ordem: 6 },
  { chave: 'cnh',                rotulo: 'CNH',                          ajuda: 'Categoria, ou "não possuo"',                            ordem: 7 },
  { chave: 'semestre_atual',     rotulo: 'Semestre atual da faculdade',  ajuda: 'Ex.: 2º semestre',                                      ordem: 8 },
  { chave: 'previsao_formatura', rotulo: 'Previsão de formatura',        ajuda: 'Mês/ano. Ex.: 12/2029',                                 ordem: 9 },
  { chave: 'como_soube',         rotulo: 'Como soube da vaga',           ajuda: 'Resposta padrão. Ex.: LinkedIn',                        ordem: 10 },
  { chave: 'cargo_atual',        rotulo: 'Cargo / ocupação atual',       ajuda: 'Ex.: Entregador autônomo',                              ordem: 11 },
  { chave: 'remuneracao_atual',  rotulo: 'Remuneração atual ou última',  ajuda: 'Valor mensal. Diferente da pretensão salarial',         ordem: 12 },
  { chave: 'beneficios_atuais',  rotulo: 'Benefícios atuais ou últimos', ajuda: 'Ex.: Não possuo',                                       ordem: 13 },
  { chave: 'conhece_empresa',    rotulo: 'Já conhecia a empresa?',       ajuda: 'Ex.: Sim', resposta: 'Sim',                               ordem: 14 },
  { chave: 'indicacao',          rotulo: 'Foi indicado por alguém?',     ajuda: 'Ex.: Não (indicações você faz à mão)', resposta: 'Não',    ordem: 15 },
  { chave: 'coeficiente',        rotulo: 'CR / média na faculdade',      ajuda: 'Ex.: 8,5 (se ainda não tem nota, deixe vazio)',        ordem: 16 },
  { chave: 'grade_horaria',      rotulo: 'Grade horária das aulas',      ajuda: 'Ex.: Aulas de segunda a sexta, das 19h às 22h40 (noturno)', ordem: 17 },
  { chave: 'genero',             rotulo: 'Gênero (só se a vaga pedir)',  ajuda: 'Opcional. Vazio = "Prefiro não informar" quando existir', ordem: 19 },
  { chave: 'habilidades_destaque', rotulo: 'Habilidades para destacar na Gupy (até 3)', ajuda: 'Como aparecem no seu currículo da Gupy. Ex.: Node.js; Oracle Cloud Infrastructure; Linux', ordem: 18 },
  // declarações de compliance usadas pela IA em perguntas de conflito de interesse
  { chave: 'decl_vinculos',      rotulo: 'Parentes/amigos próximos trabalhando nas empresas?', ajuda: 'Ex.: Não tenho vínculo pessoal com colaboradores de empresas em que me candidato', ordem: 20 },
  { chave: 'decl_ex_funcionario',rotulo: 'Já trabalhou nas empresas em que se candidata?',   ajuda: 'Ex.: Não, nunca trabalhei nelas', ordem: 21 },
  { chave: 'decl_pep',           rotulo: 'Você ou parente é agente público / pessoa politicamente exposta?', ajuda: 'Ex.: Não', ordem: 22 },
  { chave: 'decl_atividades',    rotulo: 'Outras atividades remuneradas / vínculos com empresas', ajuda: 'Ex.: Sim, sou entregador autônomo por aplicativos e faço projetos freelance', ordem: 23 },
  { chave: 'decl_sociedade',     rotulo: 'Sócio ou dono de empresa / participação em fundos?', ajuda: 'Ex.: Não sou sócio de nenhuma empresa', ordem: 24 },
  { chave: 'decl_conflito',      rotulo: 'Algum conflito de interesses a declarar?',          ajuda: 'Ex.: Não tenho', ordem: 25 },
];

// tudo é guardado como texto (chave/valor); o código converte ao ler
const CONFIGURACOES = {
  modo_teste: 'true',                // true = faz tudo, menos clicar em "enviar"
  nota_minima: '70',                 // 0 a 100
  janela_inicio: '08:00',
  janela_fim: '22:00',
  termos_busca: 'estágio desenvolvedor; estágio desenvolvimento; estágio programação; estágio back-end; estágio TI; estágio tecnologia; estágio software; estágio sistemas; estágio dados',
  termos_excluir: 'sênior; senior; pleno; especialista; coordenador',
  localizacao: 'São Paulo, SP',
  modelos_aceitos: 'presencial; hibrido; remoto',
  incluir_afirmativas: 'false',      // vagas reservadas a um grupo (pessoas negras, mulheres, PcD...)
  velocidade: 'rapida',               // rapida | humana (pausas e digitação de pessoa)
};

// dados pessoais ficam criptografados (tabela dados_pessoais); o painel só mostra o final
const DADOS_PESSOAIS = [
  { chave: 'cpf', rotulo: 'CPF', ajuda: '000.000.000-00' },
  { chave: 'rg', rotulo: 'RG', ajuda: 'Número do RG' },
  { chave: 'data_nascimento', rotulo: 'Data de nascimento', ajuda: 'DD/MM/AAAA' },
  { chave: 'cep', rotulo: 'CEP', ajuda: '00000-000' },
  { chave: 'logradouro', rotulo: 'Endereço (rua/avenida)', ajuda: 'Rua Exemplo' },
  { chave: 'numero', rotulo: 'Número', ajuda: '123' },
  { chave: 'complemento', rotulo: 'Complemento', ajuda: 'Apto 12 (se tiver)' },
  { chave: 'bairro', rotulo: 'Bairro', ajuda: '' },
  { chave: 'estado', rotulo: 'Estado', ajuda: 'São Paulo' },
  { chave: 'nacionalidade', rotulo: 'Nacionalidade', ajuda: 'Brasileira' },
  { chave: 'estado_civil', rotulo: 'Estado civil', ajuda: 'Solteiro' },
];

module.exports = { PLATAFORMAS, RESPOSTAS_FIXAS, CONFIGURACOES, DADOS_PESSOAIS };
