// Agente de IA: entra em ação quando o robô de regras trava (antes de pedir a sua ajuda).
// A cada passo ele recebe um print da tela + a lista de campos e botões, decide o que fazer
// e o Playwright executa. As travas de segurança ficam AQUI no código, fora do alcance da IA:
//   - nunca clica no envio final no modo teste; nunca cria conta; nunca resolve CAPTCHA;
//   - senha e dados do cofre (CPF, RG...) nunca vão para a IA: ela escreve {{cpf}} e o código troca;
//   - sem certeza, devolve "ajuda" e o Rota chama você.

const fs = require('fs');
const path = require('path');
const ia = require('../ia/gemini');
const { lerCampos, temDesafio } = require('../candidatura/leitor-pagina');
const { detectarPessoal } = require('../candidatura/respostas');
const { entrarComSenha } = require('../navegador/login');
const logins = require('../util/logins');
const { pausa } = require('../navegador/navegador');

const MAX_PASSOS = 30;
const SUCESSO = /candidatura (enviada|realizada|conclu[ií]da|finalizada|recebida)|inscri[cç][aã]o (realizada|conclu[ií]da|enviada)|recebemos (a )?sua candidatura|obrigad[oa] (por se candidatar|pela (sua )?candidatura)|thank(s| you) for (your )?appl|application (submitted|received|sent)|we.?ve received your application/i;
const FINAL = /^(enviar|finalizar|concluir|submit|send|confirmar)( a| minha)?( candidatura| inscri[cç][aã]o| application| aplica[cç][aã]o)?$|enviar candidatura|finalizar candidatura|finalizar inscri[cç][aã]o|submit application|send application/i;
const PROIBIDO = /criar (uma |sua )?conta|create (an |your )?account|sign ?up|registre-se|registrar-se|cadastre-se|crie sua conta|excluir|apagar|remover candidatura|cancelar candidatura|desistir|sair da conta|logout|log out|denunciar/i;

// roda na página: botões e links clicáveis, marcados com data-rota-ag
function lerBotoes() {
  const todos = (sel, raiz = document) => { const out = [...raiz.querySelectorAll(sel)]; for (const e of raiz.querySelectorAll('*')) if (e.shadowRoot) out.push(...todos(sel, e.shadowRoot)); return out; };
  const visivel = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const lista = [];
  const vistos = new Set();
  for (const e of todos('button, a[href], [role=button], [role=link], [role=tab], [role=menuitem], input[type=submit], input[type=button], [onclick]')) {
    if (!visivel(e) || e.closest('#rota-aviso') || vistos.has(e)) continue;
    vistos.add(e);
    const texto = (e.innerText || e.value || e.getAttribute('aria-label') || e.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
    if (!texto || texto.length > 70) continue;
    const id = `b${lista.length}`;
    e.setAttribute('data-rota-ag', id);
    lista.push({ id, texto, desativado: !!e.disabled || e.getAttribute('aria-disabled') === 'true' });
    if (lista.length >= 90) break;
  }
  const erros = [...document.querySelectorAll('[role=alert], [aria-invalid=true], [class*=error i], [class*=erro i], [class*=invalid i]')]
    .map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 200);
  const aviso = document.getElementById('rota-aviso');
  const texto = (document.body?.innerText || '').replace(aviso?.innerText || '\u0000', '').replace(/\n{2,}/g, '\n').slice(0, 3500);
  return { botoes: lista, erros: [...new Set(erros)].slice(0, 8), texto, url: location.href, titulo: document.title };
}

const temBotaoLinkedin = (pagina) => pagina.evaluate(() => [...document.querySelectorAll('button, a, [role=button]')]
  .some((e) => e.getBoundingClientRect().width > 0 && /^(entrar com |continuar com |sign in with |login com )?linkedin$/i.test((e.innerText || e.getAttribute('aria-label') || '').trim()))).catch(() => false);

// obrigatórios ainda vazios na tela (lista de país ao lado do telefone não conta)
async function obrigatoriosVazios(pagina) {
  const campos = await pagina.evaluate(lerCampos).catch(() => []);
  return campos.filter((c) => c.obrigatorio && !c.preenchido && c.rotulo && !c.autopreencher && !c.codigoPais
    && !(c.tipo === 'combobox' && campos.some((o) => o !== c && o.rotulo === c.rotulo && o.preenchido))).map((c) => c.rotulo);
}

function curriculo(perfil) {
  const doPerfil = String(perfil?.curriculo_arquivo || '').replace(/["']/g, '').trim();
  if (doPerfil && fs.existsSync(doPerfil)) return doPerfil;
  const reserva = path.join(__dirname, '..', '..', 'dados', 'curriculo.pdf');
  return fs.existsSync(reserva) ? reserva : null;
}

// {{email}} -> valor real (a IA nunca vê CPF, RG, senha...)
function trocarMarcadores(texto, dados) {
  return String(texto ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k) => (dados[k.toLowerCase()] != null ? String(dados[k.toLowerCase()]) : m));
}

async function pedirAoGemini({ prompt, imagem }, { fetchFn = fetch } = {}) {
  const modelo = process.env.GEMINI_MODELO_AGENTE || process.env.GEMINI_MODELO || 'gemini-3.8-flash';
  const corpo = {
    contents: [{ role: 'user', parts: [{ text: prompt }, ...(imagem ? [{ inline_data: { mime_type: 'image/jpeg', data: imagem } }] : [])] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 2048, responseMimeType: 'application/json' },
  };
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const resp = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY }, body: JSON.stringify(corpo),
    });
    if (resp.status === 429 && tentativa === 0) { await new Promise((r) => setTimeout(r, 60000)); continue; } // limite por minuto do plano grátis
    if (!resp.ok) throw new Error(`Gemini recusou (${resp.status}): ${(await resp.text()).slice(0, 160)}`);
    const dados = await resp.json();
    const texto = (dados.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    return JSON.parse(texto.replace(/^```(json)?|```$/g, '').trim());
  }
  throw new Error('Gemini: limite de uso atingido (plano grátis). Tento de novo mais tarde.');
}

function montarPrompt({ vaga, candidato, marcadores, campos, tela, historico, modoTeste, temLogin, inicio, objetivo }) {
  return [
    objetivo === 'login'
      ? 'Você é o agente que ENTRA na conta do candidato num site de vagas, num navegador. Seu único objetivo agora é fazer login (não se candidate a nada). Se o site tiver "Entrar"/"Login"/"Acessar", clique; na tela de login use a ação "login_social" (se houver botão do LinkedIn) ou "login" (e-mail e senha salvos). Quando a página mostrar que o candidato está logado (nome dele, foto, "Sair", "Minha conta", área do candidato), status "logado".'
      : inicio
      ? 'Você é o agente que faz candidaturas a vagas de emprego NO LUGAR do candidato, num navegador. Você começa na página da vaga: clique no botão de candidatura e faça a inscrição inteira até o fim.'
      : 'Você é o agente que termina candidaturas a vagas de emprego NO LUGAR do candidato, num navegador. Um robô de regras já tentou e travou; você continua de onde está.',
    'A cada passo você recebe: um print da tela, os CAMPOS (com id cN) e os BOTÕES (com id bN). Responda com as próximas ações (até 8) e o status.',
    'REGRAS:',
    '- Use SOMENTE os dados do candidato abaixo. Nunca invente experiência, nota, documento, tecnologia ou nível.',
    '- Dados de contato e documentos: escreva o MARCADOR (ex.: {{email}}, {{telefone}}, {{cpf}}) e o sistema troca pelo valor real. Marcadores disponíveis: ' + marcadores.join(', ') + '.',
    '- Raça/cor, gênero, orientação, deficiência: se houver opção "Prefiro não responder/informar", use-a; senão use a resposta cadastrada pelo candidato; se não houver, peça ajuda.',
    '- Campo de arquivo de currículo: ação "preencher" com valor "{{curriculo}}".',
    '- Tela de login com botão do LinkedIn: SEMPRE ação "login_social" (o candidato entra pelo LinkedIn), mesmo que também tenha e-mail e senha.',
    '- Tela de login com e-mail e senha, sem LinkedIn: ação "login" (o sistema digita o e-mail e a senha salvos). ' + (temLogin ? 'Existe login salvo para este site.' : 'NÃO existe login salvo para este site.'),
    '- Tela de login com botão "Entrar com LinkedIn" ou "Google" (ex.: Gupy): ação "login_social" (o sistema faz). Sem login salvo e sem botão social: status "ajuda".',
    '- NUNCA crie conta, nunca clique em cadastrar-se/criar conta, nunca resolva CAPTCHA ("não sou robô"): nesses casos, status "ajuda".',
    '- Teste de perfil, jogo, teste comportamental ou técnico: status "ajuda".',
    '- Se a página disser que o candidato já se candidatou a esta vaga: status "ja_candidatado".',
    modoTeste
      ? '- MODO TESTE: quando tudo estiver preenchido e o próximo passo for o envio final da candidatura, NÃO clique: responda status "pronto_para_enviar".'
      : '- Quando tudo estiver preenchido, clique no botão de envio final e marque "final": true nessa ação.',
    '- Botões "Continuar", "Próximo", "Salvar e continuar" avançam etapas (não são o envio final). Marque "final": true só no clique que ENVIA a candidatura.',
    '- Campo recusado (mensagem de erro): corrija com outro formato (ex.: telefone com ou sem +55, data DD/MM/AAAA).',
    '- Campos opcionais sem informação verdadeira: deixe em branco.',
    'Formato da resposta (JSON): {"pensamento":"<curto>","acoes":[{"acao":"preencher","id":"c3","valor":"..."},{"acao":"clicar","id":"b2","final":false},{"acao":"login"},{"acao":"login_social"},{"acao":"rolar"},{"acao":"esperar"}],"status":"continuar|pronto_para_enviar|enviado|ja_candidatado|logado|ajuda","motivo":"<se ajuda: o que falta>"}',
    `VAGA: ${vaga?.titulo || ''} — ${vaga?.empresa || ''}`,
    `DADOS DO CANDIDATO\n${candidato}`,
    `PÁGINA: ${tela.titulo} — ${tela.url}`,
    tela.erros.length ? `MENSAGENS DE ERRO NA TELA: ${tela.erros.join(' | ')}` : '',
    `CAMPOS:\n${JSON.stringify(campos)}`,
    `BOTÕES:\n${JSON.stringify(tela.botoes.map((b) => ({ id: b.id, texto: b.texto, ...(b.desativado ? { desativado: true } : {}) })))}`,
    `TEXTO DA TELA (início):\n${tela.texto}`,
    historico.length ? `O QUE VOCÊ JÁ FEZ (últimos passos):\n${historico.slice(-8).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

// pagina/contexto: a janela onde o robô travou. preencherFn: o preenchedor do robô (sabe lidar com
// listas, rádios, telefone, upload...). Devolve { resultado, motivo, respostas, passos }
// inicio: começa na página da vaga (teste "só IA"); pastaPrints: salva print e decisão de cada passo;
// loginSocialFn: entra pelo botão do LinkedIn/Google (Gupy)
// objetivo "login": só entra na conta (logadoFn diz quando conseguiu)
async function agir({ pagina, contexto, ctx, vaga, preencherFn, log = async () => {}, pedirFn = pedirAoGemini, inicio = false, pastaPrints = null, loginSocialFn = null, objetivo = 'candidatura', logadoFn = null }) {
  if (!ia.disponivel()) return { resultado: 'pulada', motivo: 'agente de IA desligado (sem GEMINI_API_KEY)', respostas: [], passos: 0 };
  const modoTeste = !!ctx.config?.modoTeste;
  const perfil = ctx.perfil || {};
  const pessoais = ctx.pessoais || {};
  const dados = {
    nome: perfil.nome, email: perfil.email, telefone: perfil.telefone, cidade: perfil.cidade, linkedin: perfil.linkedin_url,
    github: perfil.github_url, portfolio: perfil.portfolio_url, curriculo: curriculo(perfil), ...pessoais,
  };
  const marcadores = Object.entries(dados).filter(([, v]) => v != null && v !== '').map(([k]) => `{{${k}}}`);
  const contextoCandidato = {
    perfil: { ...perfil, email: undefined, telefone: undefined }, listas: ctx.listas || {}, respostasFixas: ctx.respostasFixas || [],
    respondidas: [...(ctx.respondidas || []), ...(ctx.aprendidas || [])],
  };
  const candidato = ia.descreverCandidato(contextoCandidato);
  const respostas = [];
  const historico = [];
  let semMudar = 0;
  let assinaturaAnterior = '';

  for (let passo = 1; passo <= MAX_PASSOS; passo++) {
    // a ação pode ter aberto outra aba
    if (pagina.isClosed()) pagina = contexto.pages().at(-1);
    if (!pagina) return { resultado: 'pulada', motivo: 'a janela fechou', respostas, passos: passo };
    await pagina.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    await pausa(800, 1500);
    if (await pagina.evaluate(temDesafio).catch(() => null)) return { resultado: 'pulada', motivo: 'o site pediu CAPTCHA/verificação anti-robô', respostas, passos: passo };

    if (objetivo === 'login' && logadoFn && await logadoFn(pagina).catch(() => false)) return { resultado: 'logado', motivo: 'conta conectada', respostas, passos: passo };
    const corpo = await pagina.innerText('body').catch(() => '');
    if (SUCESSO.test(corpo) && !modoTeste) return { resultado: 'enviada', motivo: 'o agente de IA concluiu a candidatura', respostas, passos: passo };

    const camposBrutos = await pagina.evaluate(lerCampos).catch(() => []);
    const campos = camposBrutos.filter((c) => c.rotulo || c.obrigatorio).slice(0, 60).map((c) => {
      const sensivel = detectarPessoal(c.rotulo) || c.html === 'password';
      return {
        id: `c${c.id}`, tipo: c.tipo, pergunta: String(c.rotulo || '(sem nome)').slice(0, 200),
        ...(c.opcoes?.length ? { opcoes: c.opcoes.slice(0, 30) } : {}),
        ...(c.obrigatorio ? { obrigatorio: true } : {}),
        preenchido: !!c.preenchido,
        ...(c.valor && !sensivel ? { valor: String(c.valor).slice(0, 80) } : {}),
      };
    });
    const tela = await pagina.evaluate(lerBotoes).catch(() => ({ botoes: [], erros: [], texto: '', url: pagina.url(), titulo: '' }));

    // mesma tela 3 vezes seguidas: não está saindo do lugar
    const assinatura = JSON.stringify([tela.url, campos.map((c) => [c.id, c.preenchido, c.valor]), tela.erros]);
    semMudar = assinatura === assinaturaAnterior ? semMudar + 1 : 0;
    assinaturaAnterior = assinatura;
    if (semMudar >= 3) return { resultado: 'pulada', motivo: `o agente ficou parado na mesma tela${tela.erros.length ? ` (a página diz: ${tela.erros.join(' | ').slice(0, 200)})` : ''}`, respostas, passos: passo };

    const bruta = await pagina.screenshot({ type: 'jpeg', quality: 45 }).catch(() => null);
    const imagem = bruta ? bruta.toString('base64') : null;
    const base = pastaPrints ? path.join(pastaPrints, String(passo).padStart(2, '0')) : null;
    if (base && bruta) { fs.mkdirSync(pastaPrints, { recursive: true }); fs.writeFileSync(`${base}.jpg`, bruta); }
    let plano;
    try {
      plano = await pedirFn({ prompt: montarPrompt({ vaga, candidato, marcadores, campos, tela, historico, modoTeste, temLogin: !!logins.obter(tela.url), inicio, objetivo }), imagem });
      if (base) fs.writeFileSync(`${base}.json`, JSON.stringify({ url: tela.url, campos, botoes: tela.botoes, erros: tela.erros, plano }, null, 2));
    } catch (e) {
      return { resultado: 'pulada', motivo: `agente de IA: ${e.message.slice(0, 200)}`, respostas, passos: passo };
    }
    await log('info', 'agente', `passo ${passo}: ${String(plano.pensamento || '').slice(0, 160)}`);
    const status = String(plano.status || 'continuar');

    for (const a of (Array.isArray(plano.acoes) ? plano.acoes : []).slice(0, 8)) {
      const acao = String(a.acao || '');
      try {
        if (acao === 'preencher') {
          const campo = camposBrutos.find((c) => `c${c.id}` === a.id);
          if (!campo) { historico.push(`- preencher ${a.id}: campo não existe`); continue; }
          let valor = trocarMarcadores(a.valor, dados);
          if (/\{\{/.test(valor)) { historico.push(`- preencher "${campo.rotulo}": NÃO tenho esse dado (${a.valor}); se for obrigatório, peça ajuda`); continue; }
          if (campo.tipo === 'arquivo' && !fs.existsSync(valor)) { historico.push(`- currículo: arquivo não encontrado`); continue; }
          await preencherFn(pagina, campo, valor);
          const mostrado = detectarPessoal(campo.rotulo) ? '(dado pessoal)' : campo.tipo === 'arquivo' ? path.basename(valor) : valor;
          respostas.push({ pergunta: campo.rotulo, resposta: mostrado, fonte: 'agente' });
          historico.push(`- preenchi "${String(campo.rotulo).slice(0, 60)}" = ${String(mostrado).slice(0, 60)}`);
        } else if (acao === 'clicar') {
          const botao = tela.botoes.find((b) => b.id === a.id);
          if (!botao) { historico.push(`- clicar ${a.id}: botão não existe`); continue; }
          if (PROIBIDO.test(botao.texto) || ia.BOTAO_PROIBIDO.test(botao.texto) && !/cookie/i.test(botao.texto)) {
            historico.push(`- NÃO cliquei em "${botao.texto}" (proibido: criar conta/sair/cancelar)`);
            continue;
          }
          const final = objetivo !== 'login' && (a.final === true || FINAL.test(botao.texto));
          if (final) {
            const vazios = await obrigatoriosVazios(pagina);
            if (vazios.length) { historico.push(`- NÃO enviei: ainda faltam obrigatórios: ${vazios.slice(0, 5).join(' | ')}`); break; }
          }
          if (final && modoTeste) return { resultado: 'simulada', motivo: `Modo teste: o agente de IA preencheu tudo e parou antes de "${botao.texto}"`, respostas, passos: passo };
          const abertas = new Set(contexto.pages());
          await pagina.locator(`[data-rota-ag="${a.id}"]`).first().click({ timeout: 8000 })
            .catch(() => pagina.locator(`[data-rota-ag="${a.id}"]`).first().evaluate((e) => e.click()));
          historico.push(`- cliquei em "${botao.texto}"`);
          await pausa(1500, 2500);
          const nova = contexto.pages().find((p) => !abertas.has(p));
          if (nova) { pagina = nova; historico.push('- abriu uma aba nova; continuei nela'); }
          if (final) {
            await pausa(3000, 4000);
            if (SUCESSO.test(await pagina.innerText('body').catch(() => ''))) return { resultado: 'enviada', motivo: 'o agente de IA enviou a candidatura', respostas, passos: passo };
          }
          break; // depois de um clique a tela muda: olha de novo antes de seguir
        } else if (acao === 'login' && loginSocialFn && await temBotaoLinkedin(pagina)) {
          // tem LinkedIn na tela: entra por ele (pedido do Gustavo)
          const r = await loginSocialFn(pagina);
          historico.push(r.ok ? '- entrei pelo LinkedIn' : `- login pelo LinkedIn falhou: ${r.motivo}`);
          if (!r.ok) return { resultado: 'pulada', motivo: `login pelo LinkedIn: ${r.motivo}`, respostas, passos: passo };
          if (pagina.isClosed()) pagina = contexto.pages().at(-1);
          break;
        } else if (acao === 'login') {
          const cred = logins.obter(pagina.url());
          if (!cred) return { resultado: 'pulada', motivo: `o site pede login e não há login salvo para ${new URL(pagina.url()).hostname} (npm run login:salvar)`, respostas, passos: passo };
          const r = await entrarComSenha(pagina, cred);
          historico.push(r.ok ? `- entrei com o login salvo de ${cred.dominio}` : `- login falhou: ${r.motivo}`);
          if (!r.ok) return { resultado: 'pulada', motivo: `login em ${cred.dominio}: ${r.motivo}`, respostas, passos: passo };
          break;
        } else if (acao === 'login_social') {
          if (!loginSocialFn) return { resultado: 'pulada', motivo: 'o site pede login pelo LinkedIn/Google', respostas, passos: passo };
          const r = await loginSocialFn(pagina);
          historico.push(r.ok ? '- entrei pelo botão do LinkedIn/Google' : `- login social falhou: ${r.motivo}`);
          if (!r.ok) return { resultado: 'pulada', motivo: `login pelo LinkedIn/Google: ${r.motivo}`, respostas, passos: passo };
          if (contexto.pages().length && pagina.isClosed()) pagina = contexto.pages().at(-1);
          break;
        } else if (acao === 'rolar') {
          await pagina.mouse.wheel(0, 700).catch(() => {});
          historico.push('- rolei a página');
        } else if (acao === 'esperar') {
          await pausa(2500, 3500);
          historico.push('- esperei a página');
        }
      } catch (e) {
        historico.push(`- ${acao} ${a.id || ''} deu erro: ${e.message.split('\n')[0].slice(0, 120)}`);
      }
    }

    if (status === 'logado' && objetivo === 'login') {
      if (!logadoFn || await logadoFn(pagina).catch(() => false)) return { resultado: 'logado', motivo: 'conta conectada', respostas, passos: passo };
      historico.push('- você disse que está logado, mas a página ainda não mostra a conta');
    }
    if (status === 'ja_candidatado') return { resultado: 'ja_candidatado', motivo: 'Você já se candidatou a esta vaga (visto pelo agente de IA)', respostas, passos: passo };
    if (status === 'ajuda') return { resultado: 'pulada', motivo: `o agente de IA precisa de você: ${String(plano.motivo || '').slice(0, 250)}`, respostas, passos: passo };
    if (status === 'pronto_para_enviar' && modoTeste) {
      const vazios = await obrigatoriosVazios(pagina);
      if (!vazios.length) return { resultado: 'simulada', motivo: 'Modo teste: o agente de IA preencheu tudo e parou antes do envio', respostas, passos: passo };
      historico.push(`- ainda NÃO está pronto: obrigatórios vazios: ${vazios.slice(0, 5).join(' | ')}`);
    }
    if (status === 'enviado' && !modoTeste) {
      if (SUCESSO.test(await pagina.innerText('body').catch(() => ''))) return { resultado: 'enviada', motivo: 'o agente de IA enviou a candidatura', respostas, passos: passo };
    }
  }
  return { resultado: 'pulada', motivo: `o agente de IA passou de ${MAX_PASSOS} passos sem terminar`, respostas, passos: MAX_PASSOS };
}

module.exports = { agir, lerBotoes, trocarMarcadores, montarPrompt, FINAL, PROIBIDO };
