// O que o bot aprendeu observando o usuário (modo aprender), salvo em dados/aprendizado/gupy.json

const fs = require('fs');
const path = require('path');

const PASTA = path.join(__dirname, '..', '..', 'dados', 'aprendizado');
const ARQUIVO = path.join(PASTA, 'gupy.json');
const VAZIO = { botoesCandidatar: [], botoesAvancar: [], botoesFinal: [], botoesFechar: [], respostas: {}, textos: [] };

const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
// Sem acento, minúscula, sem o "*" de obrigatório e sem ":" no fim
const chave = (t) => norm(t).replace(/[\s*:]+$/, '');
// Igual, mas também sem a numeração do formulário ("3. Qual...")
const chavePergunta = (t) => chave(t).replace(/^\d{1,2}\s*[.)\-:]\s*/, '').slice(0, 400);
const escapar = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Botão de fechar aviso precisa ter cara de dispensar algo
const DISPENSA = /(^|\s)(n[aã]o|fechar|close|rejeitar|recusar|agora n[aã]o|depois|entendi|ok|dispensar|pular|continuar sem|x|×)(\s|,|!|\.|$)/i;
// Login nunca é "avançar etapa"
const LOGIN = /^(entrar|acessar( conta)?|login|log in|sign in|fazer login|continuar com|linkedin|google)$/i;
const PAGINA_LOGIN = /linkedin\.com|google\.com|accounts\.|(^|\/\/)login\.|signin|sign-in|\/login/i;

// Evita aprender "Linux" só porque foi clicado logo antes
const FINAL = /finaliz|envi|conclu|confirm|candidat|inscri|aplica|submeter|terminar|pronto/i;
// Texto de opção (Sim/Não) ou curto demais não é pergunta
const PERGUNTA_RUIM = (p) => !p || p.length < 8 || /^(sim|n[aã]o|true|false|outro|outros)$/i.test(p.trim());

const CONTADOR = /^(m[aá]x(imo)?\.?\s*(de\s*)?[\d.]+\s*caracteres?|[\d.]+\s*\/\s*[\d.]+\s*caracteres?|[\d.]+\s*caracteres?( restantes)?)$/i;

// "Avançar" nunca pode ser um botão que envia (no modo teste ele seria clicado!) nem um "Adicionar"
const NAO_AVANCAR = /envi|submit|finaliz|conclu|confirm|candidat|aplica|apply|inscri|adicion|\badd\b|incluir|novo|nova|editar|\bedit\b|remov|exclu|apagar|delete/i;
// Campos de uma lista repetida (cada experiência/formação tem os seus): uma resposta não vale para todas
const CAMPO_DE_LISTA = /data de (inicio|termino|fim|conclusao)|start date|end date|from date|to date|(^|\s)(mes|ano|month|year)$|empregador|employer|nome da empresa|company name|cargo|job title|position title|supervisor|gestor|escola|school|institui|faculdade|universidade|degree|grau|principal|major|area de estudo|field of study|emprego atual|current(ly)? (job|employer|work)|atualmente trabalho|cidade empregadora|pais do empregador/;
// Dados do endereço vão para o cofre criptografado, nunca para este arquivo
const ENDERECO = /cep|codigo postal|postal code|zip|codigo do estado|state\/province|estado\/provincia|logradouro|endereco|address|bairro|numero da residencia/;

// Remove o que foi aprendido errado, inclusive de gravações antigas
function limpar(dados) {
  dados.botoesFechar = dados.botoesFechar.filter((t) => DISPENSA.test(t));
  dados.botoesAvancar = dados.botoesAvancar.filter((t) => !LOGIN.test(t.trim()) && !NAO_AVANCAR.test(t));
  dados.botoesFinal = dados.botoesFinal.filter((t) => FINAL.test(t) && !/acompanh|minhas|ver candidatura/i.test(t));
  dados.textos = (dados.textos || []).filter((t) => !CONTADOR.test(String(t.pergunta).trim()) && !PERGUNTA_RUIM(t.pergunta));
  dados.respostas = Object.fromEntries(Object.entries(dados.respostas || {})
    .filter(([k, r]) => !PERGUNTA_RUIM(r.pergunta) && !CAMPO_DE_LISTA.test(k) && !ENDERECO.test(k)));
  dados.textos = dados.textos.filter((t) => !CAMPO_DE_LISTA.test(chave(t.pergunta)));
  return dados;
}

function carregar() {
  try { return limpar({ ...VAZIO, ...JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')) }); } catch { return { ...VAZIO }; }
}

function salvar(dados) {
  fs.mkdirSync(PASTA, { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify(dados, null, 2));
}

// Junta textos aprendidos numa expressão: ^(base|aprendido1|aprendido2)$
function regexCom(baseInterna, aprendidos) {
  const extras = (aprendidos || []).map((t) => escapar(t));
  return `^(${[baseInterna, ...extras].join('|')})$`;
}

// Botão que começa a candidatura; "Finalizar/Acompanhar candidatura" não contam
const CANDIDATAR = /candidat|aplica|inscrev|inscri[cç]/i;
const NAO_E_INICIO = /finaliz|envi|conclu|confirm|acompanh|minhas|ver candidatura|cancel/i;
const ruim = (t) => !t || t.length > 40 || /^(voltar|anterior|cancelar|sair|editar)$/i.test(t);

// Tira lições de uma gravação e devolve só o que é novo
function aprender(eventos) {
  const dados = carregar();
  const novo = { botoesCandidatar: [], botoesAvancar: [], botoesFinal: [], botoesFechar: [], respostas: {} };
  const add = (lista, texto) => {
    if (ruim(texto) || dados[lista].some((t) => norm(t) === norm(texto))) return;
    dados[lista].push(texto);
    novo[lista].push(texto);
  };

  const cliques = eventos.filter((e) => e.tipo === 'clique');
  for (const ev of eventos) {
    if (ev.url && PAGINA_LOGIN.test(ev.url)) continue; // nada da tela de login vira regra
    if (ev.tipo === 'clique') {
      if (ev.aviso) { if (DISPENSA.test(ev.texto)) add('botoesFechar', ev.texto); continue; }
      if (LOGIN.test(ev.texto)) continue;
      if (!ev.depois) continue;
      // Outro clique em menos de 3s pode ter causado a mudança
      const proximo = cliques[cliques.indexOf(ev) + 1];
      if (proximo && ev.em && proximo.em && new Date(proximo.em) - new Date(ev.em) < 3000) continue;
      if (ev.sucessoAntes) continue; // página já concluída
      if (ev.depois.sucesso) { if (FINAL.test(ev.texto) && !/acompanh|minhas/i.test(ev.texto)) add('botoesFinal', ev.texto); }
      else if (CANDIDATAR.test(ev.texto) && !NAO_E_INICIO.test(ev.texto)) add('botoesCandidatar', ev.texto);
      else if (CANDIDATAR.test(ev.texto)) continue;
      else if (ev.depois.mudouPagina && ['button', 'a', 'input'].includes(ev.tag) && !NAO_AVANCAR.test(ev.texto)) add('botoesAvancar', ev.texto);
    }
    if (ev.tipo === 'campo' && !ev.sensivel && !PERGUNTA_RUIM(ev.pergunta)) {
      if (CAMPO_DE_LISTA.test(chave(ev.pergunta)) || ENDERECO.test(chave(ev.pergunta))) continue;
      const curta = typeof ev.valor === 'string' && ev.valor.length <= 60;
      const objetiva = ['select', 'radio', 'checkbox'].includes(ev.campo) || (['text', 'number'].includes(ev.campo) && curta);
      if (objetiva && ev.valor !== '' && ev.valor != null) {
        dados.respostas[chave(ev.pergunta)] = { pergunta: ev.pergunta, valor: ev.valor, campo: ev.campo };
        novo.respostas[chave(ev.pergunta)] = dados.respostas[chave(ev.pergunta)];
      } else if (typeof ev.valor === 'string' && ev.valor.trim().length > 20) {
        // Resposta aberta vira exemplo para a IA, não é copiada igual
        dados.textos = (dados.textos || []).filter((t) => chave(t.pergunta) !== chave(ev.pergunta));
        dados.textos.push({ pergunta: ev.pergunta, valor: ev.valor.trim() });
        dados.textos = dados.textos.slice(-40);
        (novo.textos ||= []).push(ev.pergunta);
      }
    }
  }
  // Um botão que finaliza não deve ser tratado como "avançar"
  dados.botoesAvancar = dados.botoesAvancar.filter((t) => !dados.botoesFinal.some((f) => norm(f) === norm(t)));
  salvar(limpar(dados));
  return novo;
}


// Botão descoberto pela IA: guarda para não precisar perguntar de novo
function anotarBotao(lista, texto) {
  if (!texto || ruim(texto) || LOGIN.test(texto.trim())) return false;
  const dados = carregar();
  if (dados[lista].some((t) => norm(t) === norm(texto))) return false;
  dados[lista].push(texto);
  salvar(limpar(dados));
  return true;
}

module.exports = { carregar, salvar, aprender, anotarBotao, regexCom, chave, chavePergunta, ARQUIVO, PASTA };
