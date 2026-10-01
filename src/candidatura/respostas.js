// Decide a resposta de cada campo, nesta ordem: perfil, respostas fixas (a IA nunca
// responde estas), regras de segurança, currículo e, por último, a IA. Sem resposta verdadeira, null.

const fs = require('fs');
const ia = require('../ia/gemini');
const { chave: chaveAprendida, chavePergunta } = require('./aprendizado');

const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

const REGRAS_PERFIL = [
  [/sobrenome|last ?name|surname|family name|ultimo nome/, 'sobrenome'],
  [/first ?name|primeiro nome|given name/, 'primeiro_nome'],
  [/nome completo|full name|^nome\b|seu nome|^name\b/, 'nome'],
  [/e-?mail/, 'email'],
  [/telefone|celular|whats|phone|mobile/, 'telefone'],
  [/linkedin/, 'linkedin_url'],
  [/github/, 'github_url'],
  [/portfolio|site pessoal|url pessoal|personal (url|website|site)|^website\b|^site\b|link (pessoal|do seu perfil)|perfil profissional|^url\b/, 'portfolio_url'],
  [/^cidade\b|cidade onde mora|cidade atual|^city\b|^location\b|^localizacao\b/, 'cidade'],
];

const REGRAS_PESSOAIS = [
  [/(^|[^a-z])cpf([^a-z]|$)/, 'cpf'],
  [/(^|[^a-z])rg([^a-z]|$)|registro geral|carteira de identidade|documento de identidade/, 'rg'],
  [/nascimento/, 'data_nascimento'],
  [/(^|[^a-z])cep([^a-z]|$)/, 'cep'],
  [/complemento/, 'complemento'],
  [/bairro/, 'bairro'],
  [/^(numero|n[o°º]\.?)$|^numero (da residencia|do endereco|residencial)/, 'numero'],
  [/logradouro|^endereco|^rua\b|endereco residencial/, 'logradouro'],
  [/nacionalidade/, 'nacionalidade'],
  [/estado civil/, 'estado_civil'],
  [/^(estado|uf)$|estado onde mora|estado de residencia/, 'estado'],
];

function detectarPessoal(pergunta) {
  const r = norm(pergunta).replace(/[\s*:]+$/, '');
  return REGRAS_PESSOAIS.find(([re]) => re.test(r))?.[1] || null;
}

// A primeira regra que bater vence
const REGRAS_FIXAS = [
// Remuneração atual e benefícios antes de pretensão, senão viram pretensão salarial
  [/(remuneracao|salario) (atual|mensal atual)|ultima remuneracao|ultimo salario|remuneracao atual ou (a )?ultima|quanto (voce )?ganha/, 'remuneracao_atual'],
  [/beneficios/, 'beneficios_atuais'],
  [/cargo atual|ocupacao atual|(sua )?funcao atual|o que (voce )?faz atualmente/, 'cargo_atual'],
  [/pretensao|salari|remunera/, 'pretensao_salarial'],
  [/ingles/, 'ingles'],
// Antes de "semestre" e "horário"
  [/coeficiente de rendimento|(^|[^a-z])cra?([^a-z]|$)|media (geral|academica|global|ponderada|das notas|do curso|na faculdade)|nota media|rendimento academico/, 'coeficiente'],
  [/grade horaria|grade de (aulas|horarios)|horarios? (das|de|da) (suas )?(aulas?|faculdade)|horario (na|da) faculdade|dias e horarios (que|em que) (voce )?(estuda|tem aula)|turno (da faculdade|do curso|que (voce )?estuda)/, 'grade_horaria'],
  [/\bcnh\b|habilitacao/, 'cnh'],
// "Semestre previsto para a conclusão" é previsão, não semestre atual
  [/formatura|conclusao|previsao de termino|previstos? para (a )?(conclusao|formatura)/, 'previsao_formatura'],
  [/semestre|periodo (atual|do curso|que (esta|cursa))/, 'semestre_atual'],
  [/como (voce )?(soube|conheceu|ficou sabendo)|onde (voce )?(encontrou|viu|conheceu)/, 'como_soube'],
  [/(ja )?conhec(e|ia|eu) (a |o |nossa |nosso )?(empresa|marca|companhia|grupo)|voce (ja )?conhecia|ja conhece (a|o) /, 'conhece_empresa'],
  [/indicad[oa]|(foi|e) (uma )?indicacao|alguem (te |lhe )?indicou|possui indicacao/, 'indicacao'],
  [/quando (voce )?pode (comecar|iniciar)|inicio imediato|data (de|para) inicio|disponibilidade para (comecar|inicio)/, 'inicio'],
// "Disponibilidade para atuar em modelo híbrido" é sobre modelo
  [/modelo de trabalho|presencial|hibrido|remoto/, 'modelo_trabalho'],
  [/disponibilidade|horario|turno/, 'disponibilidade'],
  [/distancia|deslocamento|regiao|bairro|mora (perto|proximo)/, 'distancia_maxima'],
];

// Origem da vaga -> resposta para "como soube da vaga?"
const ORIGEM_VAGA = {
  gupy_portal: { texto: 'Portal de vagas da Gupy', opcoes: ['Gupy', 'Portal Gupy', 'Site de vagas', 'Site', 'Internet', 'Outros'] },
  linkedin: { texto: 'LinkedIn', opcoes: ['LinkedIn', 'Redes sociais', 'Internet', 'Outros'] },
  email: { texto: 'LinkedIn', opcoes: ['LinkedIn', 'Redes sociais', 'Internet', 'Outros'] },
  infojobs: { texto: 'InfoJobs', opcoes: ['InfoJobs', 'Site de vagas', 'Internet', 'Outros'] },
  google: { texto: 'Pesquisa no Google', opcoes: ['Google', 'Internet', 'Site', 'Outros'] },
};

const CONSENTIMENTO = /concordo|li e aceito|aceito (os|as|o|a) (termos|politica|aviso)|eu aceito|aceito$|termos (e|de) (condicoes|uso)|politica de privacidade|aviso de privacidade|autorizo|lgpd|declaro que|i agree|i accept|terms (and|&) conditions|privacy (policy|notice)|grupo de talentos|banco de talentos|talent (pool|community|network)|entrar em contato comigo|oportunidades (de emprego )?futuras|futuras oportunidades|future (job )?opportunities/;
// Palavras inteiras, senão "remuneração" casa com "raça"
const DIVERSIDADE = /(^|[^a-z])(genero|sexo|gender|raca|cor|etnia|pcd)([^a-z]|$)|orientacao sexual|identidade de genero|deficiencia|neurodivergen/;
const PREFIRO_NAO = /prefiro nao|nao desejo|nao quero (informar|responder)|prefiro nao informar|prefer not|decline to|nao informar/;
const CURRICULO = /curriculo|\bcv\b|resume|anexo/;

function escolherOpcao(opcoes, resposta) {
  const r = norm(resposta);
  if (!r) return null;
  const exata = opcoes.find((o) => norm(o) === r);
  if (exata) return exata;
  const contem = opcoes.find((o) => norm(o) && (r.includes(norm(o)) || norm(o).includes(r)));
  if (contem) return contem;
  const palavras = new Set(r.split(/\W+/).filter((p) => p.length > 2));
  let melhor = null, pontos = 0;
  for (const o of opcoes) {
    const p = norm(o).split(/\W+/).filter((w) => palavras.has(w)).length;
    if (p > pontos) { melhor = o; pontos = p; }
  }
  return melhor;
}

// Corta no último ponto final que cabe, para não terminar no meio da frase
function cortarNoLimite(texto, limite, limitePalavras) {
  let t = String(texto || '').trim();
  if (limitePalavras) {
    const p = t.split(/\s+/);
    if (p.length > limitePalavras) t = p.slice(0, limitePalavras).join(' ');
  }
  if (limite && t.length > limite) t = t.slice(0, limite);
  if (t.length < String(texto).trim().length) {
    const fim = Math.max(t.lastIndexOf('. '), t.lastIndexOf('! '), t.lastIndexOf('? '), t.endsWith('.') ? t.length - 1 : -1);
    if (fim > t.length * 0.5) t = t.slice(0, fim + 1);
  }
  return t;
}

const ehEscolha = (c) => ['select', 'radio', 'combobox', 'caixinhas'].includes(c.tipo);

async function decidir(campo, { perfil: perfilBase, listas, respostasFixas, vaga, pessoais = {}, aprendidas = {}, textosTreino = [], respondidas = [], separaNome = false, iaFn = ia.responder }) {
  const partes = String(perfilBase?.nome || '').trim().split(/\s+/);
  const perfil = { ...perfilBase, primeiro_nome: partes[0] || '', sobrenome: partes.slice(1).join(' ') };
  if (separaNome) perfil.nome = perfil.primeiro_nome; // ao lado de "Sobrenome", só o primeiro nome
  const rotulo = norm(campo.rotulo).replace(/^\d{1,2}\s*[.)\-:]\s*/, '');
  // Respostas já dadas vão para a IA reconhecer a mesma pergunta escrita de outro jeito
  const objetivasTreino = Object.values(aprendidas || {}).map((a) => ({ pergunta: a.pergunta, resposta: String(a.valor) }));
  const contexto = { perfil, listas, respostasFixas, textosTreino, respondidas: [...respondidas, ...objetivasTreino] };

  // Pelo tipo do input: type="tel" é telefone mesmo com rótulo como "BR+55"
  if (campo.tipo === 'texto' && campo.html === 'tel' && !/cep|cpf/.test(rotulo)) {
    return perfil.telefone ? { valor: perfil.telefone, fonte: 'perfil' } : null;
  }
  if (campo.tipo === 'texto' && campo.html === 'email') {
    return perfil.email ? { valor: perfil.email, fonte: 'perfil' } : null;
  }

  if (campo.tipo === 'texto' && rotulo.length < 60) {
    const regra = REGRAS_PERFIL.find(([re]) => re.test(rotulo));
    if (regra) {
      const valor = regra[1] === 'portfolio_url' ? (perfil.portfolio_url || perfil.linkedin_url || perfil.github_url) : perfil[regra[1]];
      return valor ? { valor, fonte: 'perfil' } : null;
    }
  }

  // Dados pessoais. Perguntas longas vão direto para a IA, porque palavras soltas
  // como "remuneração" no meio do texto confundem as regras.
  const curta = rotulo.length <= 160;
  const pessoal = curta && detectarPessoal(campo.rotulo);
  if (pessoal && ['texto', 'textarea', 'select', 'combobox', 'radio'].includes(campo.tipo)) {
    const valor = pessoais[pessoal] || aprendidas[chaveAprendida(campo.rotulo)]?.valor;
    if (!valor) return null; // não cadastrado: não inventa
    if (!ehEscolha(campo)) return { valor, fonte: 'pessoal' };
    const opcao = escolherOpcao(campo.opcoes || [], valor);
    return opcao ? { valor: opcao, fonte: 'pessoal' } : null;
  }

  if (campo.tipo === 'checkbox') {
    return CONSENTIMENTO.test(rotulo) ? { valor: true, fonte: 'regra' } : null;
  }

  // Diversidade: só o que o usuário informou, nunca deduz
  if (curta && DIVERSIDADE.test(rotulo)) {
    const sua = (/genero|sexo|gender/.test(rotulo) && respostasFixas.find((r) => r.chave === 'genero')?.resposta)
      || respondidas.find((r) => r.resposta && chavePergunta(r.pergunta) === chavePergunta(campo.rotulo))?.resposta
      || aprendidas[chaveAprendida(campo.rotulo)]?.valor;
    if (sua) {
      if (!ehEscolha(campo)) return { valor: String(sua), fonte: 'fixa' };
      const opcao = escolherOpcao(campo.opcoes || [], String(sua));
      if (opcao) return { valor: opcao, fonte: 'fixa' };
    }
    const opcao = (campo.opcoes || []).find((o) => PREFIRO_NAO.test(norm(o)));
    return opcao ? { valor: opcao, fonte: 'regra' } : null;
  }

  // Autorização em forma de escolha ("Autorizo" / "Não autorizo")
  if (curta && ehEscolha(campo) && CONSENTIMENTO.test(rotulo)) {
    const opcao = (campo.opcoes || []).find((o) => /^(sim|autorizo|concordo|aceito|li e|estou ciente|declaro)/.test(norm(o)) && !/\bnao\b/.test(norm(o)));
    if (opcao) return { valor: opcao, fonte: 'regra' };
  }

  // Arquivo que só aceita imagem é foto
  const soImagem = campo.tipo === 'arquivo' && /image/.test(campo.aceita || '') && !/pdf|doc/.test(campo.aceita || '');
  if (campo.tipo === 'arquivo' && (soImagem || /foto|photo|imagem|picture|avatar|retrato/.test(rotulo))) {
    const foto = String(perfil.foto_arquivo || '').trim().replace(/^["']|["']$/g, '');
    return foto && fs.existsSync(foto) ? { valor: foto, fonte: 'arquivo' } : null;
  }
  if (campo.tipo === 'arquivo') {
    // "Copiar como caminho" do Windows põe aspas
    const arquivo = String(perfil.curriculo_arquivo || '').trim().replace(/^["']|["']$/g, '');
    // Upload genérico que aceita PDF/DOC e não pede outro documento é o currículo
    const generico = /arquivo|file|anexo|anexar|upload|choose|drop|escolh|selecion|arraste|carregar|enviar|attach/.test(rotulo) || !rotulo
      || /pdf|doc/.test(campo.aceita || '');
    const outroDocumento = /historico|diploma|certificad|comprovante|declarac|carta|portfolio|transcript|cover letter/.test(rotulo);
    const ehCurriculo = CURRICULO.test(rotulo) || (generico && !outroDocumento);
    return ehCurriculo && arquivo && fs.existsSync(arquivo) ? { valor: arquivo, fonte: 'arquivo' } : null;
  }

  // "Como soube da vaga?": a verdade é onde o Rota achou a vaga
  const fixaComoSoube = curta && REGRAS_FIXAS.find(([re, k]) => k === 'como_soube' && re.test(rotulo));
  // Alerta de e-mail da Gupy conta como Gupy; os outros vêm do LinkedIn
  const codigoOrigem = vaga?.origem_plataforma === 'email' && /gupy\.io/.test(vaga?.url || '') ? 'gupy_portal' : vaga?.origem_plataforma;
  const origem = ORIGEM_VAGA[codigoOrigem];
  if (fixaComoSoube && origem) {
    if (!ehEscolha(campo)) return { valor: origem.texto, fonte: 'origem' };
    const opcao = origem.opcoes.map((o) => escolherOpcao(campo.opcoes || [], o)).find(Boolean);
    if (opcao) return { valor: opcao, fonte: 'origem' };
  }

  const fixa = curta && REGRAS_FIXAS.find(([re]) => re.test(rotulo));
  if (fixa) {
    const resposta = respostasFixas.find((r) => r.chave === fixa[1])?.resposta;
    // Sem resposta fixa, segue para a IA, que só responde com informação verdadeira
    if (resposta) {
      if (!ehEscolha(campo)) return { valor: resposta, fonte: 'fixa' };
      const opcao = escolherOpcao(campo.opcoes || [], resposta);
      if (opcao) return { valor: opcao, fonte: 'fixa' };
      // Ex.: "Tem 6h?" [Sim/Não] com resposta "6h/dia": a IA escolhe a partir da resposta fixa
      const escolhida = await iaFn({ pergunta: campo.rotulo, opcoes: campo.opcoes, contexto, vaga, dica: `A resposta do candidato para "${fixa[1]}" é: ${resposta}` });
      const valida = escolhida && escolherOpcao(campo.opcoes, escolhida);
      return valida ? { valor: valida, fonte: 'fixa+ia' } : null;
    }
  }

  // Pergunta já respondida na caixa de Perguntas do painel
  const minha = respondidas.find((r) => r.resposta && chavePergunta(r.pergunta) === chavePergunta(campo.rotulo));
  if (minha) {
    if (!ehEscolha(campo)) return { valor: campo.limite ? String(minha.resposta).slice(0, campo.limite) : minha.resposta, fonte: 'sua resposta' };
    const opcao = escolherOpcao(campo.opcoes || [], minha.resposta);
    if (opcao) return { valor: opcao, fonte: 'sua resposta' };
    // Opções diferentes das de outra empresa ("8,5" x "Entre 8 e 9"): a IA encaixa a resposta
    const escolhida = await iaFn({ pergunta: campo.rotulo, opcoes: campo.opcoes, contexto, vaga, dica: `O candidato já respondeu esta pergunta assim: ${minha.resposta}` });
    const valida = escolhida && escolherOpcao(campo.opcoes, escolhida);
    if (valida) return { valor: valida, fonte: 'sua resposta+ia' };
  }

  // Modo aprender: só perguntas objetivas
  const aprendida = aprendidas[chaveAprendida(campo.rotulo)];
  if (aprendida) {
    if (ehEscolha(campo)) {
      const opcao = escolherOpcao(campo.opcoes || [], String(aprendida.valor));
      if (opcao) return { valor: opcao, fonte: 'aprendido' };
    } else if (campo.tipo === 'texto' && String(aprendida.valor).length <= 60) {
      return { valor: String(aprendida.valor), fonte: 'aprendido' };
    }
  }

  if (ehEscolha(campo)) {
    if (!campo.opcoes?.length) return null;
    const escolhida = await iaFn({ pergunta: campo.rotulo, opcoes: campo.opcoes, contexto, vaga });
    const valida = escolhida && escolherOpcao(campo.opcoes, escolhida);
    return valida ? { valor: valida, fonte: 'ia' } : null;
  }
  // Texto curto obrigatório também vai para a IA, que só responde se souber
  if (campo.tipo === 'textarea' || (campo.tipo === 'texto' && (rotulo.length >= 25 || campo.obrigatorio))) {
    const apresentacao = /saber mais sobre voce|apresente-se|apresentacao pessoal|fale (um pouco )?(mais )?sobre voce|conte (um pouco )?(mais )?sobre voce|quem e voce/.test(rotulo);
    const dica = apresentacao
      ? 'É a apresentação pessoal do candidato para esta vaga. Escreva de 4 a 6 frases, em primeira pessoa, com base na trajetória e nos textos dele: quem é, o que estuda, o que já fez de concreto (projetos, trabalhos) e por que combina com ESTA vaga. Sem inventar nada.'
      : undefined;
    const limite = Math.min(campo.limite ? Math.floor(campo.limite * 0.85) : (apresentacao ? 1200 : 600), 1500);
    const palavras = campo.limitePalavras ? Math.floor(campo.limitePalavras * 0.85) : null;
    const texto = await iaFn({ pergunta: campo.rotulo, limite, palavras, contexto, vaga, dica });
    return texto ? { valor: cortarNoLimite(texto, campo.limite || limite, campo.limitePalavras), fonte: 'ia' } : null;
  }
  return null;
}

module.exports = { decidir, escolherOpcao, norm, detectarPessoal, cortarNoLimite, CURRICULO };
