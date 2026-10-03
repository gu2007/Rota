// Gemini para perguntas abertas, escolha de botões e leitura de e-mails.
// A IA só usa fatos do perfil; sem informação, responde SEM_RESPOSTA em vez de inventar.
// .env: GEMINI_API_KEY e GEMINI_MODELO.

const SEM_RESPOSTA = 'SEM_RESPOSTA';

const disponivel = () => !!process.env.GEMINI_API_KEY;

function descreverCandidato({ perfil, listas = {}, respostasFixas = [], textosTreino = [], respondidas = [] }) {
  const linhas = [];
  const add = (titulo, itens) => { if (itens.length) linhas.push(`${titulo}:\n${itens.map((i) => `- ${i}`).join('\n')}`); };
  linhas.push(`Nome: ${perfil.nome || ''}\nCidade: ${perfil.cidade || ''}\nObjetivo: ${perfil.objetivo || ''}`);
  if (perfil.resumo) linhas.push(`Sobre mim (palavras do candidato):\n${perfil.resumo}`);
  add('Formação', (listas.formacoes || []).map((f) => `${f.curso} — ${f.instituicao || ''}${f.nivel ? `, ${f.nivel}` : ''} (${f.status || ''}, ${f.inicio || '?'} a ${f.fim || '?'})`));
  // "Escolaridade" quase nunca está escrita assim: deduz da formação
  const superior = (listas.formacoes || []).find((f) => /gradua|bacharel|licenciatura|tecn[oó]logo|superior/i.test(`${f.nivel || ''} ${f.curso || ''}`));
  if (superior) {
    const cursando = /andamento|cursando/i.test(superior.status || '');
    linhas.push(`Escolaridade: Ensino médio completo; Ensino superior ${cursando ? 'incompleto (cursando)' : 'completo'} — ${superior.curso}, ${superior.instituicao || ''}`);
  }
  add('Experiências', (listas.experiencias || []).map((e) => `${e.cargo} — ${e.empresa || ''} (${e.inicio || '?'} a ${e.fim || 'atual'}): ${e.descricao || ''}`));
  add('Projetos', (listas.projetos || []).map((p) => `${p.nome} [${p.tecnologias || ''}]: ${p.descricao || ''} ${p.repo_url || ''}`));
  add('Cursos', (listas.cursos || []).map((c) => `${c.nome} — ${c.instituicao || ''}${c.carga_horaria ? `, ${c.carga_horaria}h` : ''}`));
  add('Habilidades', (listas.habilidades || []).map((h) => `${h.nome}${h.nivel ? ` (${h.nivel})` : ''}`));
  add('Respostas e declarações do candidato', respostasFixas.filter((r) => r.resposta).map((r) => `${r.rotulo}: ${r.resposta}`));
  for (const t of listas.textos || []) if (t.texto) linhas.push(`Texto do candidato — "${t.titulo}":\n${t.texto}`);
  const treinos = textosTreino.slice(-12).filter((t) => t.valor);
  if (treinos.length) linhas.push(`Respostas que o candidato escreveu em outras candidaturas:\n${treinos.map((t) => `- Pergunta: ${t.pergunta}\n  Resposta: ${t.valor}`).join('\n')}`);
  // Respondidas no painel ou no modo aprender
  const vistas = new Set();
  const qa = respondidas.filter((r) => r.resposta && r.pergunta && !vistas.has(r.pergunta) && vistas.add(r.pergunta)).slice(0, 80);
  if (qa.length) linhas.push(`Perguntas de formulário que o candidato já respondeu:\n${qa.map((r) => `- ${String(r.pergunta).slice(0, 300)}\n  → ${String(r.resposta).slice(0, 800)}`).join('\n')}`);
  return linhas.join('\n\n');
}

function montarPrompt({ pergunta, opcoes, limite, palavras, contexto, vaga, dica }) {
  const regras = [
    'Você preenche um formulário de candidatura NO LUGAR do candidato, em primeira pessoa, em português do Brasil.',
    'Use SOMENTE fatos presentes em "DADOS DO CANDIDATO". Nunca invente experiência, certificação, tecnologia, número ou nível.',
    'Não diga que é uma IA. Tom natural, direto e profissional, sem exageros nem clichês.',
    'Se houver um texto ou uma resposta anterior do candidato sobre o mesmo assunto (mesmo com outras palavras), use como base: mantenha os fatos e o jeito dele, adapte à pergunta e à vaga, e corrija erros de digitação.',
    'Se a pergunta tem o MESMO SENTIDO de uma que o candidato já respondeu (mesmo escrita de outro jeito ou com opções diferentes), use aquela resposta. Ex.: "Qual sua média na faculdade?" = "Qual o seu CR?".',
    'Para perguntas de conformidade (vínculos, parentes, cargo público, sociedade em empresas, conflito de interesses), responda com base nas declarações do candidato. Se ele declarou que não, responda de forma curta, por exemplo: "Não."',
    `Se não houver informação verdadeira suficiente para responder, responda exatamente: ${SEM_RESPOSTA}`,
  ];
  if (opcoes?.length) {
    regras.push('A pergunta é de múltipla escolha. Responda com o texto EXATO de UMA das opções, e nada mais.');
  } else {
    regras.push(`Responda só com o texto da resposta, sem aspas e sem comentários. O campo tem limite: escreva NO MÁXIMO ${limite} caracteres${palavras ? ` e ${palavras} palavras` : ''}, contando espaços. Seja direto: responda o que foi perguntado, sem repetir a pergunta.`);
  }
  return [
    regras.join('\n'),
    `DADOS DO CANDIDATO\n${descreverCandidato(contexto)}`,
    `VAGA\n${vaga.titulo} — ${vaga.empresa || ''}\n${String(vaga.descricao || '').slice(0, 3000)}`,
    dica ? `OBSERVAÇÃO\n${dica}` : '',
    `PERGUNTA DO FORMULÁRIO\n${pergunta}`,
    opcoes?.length ? `OPÇÕES\n${opcoes.map((o) => `- ${o}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

async function chamar(texto, { temperatura = 0.4, json = false, fetchFn = fetch } = {}) {
  const modelo = process.env.GEMINI_MODELO || 'gemini-3.8-flash';
  const resp = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: texto }] }],
      generationConfig: { temperature: temperatura, maxOutputTokens: 2048, ...(json ? { responseMimeType: 'application/json' } : {}) },
    }),
  });
  if (!resp.ok) {
    const corpo = await resp.text();
    let motivo = corpo.slice(0, 200);
    try { motivo = JSON.parse(corpo).error?.message || motivo; } catch { /* não era JSON */ }
    const dica = [400, 401, 403].includes(resp.status)
      ? ' Confira a GEMINI_API_KEY no .env (sem aspas e sem espaços) e rode "npm run testar:ia".' : '';
    throw new Error(`Gemini recusou (${resp.status}): ${String(motivo).replace(/\.+$/, '')}.${dica}`);
  }
  const dados = await resp.json();
  return (dados.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
}

// null quando não há resposta verdadeira
async function responder({ pergunta, opcoes, limite = 700, palavras, contexto, vaga, dica }, { fetchFn = fetch } = {}) {
  if (!disponivel()) return null;
  const texto = await chamar(montarPrompt({ pergunta, opcoes, limite, palavras, contexto, vaga, dica }), { fetchFn });
  if (!texto || texto.includes(SEM_RESPOSTA)) return null;
  return opcoes?.length ? texto.replace(/^[-"'\s]+|["'\s.]+$/g, '') : texto.slice(0, limite);
}

// A IA nunca pode mandar clicar nestes
const BOTAO_PROIBIDO = /sair|logout|log out|cancel|exclu|apagar|remover|voltar|anterior|linkedin|google|facebook|indeed|glassdoor|cookie|privacy|privacidade|acompanh|minhas candidaturas|ver candidatura|desistir|compartilh|denunci/i;

// Usado quando nenhuma regra acha o botão certo.
// situacao: 'comecar' (página da vaga) ou 'avancar' (etapa já preenchida)
async function escolherBotao({ situacao, titulos, botoes, vaga }, { fetchFn = fetch } = {}) {
  if (!disponivel() || !botoes.length) return null;
  const objetivo = situacao === 'comecar'
    ? 'Estou na página de uma vaga e quero COMEÇAR a candidatura (abrir o formulário para me candidatar).'
    : 'Já preenchi os campos desta etapa do formulário de candidatura e quero ir para a PRÓXIMA etapa ou FINALIZAR/ENVIAR a candidatura.';
  const prompt = [
    'Você ajuda um robô a navegar num site de candidatura a vagas de emprego (normalmente a Gupy).',
    objetivo,
    'Escolha o botão que uma pessoa clicaria agora. Nunca escolha: login/entrar com rede social, sair, cancelar, voltar, excluir, compartilhar, acompanhar candidatura, links de menu, rodapé ou de outras vagas.',
    'Diga também o que o clique faz: "comecar" (abre a candidatura), "avancar" (vai para a próxima etapa, sem enviar) ou "finalizar" (envia/conclui a candidatura).',
    'Responda SOMENTE um JSON: {"numero": N, "acao": "comecar|avancar|finalizar"}. Se nenhum botão serve, responda {"numero": 0}.',
    `VAGA: ${vaga?.titulo || ''} — ${vaga?.empresa || ''}`,
    `TÍTULOS NA TELA: ${String(titulos || '').slice(0, 400)}`,
    `BOTÕES VISÍVEIS:\n${botoes.map((b, i) => `${i + 1}. "${b}"`).join('\n')}`,
  ].join('\n\n');
  const texto = await chamar(prompt, { temperatura: 0, json: true, fetchFn });
  let r;
  try { r = JSON.parse(texto.replace(/^```(json)?|```$/g, '').trim()); } catch { return null; }
  const indice = Number(r.numero) - 1;
  const escolhido = botoes[indice];
  if (!escolhido || BOTAO_PROIBIDO.test(escolhido) || !['comecar', 'avancar', 'finalizar'].includes(r.acao)) return null;
  return { indice, acao: r.acao, texto: escolhido };
}

// Acha perguntas pendentes com o mesmo sentido da que acabou de ser respondida
async function aproveitarResposta({ pergunta, resposta, pendentes }, { fetchFn = fetch } = {}) {
  if (!disponivel() || !pendentes.length) return [];
  const prompt = [
    'Um candidato respondeu uma pergunta de formulário de vaga. Veja se alguma das OUTRAS perguntas abaixo pede EXATAMENTE a mesma informação (mesmo sentido, mesmo escrita de outro jeito).',
    'Só marque se a resposta dele responde a outra pergunta com certeza. Na dúvida, não marque. Nunca invente.',
    'Se a outra pergunta tem opções, a resposta deve ser o texto EXATO de uma das opções, a que corresponde à resposta do candidato.',
    'Responda SOMENTE um JSON: [{"id": <id>, "resposta": "<texto>"}]. Se nenhuma, responda [].',
    `PERGUNTA RESPONDIDA: ${pergunta}\nRESPOSTA DO CANDIDATO: ${resposta}`,
    `OUTRAS PERGUNTAS:\n${pendentes.map((p) => `- id ${p.id}: ${p.pergunta}${p.opcoes?.length ? `\n  opções: ${p.opcoes.join(' | ')}` : ''}`).join('\n')}`,
  ].join('\n\n');
  const texto = await chamar(prompt, { temperatura: 0, json: true, fetchFn });
  try {
    const lista = JSON.parse(texto.replace(/^```(json)?|```$/g, '').trim());
    return Array.isArray(lista) ? lista.filter((x) => x && pendentes.some((p) => p.id === Number(x.id)) && String(x.resposta || '').trim()) : [];
  } catch { return []; }
}

// Pergunta nova escrita de outro jeito: acha qual pergunta já respondida pede a mesma informação.
// Devolve o índice em "conhecidas" ou -1.
async function mesmaPergunta({ pergunta, opcoes = [], conhecidas }, { fetchFn = fetch } = {}) {
  if (!disponivel() || !conhecidas.length) return null; // null: não deu para comparar (não guarda)
  const prompt = [
    'Um robô preenche formulários de vagas de emprego. Apareceu uma pergunta NOVA. Veja se alguma das perguntas JÁ RESPONDIDAS abaixo pede EXATAMENTE a mesma informação, só que escrita de outro jeito (outra língua, outras palavras).',
    'Exemplos de iguais: "Qual seu gênero?" = "What is your gender?" = "Gênero com o qual você se identifica"; "Pretensão salarial" = "Desired salary" = "Expectativa de remuneração".',
    'Exemplos de diferentes: "nível de inglês" ≠ "nível de espanhol"; "possui deficiência?" ≠ "precisa de adaptação?"; "cidade onde mora" ≠ "cidade da vaga".',
    'Na dúvida, responda 0. Responda SOMENTE um JSON: {"numero": N} (0 se nenhuma).',
    `PERGUNTA NOVA: ${pergunta}${opcoes.length ? `\nopções: ${opcoes.slice(0, 15).join(' | ')}` : ''}`,
    `JÁ RESPONDIDAS:\n${conhecidas.map((c, i) => `${i + 1}. ${c}`).join('\n')}`,
  ].join('\n\n');
  const texto = await chamar(prompt, { temperatura: 0, json: true, fetchFn }).catch(() => null);
  if (!texto) return null;
  try {
    const n = Number(JSON.parse(String(texto).replace(/^```(json)?|```$/g, '').trim()).numero);
    return n >= 1 && n <= conhecidas.length ? n - 1 : -1;
  } catch { return null; }
}

// Escolhe as habilidades do currículo que mais combinam com a vaga
async function escolherHabilidades({ opcoes, quantas, vaga }, { fetchFn = fetch } = {}) {
  if (!disponivel() || !opcoes.length || quantas <= 0) return [];
  const prompt = [
    `Estas são habilidades do currículo de um candidato. Escolha as ${quantas} que mais combinam com a vaga abaixo.`,
    'Responda SOMENTE um JSON com os textos EXATOS escolhidos, em ordem de importância. Ex.: ["Node.js", "Git"]',
    `VAGA\n${vaga?.titulo || ''} — ${vaga?.empresa || ''}\n${String(vaga?.descricao || '').slice(0, 2500)}`,
    `HABILIDADES\n${opcoes.map((o) => `- ${o}`).join('\n')}`,
  ].join('\n\n');
  try {
    const lista = JSON.parse((await chamar(prompt, { temperatura: 0, json: true, fetchFn })).replace(/^```(json)?|```$/g, '').trim());
    return Array.isArray(lista) ? lista.filter((x) => opcoes.includes(x)).slice(0, quantas) : [];
  } catch { return []; }
}

// Extrai título, empresa, local e modelo de cada vaga de um e-mail de alerta
async function completarVagasEmail({ assunto, texto, vagas }, { fetchFn = fetch } = {}) {
  if (!disponivel() || !vagas.length) return {};
  const prompt = [
    'Abaixo está o texto de um e-mail de alerta de vagas e a lista de links de vagas que estão nele.',
    'Para cada link, diga o título da vaga, a empresa, o local (cidade/UF) e o modelo (presencial, hibrido ou remoto), SOMENTE se estiver escrito no e-mail. O que não estiver escrito fica null.',
    'Responda SOMENTE um JSON: [{"url": "...", "titulo": "...", "empresa": "...", "local": "...", "modelo": "presencial|hibrido|remoto|null"}]',
    `ASSUNTO: ${assunto || ''}`,
    `TEXTO DO E-MAIL:\n${String(texto || '').slice(0, 12000)}`,
    `LINKS:\n${vagas.map((v) => `- ${v.url}  (textos do link: ${v.textos.slice(0, 3).join(' | ') || 'nenhum'})`).join('\n')}`,
  ].join('\n\n');
  try {
    const lista = JSON.parse((await chamar(prompt, { temperatura: 0, json: true, fetchFn })).replace(/^```(json)?|```$/g, '').trim());
    const mapa = {};
    for (const x of Array.isArray(lista) ? lista : []) if (x?.url) mapa[x.url] = x;
    return mapa;
  } catch { return {}; }
}

// Modo agente: recebe o mapa da tela e devolve as ações para completar a etapa
async function planejarTela({ tela, titulos, contexto, vaga, jaTentado = [] }, { fetchFn = fetch } = {}) {
  if (!disponivel() || !tela.length) return [];
  const prompt = [
    'Você ajuda um robô a preencher um formulário de candidatura a vaga NO LUGAR do candidato.',
    'Abaixo está o mapa da tela: cada elemento tem um número (n), o tipo, o rótulo, o valor atual e, se houver, as opções.',
    'Diga as ações para completar os campos que ainda estão VAZIOS ou errados nesta etapa. Regras:',
    '- Use SOMENTE fatos dos DADOS DO CANDIDATO. Nunca invente experiência, documento, número ou nível.',
    '- Campo de escolha: use o texto EXATO de uma das opções. Lista que só mostra as opções ao abrir: primeiro {"acao":"clicar","n":<a lista>} e pare; na próxima rodada as opções aparecem.',
    '- Campo obrigatório que só o candidato sabe responder (não está nos dados): {"acao":"perguntar","n":N,"pergunta":"<o rótulo do campo>"}.',
    '- Dados pessoais (CPF, RG, endereço, data de nascimento): sempre "perguntar"; não estão aqui.',
    '- Termos de uso/privacidade obrigatórios: "marcar". Newsletter/marketing: não marque.',
    '- NUNCA clique em enviar, finalizar, submit, próximo, continuar, voltar, cancelar, login ou "candidatar com" outra rede. Quem avança a etapa é o robô.',
    '- Não repita ações que já foram tentadas e não funcionaram.',
    'Ações: {"acao":"preencher","n":N,"valor":"..."} | {"acao":"escolher","n":N,"valor":"<opção>"} | {"acao":"marcar","n":N} | {"acao":"clicar","n":N} | {"acao":"perguntar","n":N,"pergunta":"..."}',
    'Responda SOMENTE um JSON (lista de ações). Se não há nada a fazer, responda [].',
    `DADOS DO CANDIDATO\n${descreverCandidato(contexto)}`,
    `VAGA: ${vaga?.titulo || ''} — ${vaga?.empresa || ''}`,
    `TÍTULOS NA TELA: ${String(titulos || '').slice(0, 300)}`,
    jaTentado.length ? `JÁ TENTADO (não repita): ${JSON.stringify(jaTentado).slice(0, 1500)}` : '',
    `MAPA DA TELA\n${JSON.stringify(tela).slice(0, 14000)}`,
  ].filter(Boolean).join('\n\n');
  try {
    const lista = JSON.parse((await chamar(prompt, { temperatura: 0, json: true, fetchFn })).replace(/^```(json)?|```$/g, '').trim());
    const validos = new Set(tela.map((t) => t.n));
    return (Array.isArray(lista) ? lista : []).filter((a) => a && validos.has(Number(a.n))
      && ['preencher', 'escolher', 'marcar', 'clicar', 'perguntar'].includes(a.acao)).slice(0, 25);
  } catch { return []; }
}

// Lê a etapa inteira de uma vez e propõe a resposta de cada campo com base nos dados do candidato.
// Quem decide é o robô: as regras (dados pessoais, diversidade, termos) vêm antes deste plano.
async function planejarFormulario({ campos, contexto, vaga }, { fetchFn = fetch } = {}) {
  if (!disponivel() || !campos.length) return {};
  const lista = campos.map((c) => ({
    id: c.id, tipo: c.tipo, pergunta: String(c.rotulo || '').slice(0, 300), obrigatorio: !!c.obrigatorio,
    ...(c.opcoes?.length ? { opcoes: c.opcoes.slice(0, 40) } : {}), ...(c.limite ? { limite: c.limite } : {}),
  }));
  const prompt = [
    'Você ajuda um robô a preencher UMA etapa de um formulário de candidatura a vaga, NO LUGAR do candidato.',
    'Para cada campo da lista, diga a resposta usando os DADOS DO CANDIDATO. Relacione perguntas escritas de outro jeito com os dados que existem:',
    '- "Escolaridade", "Grau de instrução", "Nível de formação" → use a Escolaridade/Formação.',
    '- "Instituição", "Universidade", "Curso", "Semestre", "Previsão de formatura" → use a Formação e as respostas do candidato.',
    '- "Empresa atual", "Cargo atual", "Último emprego" → use as Experiências (a mais recente ou a atual).',
    '- Idiomas, disponibilidade, pretensão, modelo de trabalho → use as respostas e declarações do candidato.',
    'Regras:',
    '- Use SOMENTE fatos dos dados. Nunca invente documento, número, nota, nível, experiência ou tecnologia.',
    '- Campo com opções: responda com o texto EXATO de uma das opções.',
    '- Datas: no formato que a pergunta mostrar (ex.: "03/10/2026" → DD/MM/AAAA; "MM/AAAA"); ano sozinho → só o ano.',
    '- Texto livre: em primeira pessoa, natural, sem dizer que é IA, respeitando o limite de caracteres.',
    '- Raça/cor, gênero, orientação, deficiência e dados pessoais (CPF, RG, endereço, nascimento): NÃO responda (deixe de fora).',
    '- Sem informação verdadeira para um campo: deixe de fora.',
    'Responda SOMENTE um JSON no formato {"<id>": "<resposta>", ...}.',
    `DADOS DO CANDIDATO\n${descreverCandidato(contexto)}`,
    `VAGA: ${vaga?.titulo || ''} — ${vaga?.empresa || ''}\n${String(vaga?.descricao || '').slice(0, 1500)}`,
    `CAMPOS DESTA ETAPA\n${JSON.stringify(lista).slice(0, 14000)}`,
  ].join('\n\n');
  try {
    const r = JSON.parse((await chamar(prompt, { temperatura: 0.2, json: true, fetchFn })).replace(/^```(json)?|```$/g, '').trim());
    const ids = new Set(campos.map((c) => String(c.id)));
    return Object.fromEntries(Object.entries(r || {}).filter(([id, v]) => ids.has(String(id)) && v != null && String(v).trim() && !String(v).includes(SEM_RESPOSTA))
      .map(([id, v]) => [String(id), String(v).trim()]));
  } catch { return {}; }
}

const SITUACOES = ['recebida', 'em_analise', 'avancou', 'teste', 'entrevista', 'proposta', 'aprovado', 'reprovado', 'outro'];

// Diz se o e-mail é sobre um processo seletivo do candidato e em que etapa está; null se não for
async function entenderEmailProcesso({ assunto, de, texto, links = [], data }, { fetchFn = fetch } = {}) {
  if (!disponivel()) return null;
  const prompt = [
    'Você lê e-mails de um candidato a vagas de emprego/estágio. Diga se ESTE e-mail é sobre um processo seletivo em que ELE se candidatou',
    '(confirmação de candidatura, mudança de etapa, convite para teste ou entrevista, aprovação, reprovação, proposta, pedido de documentos).',
    'Alertas de "novas vagas para você", newsletters, propaganda e cursos NÃO são processo seletivo.',
    `Responda SOMENTE um JSON: {"processo": true|false, "empresa": "...", "vaga": "...", "situacao": "${SITUACOES.join('|')}", "resumo": "uma frase curta em português", "acao": "o que o candidato precisa fazer, ou null", "prazo": "prazo como está escrito, ou null", "prazo_data": "AAAA-MM-DD ou null", "prazo_hora": "HH:MM ou null", "link": "um dos LINKS ou null"}`,
    'Use só o que está escrito no e-mail. Se não souber a empresa ou a vaga, use null.',
    `prazo_data: converta o prazo para data (o e-mail chegou em ${new Date(data || Date.now()).toISOString().slice(0, 10)}; "até sexta" = a próxima sexta). Sem prazo, null.`,
    'link: escolha da lista LINKS o endereço para o candidato CONTINUAR o processo (fazer o teste, agendar, preencher o formulário) ou, se não houver etapa, para VER a candidatura/retorno. Copie exatamente. Nenhum serve: null.',
    `DE: ${de || ''}`,
    `ASSUNTO: ${assunto || ''}`,
    `TEXTO:\n${String(texto || '').slice(0, 8000)}`,
    `LINKS:\n${links.map((l) => `- ${l.url}  (texto: ${l.texto || '—'})`).join('\n') || '(nenhum)'}`,
  ].join('\n\n');
  try {
    const r = JSON.parse((await chamar(prompt, { temperatura: 0, json: true, fetchFn })).replace(/^```(json)?|```$/g, '').trim());
    if (!r?.processo) return null;
    return {
      empresa: r.empresa || null, vaga: r.vaga || null,
      situacao: SITUACOES.includes(r.situacao) ? r.situacao : 'outro',
      resumo: r.resumo || null, acao: r.acao || null, prazo: r.prazo || null,
      prazoData: /^\d{4}-\d{2}-\d{2}$/.test(r.prazo_data || '') ? r.prazo_data : null,
      prazoHora: /^\d{1,2}:\d{2}$/.test(r.prazo_hora || '') ? r.prazo_hora : null,
      link: links.some((l) => l.url === r.link) ? r.link : null,
    };
  } catch { return null; }
}

module.exports = { responder, escolherBotao, aproveitarResposta, mesmaPergunta, planejarFormulario, escolherHabilidades, completarVagasEmail, planejarTela, entenderEmailProcesso, SITUACOES, chamar, disponivel, montarPrompt, descreverCandidato, SEM_RESPOSTA, BOTAO_PROIBIDO };
