// Pontua vagas de 0 a 100 por regras, sem IA: área pelo título (a descrição engana:
// "programação de obras" não é programação), nível, palavras da busca, modelo e cidade.

const normalizar = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

const TI_TITULO = /(^|[^a-z])(ti|t\.i\.|tecnologia|desenvolv\w*|programacao|programador\w*|software|sistemas|dev|developer|back-?end|front-?end|full-?stack|dados|data|analytics|bi|node(\.js)?|javascript|typescript|python|java|c#|\.net|php|react|cloud|devops|infraestrutura|qa|testes? de software|seguranca da informacao|ciberseguranca|low-?code|computacao|web|mobile|suporte tecnico|help ?desk|banco de dados|sql)([^a-z]|$)/;
// Vencem mesmo se o título citar outra área ("Dev para time de Marketing")
const TI_FORTE = /(^|[^a-z])(desenvolv\w*|software|programador\w*|dev|developer|back-?end|front-?end|full-?stack|ti)([^a-z]|$)/;
const AREA_FORA = /engenharia (civil|mecanica|eletrica|quimica|de producao|ambiental|agronomica|de alimentos|naval|metalurgica|de materiais)|arquitetura e urbanismo|edificacoes|obras|administrativ|contab|juridic|direito|recursos humanos|(^|[^a-z])rh([^a-z]|$)|departamento pessoal|marketing|vendas|comercial|financeir|logistic|compras|enfermagem|farmacia|nutricao|pedagogia|psicologia|eletrotecnica|eletronica|mecanica|atendimento ao cliente|operac(oes|ao)|operations|estrategia|strategy|pricing|precific|receita|credit|credito|casualty|seguros|economic|economia|agro|p&d|pesquisa e desenvolvimento|quimic|laboratorio|produtos?( |$)|projetos?( |$)|corporate desk|informacoes gerenciais|reporting|monetization|sac( |$)|atendimento tecnico|field service/;
// Suporte e infraestrutura: é TI, mas não é desenvolvimento (só com o ajuste ligado)
const SUPORTE = /suporte|support|help ?desk|service ?desk|sustentacao|infraestrutura|infra( |$)|redes|network|field|manutencao|dcm|data ?center|noc( |$)/;
// Indicam o nível, não a área: não contam como "combina"
const GENERICAS = new Set(['estagio', 'estagiario', 'estagiaria', 'vaga', 'jovem', 'aprendiz', 'junior', 'jr', 'trainee', 'para', 'com']);

// Reservadas a um grupo, com autodeclaração
const AFIRMATIVA = /afirmativ|exclusiv[ao]s? para|reservad[ao]s? para|pessoas negras|pessoas pretas|para mulheres|pessoas trans|lgbt|(^|[^a-z])pcd([^a-z]|$)|pessoas com deficiencia/;

const NIVEL_ENTRADA = /(^|[^a-z])(estagio|estagiari[oa]s?|estagiario\(a\)|intern|internship|trainee|junior|jr|aprendiz)([^a-z]|$)|(^|\s)i$/;
const NIVEL_ESTAGIO = /(^|[^a-z])(estagio|estagiari[oa]s?|estagiario\(a\)|intern|internship|aprendiz)([^a-z]|$)/;
const NIVEL_JUNIOR = /(^|[^a-z])(junior|jr|trainee|analista|engineer|engenheir[oa]|desenvolvedor[a]?|developer)([^a-z]|$)|(^|\s)i([^a-z]|$)/;
const NIVEL_APOIO = /(^|[^a-z])(auxiliar|assistente)([^a-z]|$)/;
const NIVEL_ALTO = /(^|[^a-z])(senior|semi-?senior|sr|pleno|pl|staff|lead|lider|principal|especialista|specialist|expert|coordenador\w*|gerente|manager|head|arquitet\w*|ii|iii|iv|mestre|mestrado|doutor\w*|phd)([^a-z]|$)/;
// "Programa de Estágio 2027" não diz a área: confere se a descrição é de TI
const TI_NA_DESCRICAO = /(^|[^a-z])(desenvolvimento de (software|sistemas)|programacao|programador|desenvolvedor|developer|back-?end|front-?end|full-?stack|software|node(\.js)?|javascript|python|java|sql|banco de dados|cloud)([^a-z]|$)/g;

const cidadeDe = (local) => normalizar(String(local || '').split(/,| - /)[0]);

// Título sujo de e-mail: "LINA Desenvolvedor Júnior LINA · São Paulo" -> "Desenvolvedor Júnior"
function limparTitulo(bruto) {
  let t = String(bruto || '').split(' · ')[0].trim();
  const p = t.split(/\s+/);
  for (let n = Math.min(4, Math.floor(p.length / 3)); n >= 1; n--) {
    const ini = p.slice(0, n).join(' ').toLowerCase();
    const fim = p.slice(-n).join(' ').toLowerCase();
    if (ini === fim) { t = p.slice(n, -n).join(' '); break; }
  }
  return t;
}

async function pontuar(vaga, { config }) {
  const titulo = normalizar(limparTitulo(vaga.titulo));
  const descricao = normalizar(vaga.descricao);
  const motivos = [];

  // Ajustes > "Nunca se candidatar se tiver"
  const proibido = config.termosExcluir.find((t) => `${titulo} ${descricao}`.includes(normalizar(t)));
  if (proibido) return { nota: 5, justificativa: `Contém termo excluído: "${proibido}"` };

  // Só com o ajuste ligado
  if (AFIRMATIVA.test(titulo) && !config.incluirAfirmativas) {
    return { nota: 10, justificativa: 'Vaga afirmativa (reservada a um grupo). Ligue em Ajustes se você fizer parte.' };
  }

  const alto = titulo.match(NIVEL_ALTO);
  if (alto) return { nota: 5, justificativa: `Nível acima de estágio/júnior (${alto[0].trim()})` };

  // Só estágio (Ajustes > Níveis): júnior, trainee, analista e "Engineer I" ficam de fora
  if (!config.aceitaJunior && !NIVEL_ESTAGIO.test(titulo) && NIVEL_JUNIOR.test(titulo)) {
    return { nota: 5, justificativa: 'Não é estágio (você busca só estágio; dá para incluir júnior em Ajustes)' };
  }

  const fora = titulo.match(AREA_FORA);
  if (fora && !TI_FORTE.test(titulo)) return { nota: 5, justificativa: `Área fora de TI (${fora[0].trim()})` };
  const suporte = titulo.match(SUPORTE);
  if (suporte && !config.incluirSuporte && !/(^|[^a-z])(desenvolv\w*|software|programa\w*|back-?end|front-?end|full-?stack|dados|data|cloud|devops)([^a-z]|$)/.test(titulo)) {
    return { nota: 30, justificativa: `Suporte/infraestrutura (${suporte[0].trim()}): ligue em Ajustes se quiser essas vagas` };
  }
  const entrada = NIVEL_ENTRADA.test(titulo);
  let nota = 55;
  if (!TI_TITULO.test(titulo)) {
    const sinais = new Set((descricao.match(TI_NA_DESCRICAO) || []).map((t) => t.trim())).size;
    if (entrada && !descricao && !vaga.descricaoLida) {
      // Só título (alerta ou busca): entra para o bot conferir a descrição ao abrir
      return { nota: Math.max(70, config.notaMinima), justificativa: 'Estágio sem área no título: a descrição vai ser conferida ao abrir a vaga' };
    }
    if (!(entrada && sinais >= 3)) return { nota: 25, justificativa: 'O título não indica uma vaga de tecnologia' };
    nota = 50;
    motivos.push('programa de estágio com descrição de TI');
  } else {
    motivos.push('vaga de TI');
  }

  // Sem nível no título, depende da descrição
  if (entrada) {
    nota += 15;
    motivos.push('estágio/júnior');
  } else if (NIVEL_APOIO.test(titulo)) {
    nota += 5;
  } else if (/(^|[^a-z])(estagio|junior|trainee)([^a-z]|$)/.test(descricao)) {
    nota += 5;
    motivos.push('descrição fala em estágio/júnior');
  } else {
    nota -= 10;
    motivos.push('nível não informado');
  }

  // Palavras da busca valem mais no título que na descrição
  const palavras = [...new Set(config.termosBusca.flatMap((t) => normalizar(t).split(' ')))]
    .filter((p) => p.length > 2 && !GENERICAS.has(p));
  const noTitulo = palavras.filter((p) => titulo.includes(p));
  const naDescricao = palavras.filter((p) => !titulo.includes(p) && descricao.includes(p));
  nota += Math.min(24, noTitulo.length * 8) + Math.min(9, naDescricao.length * 3);
  if (noTitulo.length) motivos.push(`título com: ${noTitulo.join(', ')}`);

  const modelo = normalizar(vaga.modelo);
  if (modelo && config.modelosAceitos.includes(modelo)) {
    nota += 5;
  } else if (modelo) {
    nota -= 30;
    motivos.push(`modelo ${vaga.modelo} fora do que você aceita`);
  }

  // Cidade só importa se não for remoto
  const cidadesAceitas = config.localizacao.split(';').map(cidadeDe).filter(Boolean);
  const cidadeVaga = cidadeDe(vaga.local);
  if (modelo === 'remoto') {
    nota += 10;
    motivos.push('remoto');
  } else if (cidadeVaga && cidadesAceitas.length) {
    if (cidadesAceitas.includes(cidadeVaga)) {
      nota += 10;
      motivos.push(`em ${vaga.local.split(',')[0]}`);
    } else {
      // Presencial/híbrido fora das cidades aceitas nunca entra na fila
      nota = Math.min(nota, 30);
      motivos.push(`${vaga.modelo || 'presencial'} em ${vaga.local}, fora das suas cidades`);
    }
  }

  nota = Math.max(0, Math.min(100, nota));
  return { nota, justificativa: motivos.join('; ') };
}

module.exports = { pontuar, normalizar, limparTitulo };
