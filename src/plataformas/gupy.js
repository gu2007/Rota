// Motor de candidatura (Gupy e sites de empresas): lê cada etapa, decide as respostas e avança.
// Para em CAPTCHA, falha de login, teste online ou pergunta obrigatória sem resposta.
// No modo teste preenche tudo e nunca clica no botão final. Prints de cada etapa em dados/<plataforma>/.

const fs = require('fs');
const path = require('path');
const { abrirNavegador, pausa, digitar, lerPagina, definirVelocidade } = require('../navegador/navegador');
const { lerCampos, acharBotao, temDesafio, botaoDesativado } = require('../candidatura/leitor-pagina');
const secoes = require('../candidatura/secoes');
const { avisar } = require('../navegador/aviso');
const { aceitarCookies } = require('../navegador/cookies');
const { entrarComSenha } = require('../navegador/login');
const logins = require('../util/logins');
const { decidir, norm, CURRICULO, detectarPessoal, escolherOpcao } = require('../candidatura/respostas');
const { dataLocal } = require('../util/tempo');
const aprendizado = require('../candidatura/aprendizado');
const ia = require('../ia/gemini');
const { conferirArea } = require('../ia/conferir-area');

const MAX_AJUDAS_IA = 4; // por vaga

const PASTA_LOGS = path.join(__dirname, '..', '..', 'dados', 'gupy');
const MAX_ETAPAS = 15;

// textos aprendidos no modo aprender são somados a estes
const BASE_CANDIDATAR = 'candidatar-se|candidate-se|quero me candidatar|candidatar|candidatar-se agora|aplicar para a vaga|aplicar|candidatura r[aá]pida|aplica[cç][aã]o r[aá]pida|candidatar-se com 1 clique|inscrever-se|inscreva-se|quero participar|quero me inscrever|tenho interesse|i.?m interested|apply|apply now|apply for this (job|position|role)';
const BASE_PROXIMO = 'ok|continuar( com a vaga| candidatura| para a vaga| inscri[cç][aã]o)?|pr[oó]xim[oa]( etapa| passo)?|avan[cç]ar|salvar e continuar|seguir|ir para a pr[oó]xima etapa|next|next step|continue|save and continue';
const BASE_FINAL = 'finalizar( candidatura)?|enviar candidatura|enviar( minha)? candidatura|enviar|concluir( candidatura)?|confirmar candidatura|finalizar inscri[cç][aã]o|submit|submit application|send application|enviar inscri[cç][aã]o';

const JA_CANDIDATADO = /voc[eê] j[aá] se candidatou|you have already applied|voc[eê] j[aá] se inscreveu|candidatura j[aá] (foi )?(realizada|enviada)|j[aá] est[aá] participando|voc[eê] j[aá] est[aá] (inscrito|participando)/i;
const SUCESSO = /candidatura (enviada|realizada|conclu[ií]da|finalizada|recebida)|parab[eé]ns|inscri[cç][aã]o (realizada|conclu[ií]da|enviada)|recebemos (a )?sua candidatura|obrigad[oa] (por se candidatar|pela (sua )?candidatura)|thank(s| you) for (your )?appl|application (submitted|received|sent)|we.?ve received your application/i;
const CURRICULO_INCOMPLETO = /precisa preencher (o )?seu curr[ií]culo|complete (o )?seu curr[ií]culo|preencher curr[ií]culo/i;
// avisos por cima da página (cookies, notificações): fecha recusando
// cookies: sempre a opção que recusa o que não é essencial
const BASE_FECHAR = 'n[aã]o,? obrigad[oa]|agora n[aã]o|dispensar|fechar aviso|entendi|ok, entendi|aceitar (todos|tudo|cookies|todos os cookies)|accept (all|cookies|all cookies)|allow all( cookies)?|permitir todos'; // cookies: aceita (pedido do Gustavo); o resto fica com navegador/cookies.js
const TESTE_ONLINE = /teste (de |do )?(perfil|comportamental|l[oó]gic|ingl[eê]s|online|t[eé]cnico|conhecimento)|game|jogo de|avalia[cç][aã]o (online|comportamental)/i;

async function textoTitulos(pagina) {
  return pagina.evaluate(() => [...document.querySelectorAll('h1, h2, h3, [role=heading]')]
    .map((h) => h.innerText).join(' | ')).catch(() => '');
}

// tenta os textos conhecidos e depois o "X" de qualquer diálogo
async function fecharAvisos(pagina, botoes) {
  await aceitarCookies(pagina);
  for (let i = 0; i < 4; i++) {
    let achou = await pagina.evaluate(acharBotao, botoes.fechar).catch(() => null);
    if (!achou) {
      achou = await pagina.evaluate(() => {
        const x = [...document.querySelectorAll('[role=dialog] button, [aria-modal=true] button, [class*=modal i] button, [class*=popup i] button')]
          .find((b) => b.getBoundingClientRect().width > 0 && /^(fechar|close|x|×|✕)$/i.test((b.getAttribute('aria-label') || b.innerText || '').trim()));
        if (x) x.setAttribute('data-rota-botao', '1');
        return !!x;
      }).catch(() => false);
    }
    if (!achou) return;
    await pausa(500, 1200);
    await pagina.locator('[data-rota-botao]').first().click().catch(() => {});
    await pagina.evaluate(() => (function limpa(r) { r.querySelectorAll('[data-rota-botao]').forEach((b) => b.removeAttribute('data-rota-botao')); r.querySelectorAll('*').forEach((e) => e.shadowRoot && limpa(e.shadowRoot)); })(document)).catch(() => {});
    await pausa(600, 1200);
  }
}

// para páginas que carregam aos poucos
async function esperarBotao(pagina, regexes, limiteMs = 8000) {
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    for (const re of regexes) {
      const achou = await pagina.evaluate(acharBotao, re).catch(() => null);
      if (achou) {
        await pagina.evaluate(() => (function limpa(r) { r.querySelectorAll('[data-rota-botao]').forEach((b) => b.removeAttribute('data-rota-botao')); r.querySelectorAll('*').forEach((e) => e.shadowRoot && limpa(e.shadowRoot)); })(document)).catch(() => {});
        return achou;
      }
    }
    await pausa(700, 900);
  }
  return null;
}

async function esperarPagina(pagina) {
  await pagina.waitForLoadState('domcontentloaded').catch(() => {});
  await pagina.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  await pausa(1200, 2500);
}

async function clicarBotao(pagina, contexto) {
  const botao = pagina.locator('[data-rota-botao]').first();
  await botao.scrollIntoViewIfNeeded().catch(() => {});
  await pausa(500, 1400);
  // alguns botões abrem aba nova. Se algo invisível cobrir o botão, usa el.click() direto:
  // um clique forçado por posição acertaria o elemento de cima (ex.: input de arquivo).
  const clicar = async () => {
    try { await botao.click({ timeout: 8000 }); }
    catch { await botao.evaluate((el) => el.click()); }
  };
  const [novaAba] = await Promise.all([
    contexto.waitForEvent('page', { timeout: 4000 }).catch(() => null),
    clicar(),
  ]);
  await pagina.evaluate(() => (function limpa(r) { r.querySelectorAll('[data-rota-botao]').forEach((b) => b.removeAttribute('data-rota-botao')); r.querySelectorAll('*').forEach((e) => e.shadowRoot && limpa(e.shadowRoot)); })(document)).catch(() => {});
  const atual = novaAba || pagina;
  await esperarPagina(atual);
  return atual;
}

// listas que só mostram as opções depois de abertas
// Texto de cada opção visível. Em componentes o texto fica fora do elemento (no <slot>)
const TEXTO_OPCAO = (els) => els.map((e) => {
  let t = (e.innerText || '').replace(/\s+/g, ' ').trim();
  if (!t && e.querySelectorAll) t = [...e.querySelectorAll('slot')].flatMap((s) => s.assignedNodes({ flatten: true })).map((n) => n.textContent || '').join(' ').replace(/\s+/g, ' ').trim();
  const host = !t && e.getRootNode && e.getRootNode().host;
  if (host) t = (host.innerText || host.textContent || '').replace(/\s+/g, ' ').trim();
  return t || (e.getAttribute('aria-label') || '').trim();
});
const textosOpcoes = (loc) => loc.evaluateAll(TEXTO_OPCAO).catch(() => []);

async function lerOpcoesLista(pagina, campo) {
  const el = pagina.locator(`[data-rota="${campo.id}"]`);
  try {
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.click({ timeout: 5000 });
    await pagina.locator('[role=option]:visible').first().waitFor({ timeout: 3000 });
    const textos = await textosOpcoes(pagina.locator('[role=option]:visible'));
    return [...new Set(textos)]
      .filter((t) => t && !/^(selecione|escolha|select|choose)\b/i.test(t));
  } catch { return []; }
  finally {
    await pagina.keyboard.press('Escape').catch(() => {});
    await pausa(300, 700);
  }
}

// após digitar num autocompletar, clica na sugestão mais parecida (cidade: prefere Brasil)
async function escolherSugestao(pagina, valor, esperaMs = 3500, soParecida = false) {
  const opcoes = pagina.locator('[role=option]:visible, [role=listbox] li:visible, .pac-item:visible, [class*=suggestion i]:visible, [class*=autocomplete i] li:visible');
  const fim = Date.now() + esperaMs;
  while (Date.now() < fim && !(await opcoes.count().catch(() => 0))) await pausa(250, 300);
  const textos = await textosOpcoes(opcoes);
  if (!textos.filter(Boolean).length) return false;
  const base = valor.split(',')[0].trim();
  const comBase = textos.filter((t) => norm(t).includes(norm(base)));
  const escolhido = comBase.find((t) => /brasil|brazil|\bsp\b|s[aã]o paulo/i.test(t) && /brasil|brazil/i.test(t))
    || comBase.find((t) => /brasil|brazil/i.test(t)) || comBase[0] || (soParecida ? null : escolherOpcao(textos, valor));
  if (!escolhido) return false;
  await opcoes.nth(textos.indexOf(escolhido)).click({ timeout: 4000 }).catch(() => {});
  await pausa(300, 700);
  return true;
}

// Digita o telefone tecla por tecla e confere o que ficou no campo. Tenta, nessa ordem:
// só o número nacional (11985893420) depois do "+55" que o site já pôs; o número nacional num campo limpo;
// com o +55 na frente.
async function preencherTelefone(el, valor) {
  const digitos = (t) => String(t || '').replace(/\D/g, '');
  let nacional = digitos(valor);
  if (nacional.length >= 12 && nacional.startsWith('55')) nacional = nacional.slice(2);
  const confere = async () => digitos(await el.inputValue().catch(() => '')).endsWith(nacional);
  const limpar = async () => { await el.click({ timeout: 4000 }).catch(() => {}); await el.press('Control+A').catch(() => {}); await el.press('Backspace').catch(() => {}); await el.fill('').catch(() => {}); };
  const teclar = async (t) => { await el.pressSequentially(t, { delay: 70 }).catch(() => {}); await pausa(300, 600); };

  const atual = String(await el.inputValue().catch(() => '')).trim();
  if (/^\+?\d{1,3}\s*$/.test(atual)) {
    // "+55 " já escrito pelo site: só completa
    await el.click({ timeout: 4000 }).catch(() => {});
    await el.press('End').catch(() => {});
    await teclar(nacional);
    if (await confere()) return;
  }
  for (const tentativa of [nacional, `+55${nacional}`]) {
    await limpar();
    await teclar(tentativa);
    if (await confere()) return;
  }
  await el.fill(nacional).catch(() => {}); // último recurso
}

async function preencher(pagina, campo, valor) {
  const el = pagina.locator(`[data-rota="${campo.id}"]`);
  if (campo.tipo !== 'arquivo') await el.scrollIntoViewIfNeeded().catch(() => {});
  switch (campo.tipo) {
    case 'texto':
    case 'textarea':
      if (campo.autocompletar) {
        // digita só o começo ("São Paulo", sem ", SP") e escolhe a sugestão
        await digitar(el, String(valor).split(',')[0].trim());
        // sem clicar numa sugestão, muitos sites apagam o que foi digitado
        await escolherSugestao(pagina, String(valor), 6000);
        break;
      }
      // telefone: máscaras e seletor de país (+55) recusam o número colado de uma vez
      if (campo.html === 'tel' || (/^[\d\s()+-]{10,}$/.test(String(valor)) && /telefone|celular|phone|mobile|whats|contato/i.test(campo.rotulo))) {
        await preencherTelefone(el, valor);
        break;
      }
      await digitar(el, campo.limite ? String(valor).slice(0, campo.limite) : valor);
      // alguns campos viram autocompletar depois de digitar
      if (campo.tipo === 'texto' && String(valor).length <= 60) await escolherSugestao(pagina, String(valor), 600, true);
      break;
    case 'select':
      await el.selectOption({ label: valor });
      break;
    case 'radio': {
      const i = campo.opcoes.indexOf(valor);
      const opcao = pagina.locator(`[data-rota="${campo.idsOpcoes[i]}"]`);
      await opcao.check({ force: true }).catch(() => opcao.click({ force: true }));
      break;
    }
    case 'caixinhas': {
      const i = campo.opcoes.indexOf(valor);
      const opcao = pagina.locator(`[data-rota="${campo.idsOpcoes[i]}"]`);
      await opcao.check({ force: true }).catch(() => opcao.click({ force: true }));
      break;
    }
    case 'checkbox': {
      await el.check({ force: true }).catch(() => el.click({ force: true }).catch(() => {}));
      // caixinha customizada: o input escondido não muda com o check, então clica pelo próprio elemento
      if (!(await el.isChecked().catch(() => false))) await el.evaluate((e) => e.click()).catch(() => {});
      // último recurso: o canto esquerdo do label (no meio dele costuma ter um link para os termos)
      if (!(await el.isChecked().catch(() => false))) {
        const id = await el.getAttribute('id').catch(() => null);
        const label = id ? pagina.locator(`label[for="${id}"]`).first() : el.locator('xpath=ancestor::label[1]');
        if (await label.count().catch(() => 0)) await label.click({ position: { x: 3, y: 6 }, timeout: 4000 }).catch(() => {});
      }
      break;
    }
    case 'arquivo':
      await el.setInputFiles(valor);
      break;
    case 'combobox': {
      await el.click();
      await pausa(400, 900);
      const opcoes = pagina.locator('[role=option]:visible');
      const textos = await textosOpcoes(opcoes);
      let i = textos.findIndex((t) => norm(t) === norm(valor));
      if (i < 0) i = textos.findIndex((t) => norm(t).includes(norm(valor)));
      // lista com busca: digita para filtrar e procura de novo
      if (i < 0) {
        await pagina.keyboard.type(String(valor).slice(0, 30), { delay: 40 }).catch(() => {});
        await pausa(700, 1000);
        const filtrados = await textosOpcoes(opcoes);
        i = filtrados.findIndex((t) => norm(t) === norm(valor));
        if (i < 0) i = filtrados.findIndex((t) => norm(t).includes(norm(valor)));
      }
      if (i < 0) throw new Error(`opção "${valor}" não apareceu na lista`);
      await opcoes.nth(i).click();
      break;
    }
    default:
      throw new Error(`Tipo de campo desconhecido: ${campo.tipo}`);
  }
  await pausa(400, 1200);
}

// "Adicionar experiência" / "Adicionar educação": um item por experiência/formação do Perfil
async function preencherSecoes(pagina, ctx, vaga, iaFn) {
  const feitos = [];
  const achados = await pagina.evaluate(secoes.acharBotoesSecao).catch(() => []);
  for (const { tipo } of achados) {
    const itens = (ctx.listas?.[tipo] || []).slice(0, 5);
    for (const [n, item] of itens.entries()) {
      await pagina.evaluate(secoes.marcarCamposVelhos).catch(() => {});
      const botao = pagina.locator(`[data-rota-secao="${tipo}"]`).first();
      if (!(await botao.count())) break;
      await botao.scrollIntoViewIfNeeded().catch(() => {});
      await botao.click({ timeout: 5000 }).catch(() => {});
      await pausa(1200, 1800);
      const campos = await pagina.evaluate(lerCampos).catch(() => []);
      const novos = new Set(await pagina.evaluate(secoes.idsNovos, campos.map((c) => c.id)).catch(() => []));
      const doItem = campos.filter((c) => novos.has(c.id) && c.rotulo && !c.preenchido);
      if (!doItem.length) break; // o botão não abriu nada
      for (const campo of doItem) {
        if (campo.tipo === 'texto' && (campo.lista || campo.autocompletar)) {
          const opcoes = await lerOpcoesLista(pagina, campo);
          if (opcoes.length) Object.assign(campo, { tipo: 'combobox', opcoes });
        }
        let d = secoes.valorDoItem(campo, item, tipo, ctx.perfil);
        if (d?.ia) {
          const r = await (iaFn || ia.responder)({ pergunta: campo.rotulo, opcoes: campo.opcoes, contexto: { perfil: ctx.perfil, listas: ctx.listas }, vaga, dica: `Formação: ${JSON.stringify(item)}` }).catch(() => null);
          d = r && escolherOpcao(campo.opcoes, r) ? { valor: escolherOpcao(campo.opcoes, r) } : null;
        }
        if (!d) continue;
        if (campo.tipo === 'checkbox' && d.valor === false) continue;
        await preencher(pagina, campo, d.valor).catch(() => {});
      }
      const salvar = await pagina.evaluate(secoes.acharSalvarItem).catch(() => null);
      if (salvar) {
        await pagina.locator('[data-rota-salvar]').first().click({ timeout: 5000 }).catch(() => {});
        await pausa(1000, 1500);
      }
      const nome = tipo === 'experiencias' ? `${item.cargo || ''} — ${item.empresa || ''}` : `${item.curso || ''} — ${item.instituicao || ''}`;
      feitos.push({ pergunta: `${tipo === 'experiencias' ? 'Experiência' : 'Formação'} ${n + 1}`, resposta: nome, fonte: 'perfil' });
    }
  }
  return feitos;
}

// login
// O cookie de login da Gupy some ao fechar o navegador; o do LinkedIn/Google dura meses,
// então ao cair no login clicamos no provedor. GUPY_LOGIN: linkedin (padrão) | google | nenhum

async function naTelaDeLogin(pagina) {
  const url = new URL(pagina.url());
  if (url.hostname.startsWith('login.') || /signin|sign-in|\/login|\/auth/i.test(url.pathname)) return true;
  if ((await pagina.locator('input[type=password]:visible').count()) > 0) return true;
  // algumas empresas usam outro endereço e só mostram a senha após o e-mail; os botões denunciam
  return pagina.evaluate(() => {
    const textos = [...document.querySelectorAll('button, a, [role=button], h1, h2, h3')]
      .filter((e) => e.getBoundingClientRect().width > 0)
      .map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase());
    const tem = (re) => textos.some((t) => re.test(t));
    const sinais = [/^acessar conta$/, /^entrar sem senha$/, /^entrar com sua conta$/, /^esqueceu a senha\??$/]
      .filter(tem).length;
    return sinais >= 2 || (sinais >= 1 && tem(/^linkedin$/) && tem(/^google$/));
  }).catch(() => false);
}

// do mais preciso ao mais genérico; às vezes o botão é um <div> com ícone
async function acharBotaoProvedor(pagina, provedor) {
  const exato = new RegExp(`^\\s*${provedor}\\s*$`, 'i');
  const contem = new RegExp(provedor, 'i');
  const tentativas = [
    pagina.getByRole('button', { name: exato }),
    pagina.getByRole('link', { name: exato }),
    pagina.getByRole('button', { name: contem }),
    pagina.locator(`[aria-label*="${provedor}" i], [data-testid*="${provedor}" i], [id*="${provedor}" i], [class*="${provedor}" i]`)
      .filter({ hasNot: pagina.locator('a[href*="linkedin.com/company"]') }),
    pagina.getByText(exato), // o clique propaga até o handler
  ];
  for (const t of tentativas) {
    const alvo = t.filter({ visible: true }).first();
    if (await alvo.count().catch(() => 0)) return alvo;
  }
  return null;
}

// usado para diagnóstico quando nada é encontrado
function listarClicaveis() {
  // inclui shadow DOM (SmartRecruiters)
  const todos = (sel, raiz = document) => { const out = [...raiz.querySelectorAll(sel)]; for (const e of raiz.querySelectorAll('*')) if (e.shadowRoot) out.push(...todos(sel, e.shadowRoot)); return out; };
  const textoDoBotao = (e) => {
    let t = (e.innerText || e.value || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    // botão de componente: o texto fica no <slot> ou no elemento de fora
    if (!t && e.querySelectorAll) t = [...e.querySelectorAll('slot')].flatMap((s) => s.assignedNodes({ flatten: true })).map((n) => n.textContent || '').join(' ').replace(/\s+/g, ' ').trim();
    const host = !t && e.getRootNode && e.getRootNode().host;
    if (host) t = (host.innerText || host.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    return t;
  };
  return [...todos('button, a, [role=button], [onclick], [tabindex]')]
    .filter((e) => e.getBoundingClientRect().width > 0)
    .slice(0, 60)
    .map((e) => ({
      tag: e.tagName.toLowerCase(), texto: textoDoBotao(e).slice(0, 40), role: e.getAttribute('role'),
      aria: e.getAttribute('aria-label'), testid: e.getAttribute('data-testid'), id: e.id || null,
      classe: String(e.className || '').slice(0, 80), href: e.getAttribute('href'),
    }));
}

const ehProvedor = (u) => /(^|\.)(linkedin\.com|google\.com)$/.test(u.hostname) || /^\/(oauth|uas|checkpoint)\//.test(u.pathname) && /linkedin/.test(u.href);
// botões de um clique no LinkedIn/Google
const CONFIRMAR_PROVEDOR = '^(continuar como .{1,40}|continue as .{1,40}|permitir|allow|autorizar|authorize|aceitar|accept|sim,? sou eu|continuar|continue)$';

async function fazerLogin(pagina) {
  // às vezes a tela de login só redireciona sozinha
  for (let i = 0; i < 5; i++) {
    await pausa(1000, 1200);
    if (!(await naTelaDeLogin(pagina))) return { ok: true };
  }
  const provedor = (process.env.GUPY_LOGIN || 'linkedin').toLowerCase();
  if (provedor === 'nenhum') return { ok: false, motivo: 'A Gupy pediu login (GUPY_LOGIN=nenhum no .env).' };

  const botao = await acharBotaoProvedor(pagina, provedor);
  if (!botao) return { ok: false, motivo: `O site pediu login e não achei o botão "${provedor}".` };

  await pausa(800, 2000);
  await botao.scrollIntoViewIfNeeded().catch(() => {});
  await botao.click();

  // Gupy -> provedor -> Gupy; no provedor pode aparecer "Continuar como..." ou "Permitir"
  const voltouParaGupy = (u) => !ehProvedor(u) && !u.hostname.startsWith('login.') && !/signin|sign-in|\/login|callback/i.test(u.pathname);
  const limite = Date.now() + 45000;
  let cliquesNoProvedor = 0;
  let senhaUsada = false;
  while (Date.now() < limite) {
    await pausa(1500, 2000);
    const url = new URL(pagina.url());
    if (voltouParaGupy(url)) { await esperarPagina(pagina); return { ok: true }; }
    if (!ehProvedor(url)) continue; // ainda na Gupy, carregando
    if (await pagina.locator('input[type=password]:visible').count()) {
      // sessão do LinkedIn/Google expirou: usa a senha salva no cofre (npm run login:salvar, site linkedin.com)
      const cred = logins.obter(pagina.url()) || logins.obter(`${provedor}.com`);
      if (cred && !senhaUsada) {
        senhaUsada = true;
        const r = await entrarComSenha(pagina, cred);
        if (!r.ok && !/tela de login n[aã]o saiu/.test(r.motivo)) return { ok: false, motivo: `O ${provedor} pediu a senha e não deu certo: ${r.motivo}` };
        continue;
      }
      return { ok: false, motivo: `O ${provedor} pediu a SENHA (a sessão dele expirou). Salve a senha dele com "npm run login:salvar" (site: ${provedor}.com) ou rode "npm run gupy:login" e entre marcando "Manter conectado".` };
    }
    if (cliquesNoProvedor < 2) {
      const confirmar = await pagina.evaluate(acharBotao, CONFIRMAR_PROVEDOR).catch(() => null);
      if (confirmar) {
        await pausa(600, 1400);
        await pagina.locator('[data-rota-botao]').first().click().catch(() => {});
        cliquesNoProvedor++;
      }
    }
  }
  return { ok: false, motivo: `Fui para o ${provedor} e não voltei para o site em 45s. Veja o último print para saber o que ele pediu.` };
}

// habilidades destacadas
// tela de chips com as habilidades do currículo da Gupy; marca cada chip com data-rota-chip
function lerChipsHabilidades() {
  document.querySelectorAll('[data-rota-chip]').forEach((e) => e.removeAttribute('data-rota-chip'));
  const TITULO = /habilidades (mais valiosas|destacadas|em destaque)|destaque (suas|at[eé] \d) habilidades|escolha at[eé] \d+ habilidades/i;
  const CONTADOR = /(\d+)\s*\/\s*(\d+)\s*habilidades/i;
  const visivel = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const titulo = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, div, label, legend')]
    .find((e) => visivel(e) && e.children.length <= 3 && TITULO.test((e.innerText || '').trim()) && (e.innerText || '').length < 200);
  if (!titulo) return null;
  // sobe até o bloco com o contador "N / 3 habilidades"
  let secao = titulo;
  for (let i = 0; i < 7 && secao.parentElement; i++) {
    secao = secao.parentElement;
    if (CONTADOR.test(secao.innerText || '')) break;
  }
  const m = (secao.innerText || '').match(CONTADOR);
  const contador = m ? { n: Number(m[1]), max: Number(m[2]) } : null;
  const ehRemover = (e) => /remov|delet|exclu|fechar|close|desmarcar/i.test(e.getAttribute('aria-label') || e.getAttribute('title') || '') || /^[x×✕]$/i.test((e.innerText || '').trim());
  const clicaveis = [...secao.querySelectorAll('button, [role=button], [role=option], [role=checkbox], [class*=chip i], [class*=tag i], [class*=badge i]')]
    .filter((e) => visivel(e) && !ehRemover(e));
  const chips = [];
  const vistos = new Set();
  for (const e of clicaveis) {
    // chip aninhado: fica só o de fora
    if (clicaveis.some((o) => o !== e && o.contains(e))) continue;
    const texto = (e.innerText || '').replace(/[×✕]/g, '').replace(/\s+/g, ' ').trim();
    if (!texto || texto.length > 60 || TITULO.test(texto) || /continuar|finalizar|enviar|salvar/i.test(texto)) continue;
    const selecionado = e.getAttribute('aria-pressed') === 'true' || e.getAttribute('aria-selected') === 'true' || e.getAttribute('aria-checked') === 'true'
      || [...e.querySelectorAll('button, [role=button], svg, [aria-label]')].some(ehRemover)
      || /[×✕]/.test(e.innerText || '');
    const chave = texto.toLowerCase() + (selecionado ? '#sel' : '');
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    e.setAttribute('data-rota-chip', String(chips.length));
    chips.push({ texto, selecionado });
  }
  return chips.length ? { chips, contador } : null;
}

async function destacarHabilidades(pagina, ctx, vaga) {
  let leitura = await pagina.evaluate(lerChipsHabilidades).catch(() => null);
  if (!leitura) return null;
  const max = leitura.contador?.max || 3;
  const jaEscolhidas = leitura.chips.filter((c) => c.selecionado).map((c) => c.texto);
  const disponiveis = [...new Set(leitura.chips.filter((c) => !c.selecionado).map((c) => c.texto))];
  const faltam = max - (leitura.contador?.n ?? jaEscolhidas.length);
  if (faltam <= 0 || !disponiveis.length) return jaEscolhidas.length ? { escolhidas: jaEscolhidas, fonte: 'já marcadas' } : null;

  // primeiro as definidas em Respostas, depois a IA completa
  const preferidas = String(ctx.respostasFixas?.find((r) => r.chave === 'habilidades_destaque')?.resposta || '')
    .split(/[;,\n]/).map((t) => t.trim()).filter(Boolean);
  const ordem = [];
  for (const p of preferidas) {
    const achou = escolherOpcao(disponiveis, p);
    if (achou && norm(achou).includes(norm(p).split(' ')[0]) && !ordem.includes(achou)) ordem.push(achou);
  }
  let fonte = ordem.length ? 'fixa' : 'ia';
  if (ordem.length < faltam) {
    const resto = disponiveis.filter((d) => !ordem.includes(d));
    const daIA = await ia.escolherHabilidades({ opcoes: resto, quantas: faltam - ordem.length, vaga }).catch(() => []);
    if (daIA.length) fonte = ordem.length ? 'fixa+ia' : 'ia';
    ordem.push(...(daIA.length ? daIA : resto.slice(0, faltam - ordem.length)));
  }

  const escolhidas = [];
  for (const texto of ordem.slice(0, faltam)) {
    leitura = await pagina.evaluate(lerChipsHabilidades).catch(() => null);
    const i = leitura?.chips.findIndex((c) => !c.selecionado && c.texto === texto);
    if (i == null || i < 0) continue;
    const antes = leitura.contador?.n;
    await pausa(500, 1300);
    const chip = pagina.locator(`[data-rota-chip="${i}"]`).first();
    await chip.scrollIntoViewIfNeeded().catch(() => {});
    await chip.click({ timeout: 5000 }).catch(() => chip.evaluate((el) => el.click()));
    await pausa(400, 900);
    const depois = (await pagina.evaluate(lerChipsHabilidades).catch(() => null))?.contador?.n;
    if (antes != null && depois != null && depois <= antes) continue; // o clique não marcou
    escolhidas.push(texto);
  }
  if (escolhidas.length) await ctx.log?.('info', 'gupy', `Habilidades destacadas: ${escolhidas.join(', ')}.`);
  return { escolhidas: [...jaEscolhidas, ...escolhidas], fonte };
}

// janela final
// a Gupy abre "Personalizar"/"Finalizar candidatura" por cima do formulário, que continua visível atrás
function lerJanelaFinal({ final, marcar }) {
  const reFinal = new RegExp(final, 'i');
  const dialogos = [...document.querySelectorAll('[role=dialog], [role=alertdialog], [aria-modal=true], [class*=modal i], [class*=dialog i]')]
    .filter((d) => { const r = d.getBoundingClientRect(); return r.width > 50 && r.height > 30 && getComputedStyle(d).visibility !== 'hidden'; });
  for (const d of dialogos) {
    const botoes = [...d.querySelectorAll('button, [role=button], a')]
      .filter((b) => b.getBoundingClientRect().width > 0 && !b.disabled)
      .map((b) => ({ b, t: (b.innerText || b.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim() }));
    const personalizar = botoes.find((x) => /^personalizar( (a |minha )?candidatura)?$/i.test(x.t));
    const fim = botoes.find((x) => reFinal.test(x.t));
    if (!personalizar && !fim) continue;
    const alvo = marcar === 'personalizar' ? personalizar : marcar === 'final' ? fim : null;
    if (alvo) alvo.b.setAttribute('data-rota-botao', '1');
    return { personalizar: personalizar?.t || null, final: fim?.t || null };
  }
  return null;
}

// confirmação de etapa
// "Deseja enviar? As respostas não poderão ser editadas" confirma só a etapa, não a candidatura
function acharConfirmacao() {
  const CONFIRMA = /^(confirmar( e continuar| envio| respostas)?|sim(,.*)?|enviar( respostas| minhas respostas)?|continuar|prosseguir|ok|salvar( respostas)?|estou de acordo|concordo|entendi)$/i;
  const NAO = /cancel|voltar|n[aã]o|revisar|editar|fechar/i;
  const dialogos = [...document.querySelectorAll('[role=dialog], [role=alertdialog], [aria-modal=true], [class*=modal i], [class*=dialog i]')]
    .filter((d) => { const r = d.getBoundingClientRect(); return r.width > 50 && r.height > 30 && getComputedStyle(d).visibility !== 'hidden'; });
  for (const d of dialogos) {
    const botao = [...d.querySelectorAll('button, [role=button], a')].find((b) => {
      const t = (b.innerText || b.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
      return b.getBoundingClientRect().width > 0 && !b.disabled && CONFIRMA.test(t) && !NAO.test(t);
    });
    if (botao) {
      botao.setAttribute('data-rota-botao', '1');
      return { botao: (botao.innerText || '').trim(), texto: (d.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200) };
    }
  }
  return null;
}

async function confirmarDialogo(pagina, contexto, ctx) {
  await pausa(700, 1200);
  const achou = await pagina.evaluate(acharConfirmacao).catch(() => null);
  if (!achou) return pagina;
  // se fala em finalizar a candidatura, deixa para a lógica do botão final
  if (/finaliz|concluir (a |sua )?candidatura|enviar (a |sua )?candidatura/i.test(achou.texto)) {
    await pagina.evaluate(() => (function limpa(r) { r.querySelectorAll('[data-rota-botao]').forEach((b) => b.removeAttribute('data-rota-botao')); r.querySelectorAll('*').forEach((e) => e.shadowRoot && limpa(e.shadowRoot)); })(document)).catch(() => {});
    return pagina;
  }
  await ctx.log?.('info', 'gupy', `Janela de confirmação ("${achou.texto.slice(0, 80)}"): cliquei em "${achou.botao}".`);
  return clicarBotao(pagina, contexto);
}

// modo agente
// para campos que o leitor não entende: mapeia a tela, marca com data-rota-ag e a IA decide
function mapearTela() {
  const todos = (sel, raiz = document) => { const out = [...raiz.querySelectorAll(sel)]; for (const e of raiz.querySelectorAll('*')) if (e.shadowRoot) out.push(...todos(sel, e.shadowRoot)); return out; };
  const visivel = (e) => { const r = e.getBoundingClientRect(); const st = getComputedStyle(e); return r.width > 1 && r.height > 1 && st.visibility !== 'hidden' && st.display !== 'none'; };
  const limpar = (t) => String(t || '').replace(/[​ ]/g, ' ').replace(/\s+/g, ' ').trim();
  todos('[data-rota-ag]').forEach((e) => e.removeAttribute('data-rota-ag'));
  const rotuloDe = (el) => {
    const raiz = el.getRootNode && el.getRootNode().querySelector ? el.getRootNode() : document;
    if (el.id) { const l = raiz.querySelector(`label[for="${CSS.escape(el.id)}"]`) || document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l && limpar(l.innerText)) return limpar(l.innerText).slice(0, 200); }
    if (el.getAttribute('aria-label')) return limpar(el.getAttribute('aria-label')).slice(0, 200);
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const t = lb.split(/\s+/).map((id) => (raiz.getElementById ? raiz.getElementById(id) : null) || document.getElementById(id)).filter(Boolean).map((e) => limpar(e.innerText)).join(' '); if (t) return t.slice(0, 200); }
    const lab = el.closest('label'); if (lab && limpar(lab.innerText)) return limpar(lab.innerText).slice(0, 200);
    const host = raiz.host; if (host && (host.getAttribute('label') || host.getAttribute('aria-label'))) return limpar(host.getAttribute('label') || host.getAttribute('aria-label'));
    let p = el.parentElement;
    for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
      const linha = String(p.innerText || '').split('\n').map(limpar).find((l) => l && l !== limpar(el.innerText) && l.length < 200);
      if (linha) return linha;
    }
    return limpar(el.getAttribute('placeholder') || el.name || '');
  };
  const SEL = 'input:not([type=hidden]), select, textarea, [contenteditable=true], [role=combobox], [role=listbox], [role=option], [role=checkbox], [role=radio], [role=switch], [aria-haspopup], button, [role=button], [class*=select__control], [class*=dropdown-toggle], li[class*=option i], [class*=option i][tabindex]';
  const lista = [];
  for (const el of todos(SEL)) {
    if (!visivel(el) || el.closest('header, footer, nav') || lista.length >= 120) continue;
    const tag = el.tagName.toLowerCase();
    const tipo = tag === 'input' ? `input:${el.type || 'text'}` : tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : (el.getAttribute('role') || tag);
    const item = { n: lista.length, tipo, rotulo: rotuloDe(el) };
    if (tag === 'select') { item.opcoes = [...el.options].map((o) => limpar(o.textContent)).filter(Boolean).slice(0, 40); item.valor = el.selectedIndex > 0 ? limpar(el.options[el.selectedIndex].textContent) : ''; }
    else if (/input:(checkbox|radio)/.test(tipo)) item.valor = el.checked ? 'marcado' : 'vazio';
    else if (tag === 'input' || tag === 'textarea') item.valor = el.type === 'password' ? '(senha)' : limpar(el.value).slice(0, 80);
    else { item.texto = limpar(el.innerText || el.getAttribute('aria-label')).slice(0, 80); const ch = el.getAttribute('aria-checked') || el.getAttribute('aria-selected'); if (ch) item.valor = ch === 'true' ? 'marcado' : 'vazio'; }
    if (el.required || el.getAttribute('aria-required') === 'true' || /\*\s*$/.test(item.rotulo)) item.obrigatorio = true;
    if (tag === 'input' && el.type === 'file') item.valor = el.files?.length ? 'arquivo enviado' : 'vazio';
    if (!item.rotulo && !item.texto) continue;
    el.setAttribute('data-rota-ag', String(item.n));
    lista.push(item);
  }
  return lista;
}

const NAO_CLICAR_AGENTE = /enviar|submit|finaliz|conclu|candidatar|candidate-se|apply|aplicar|pr[oó]xim|continu|avan[cç]|next|voltar|back|cancel|sair|login|entrar|sign/i;

// até 4 rodadas (lista customizada precisa de 2: abrir e escolher)
// perguntas = o que só o usuário sabe; vai para a caixa Perguntas
async function agenteIA(pagina, ctx, vaga, { respostas, textosTreino = [] }) {
  if (!ia.disponivel()) return { agiu: false, perguntas: [] };
  const contexto = { perfil: ctx.perfil, listas: ctx.listas, respostasFixas: ctx.respostasFixas, textosTreino, respondidas: [...(ctx.respondidas || []), ...Object.values(aprendizado.carregar().respostas || {}).map((a) => ({ pergunta: a.pergunta, resposta: String(a.valor) }))] };
  const jaTentado = [];
  const perguntas = [];
  let agiu = false;
  for (let rodada = 0; rodada < 4; rodada++) {
    const tela = await pagina.evaluate(mapearTela).catch(() => []);
    const acoes = await ia.planejarTela({ tela, titulos: await textoTitulos(pagina), contexto, vaga, jaTentado }).catch(() => []);
    for (const a of acoes.filter((x) => x.acao === 'perguntar')) {
      const item = tela.find((t) => t.n === Number(a.n));
      const pergunta = String(a.pergunta || item?.rotulo || '').slice(0, 1000);
      if (pergunta && !perguntas.some((p) => p.pergunta === pergunta)) perguntas.push({ pergunta, tipo: item?.tipo || 'texto', opcoes: item?.opcoes || [] });
    }
    const executar = acoes.filter((x) => x.acao !== 'perguntar');
    if (!executar.length) break;
    let fezAlgo = false;
    for (const a of executar) {
      const item = tela.find((t) => t.n === Number(a.n));
      const rotulo = item?.rotulo || '';
      const textoAlvo = `${item?.texto || ''} ${rotulo}`;
      jaTentado.push({ acao: a.acao, rotulo: rotulo.slice(0, 60), valor: a.valor });
      if (a.acao === 'clicar' && (NAO_CLICAR_AGENTE.test(item?.texto || '') || ia.BOTAO_PROIBIDO.test(textoAlvo))) continue;
      if (a.acao === 'preencher' && (detectarPessoal(rotulo) || /input:(file|password)/.test(item?.tipo || ''))) continue;
      const el = pagina.locator(`[data-rota-ag="${a.n}"]`).first();
      try {
        await el.scrollIntoViewIfNeeded().catch(() => {});
        if (a.acao === 'preencher') {
          await digitar(el, String(a.valor ?? ''));
        } else if (a.acao === 'escolher') {
          if (item?.tipo === 'select') {
            await el.selectOption({ label: String(a.valor) }).catch(() => el.selectOption(String(a.valor)));
          } else {
            // lista customizada: abre e clica na opção pelo texto
            const aberta = await pagina.locator('[role=option], [class*=option i], li').filter({ hasText: String(a.valor) }).filter({ visible: true }).count().catch(() => 0);
            if (!aberta) { await el.click({ timeout: 5000 }); await pausa(500, 900); }
            await pagina.locator('[role=option], [class*=option i], li').filter({ hasText: String(a.valor) }).filter({ visible: true }).first().click({ timeout: 5000 });
          }
        } else if (a.acao === 'marcar') {
          await el.check({ force: true, timeout: 4000 }).catch(() => el.click({ force: true }));
        } else if (a.acao === 'clicar') {
          await el.click({ timeout: 5000 });
        }
        fezAlgo = true;
        agiu = true;
        if (a.acao !== 'clicar') respostas.push({ pergunta: rotulo || `campo ${a.n}`, resposta: a.acao === 'marcar' ? 'marcado' : String(a.valor), fonte: 'ia-agente' });
      } catch { /* a próxima rodada reavalia */ }
      await pausa(400, 1000);
    }
    if (!fezAlgo) break;
  }
  if (agiu) await ctx.log?.('info', 'gupy', `Modo agente: a IA completou campos que o leitor normal não entendia (${respostas.filter((r) => r.fonte === 'ia-agente').length}).`);
  return { agiu, perguntas };
}

// marca os botões visíveis com data-rota-ia
function listarBotoesIA() {
  // inclui shadow DOM (SmartRecruiters)
  const todos = (sel, raiz = document) => { const out = [...raiz.querySelectorAll(sel)]; for (const e of raiz.querySelectorAll('*')) if (e.shadowRoot) out.push(...todos(sel, e.shadowRoot)); return out; };
  const textoDoBotao = (e) => {
    let t = (e.innerText || e.value || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    // botão de componente: o texto fica no <slot> ou no elemento de fora
    if (!t && e.querySelectorAll) t = [...e.querySelectorAll('slot')].flatMap((s) => s.assignedNodes({ flatten: true })).map((n) => n.textContent || '').join(' ').replace(/\s+/g, ' ').trim();
    const host = !t && e.getRootNode && e.getRootNode().host;
    if (host) t = (host.innerText || host.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    return t;
  };
  todos('[data-rota-ia]').forEach((e) => e.removeAttribute('data-rota-ia'));
  const vistos = new Set();
  const lista = [];
  for (const e of todos('button, a, [role=button], input[type=submit], input[type=button]')) {
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || e.disabled || e.getAttribute('aria-disabled') === 'true') continue;
    const st = getComputedStyle(e);
    if (st.visibility === 'hidden' || st.display === 'none') continue;
    const texto = textoDoBotao(e).slice(0, 60);
    if (!texto || vistos.has(texto.toLowerCase())) continue;
    vistos.add(texto.toLowerCase());
    e.setAttribute('data-rota-ia', String(lista.length));
    lista.push(texto);
    if (lista.length >= 40) break;
  }
  return lista;
}

// se a IA achar, o botão fica marcado para clicarBotao()
async function ajudaDaIA(pagina, situacao, vaga, ctx) {
  if (!ia.disponivel()) return null;
  const botoes = await pagina.evaluate(listarBotoesIA).catch(() => []);
  const titulos = await textoTitulos(pagina);
  const escolha = await ia.escolherBotao({ situacao, titulos, botoes, vaga }).catch(async (e) => {
    await ctx.log?.('aviso', 'gupy', `IA não conseguiu olhar os botões: ${e.message}`);
    return null;
  });
  if (!escolha) return null;
  await pagina.evaluate((i) => {
    (function limpa(r) { r.querySelectorAll('[data-rota-botao]').forEach((b) => b.removeAttribute('data-rota-botao')); r.querySelectorAll('*').forEach((e) => e.shadowRoot && limpa(e.shadowRoot)); })(document);
    (function acha(r) { const e = r.querySelector(`[data-rota-ia="${i}"]`); if (e) return e; for (const x of r.querySelectorAll('*')) if (x.shadowRoot) { const y = acha(x.shadowRoot); if (y) return y; } return null; })(document)?.setAttribute('data-rota-botao', '1');
  }, escolha.indice);
  await ctx.log?.('info', 'gupy', `A IA escolheu o botão "${escolha.texto}" (${escolha.acao}).`);
  return escolha;
}

// plataforma: 'gupy' ou 'sites'
// aoTravar: se a candidatura não terminar, recebe a janela aberta (você termina e o robô observa)
// conferirFn: confere se a vaga é de TI antes de preencher (padrão: regras + IA; nos testes com iaFn, desligado)
// agenteFn: agente de IA que tenta terminar quando as regras travam (padrão: ligado se houver GEMINI_API_KEY; nos testes com iaFn, desligado)
async function candidatar(vaga, ctx, { abrir = abrirNavegador, iaFn, planoFn, plataforma = 'gupy', aoTravar, conferirFn, agenteFn } = {}) {
  const ehGupy = plataforma === 'gupy';
  definirVelocidade(ctx.config?.velocidade);
  const memoria = aprendizado.carregar();
  const botoes = {
    candidatar: aprendizado.regexCom(BASE_CANDIDATAR, memoria.botoesCandidatar),
    proximo: aprendizado.regexCom(BASE_PROXIMO, memoria.botoesAvancar),
    final: aprendizado.regexCom(BASE_FINAL, memoria.botoesFinal),
    fechar: aprendizado.regexCom(BASE_FECHAR, memoria.botoesFechar),
  };
  const pasta = path.join(PASTA_LOGS, '..', plataforma, `${dataLocal()}-vaga-${vaga.id}`);
  fs.mkdirSync(pasta, { recursive: true });
  const respostas = [];
  let ultimo = null;
  const secoesFeitas = new Set();
  let abriuPeloFinal = false;
  let ajudasIA = 0;
  let passo = 0;
  let pagina;

  let tarjas = []; // dados pessoais, tarjados nos prints
  const registrar = async (nome, extra) => {
    passo++;
    const base = path.join(pasta, `${String(passo).padStart(2, '0')}-${nome}`);
    const mask = tarjas.map((id) => pagina.locator(`[data-rota="${id}"]`));
    await pagina?.screenshot({ path: `${base}.png`, fullPage: true, mask, maskColor: '#22262b' }).catch(() => {});
    if (extra) fs.writeFileSync(`${base}.json`, JSON.stringify(extra, null, 2));
  };
  // "return fim(...)" sem await: o finally roda antes do print terminar, então "ultimo" é marcado já no começo
  // o objeto devolvido é o próprio "ultimo": se o agente de IA terminar a candidatura no finally, o resultado muda junto
  const fim = async (resultado, motivo, nome = resultado) => {
    const obj = { resultado, motivo, respostas, pasta, resolvidoPor: 'regras' };
    ultimo = obj;
    await registrar(nome, { resultado, motivo, url: pagina?.url(), respostas });
    return obj;
  };
  // site que pede conta ou tem CAPTCHA: vai para a aba "Para você"
  const comVoce = async (motivo) => { const p = fim('pulada', motivo); ultimo.paraVoce = true; return p; };
  const hostVaga = (() => { try { return new URL(vaga.url_candidatura || vaga.url).hostname; } catch { return 'site'; } })();

  const nav = await abrir();
  const { contexto } = nav;
  pagina = nav.pagina;
  // devolve null se chegou ao formulário, senão o resultado final
  const abrirVaga = async (lerAntes) => {
    // Sites de empresas guardam o que foi lido do currículo numa tentativa anterior (com erros).
    // Começa limpo: esses formulários não usam login.
    if (!ehGupy) {
      try {
        const origem = new URL(vaga.url_candidatura || vaga.url).origin;
        // site com login salvo (InfoJobs...) não é limpo: perderia o login
        if (!/linkedin\.com|gupy\.io/.test(origem) && plataforma === 'sites' && !logins.obter(origem)) {
          const cdp = await contexto.newCDPSession(pagina);
          await cdp.send('Storage.clearDataForOrigin', { origin: origem, storageTypes: 'all' });
          await cdp.detach();
          // domínio principal (empresa.com, empresa.com.br) para levar junto os cookies do site
          const partes = new URL(origem).hostname.split('.');
          const n = partes.length > 2 && partes.at(-1).length === 2 && partes.at(-2).length <= 3 ? 3 : 2;
          const dominio = partes.slice(-n).join('\\.');
          await contexto.clearCookies({ domain: new RegExp(`(^|\\.)${dominio}$`) });
        }
      } catch { /* sem limpeza, segue igual */ }
    }
    await pagina.goto(vaga.url_candidatura || vaga.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await esperarPagina(pagina);
    await aceitarCookies(pagina);
    const desafio = await pagina.evaluate(temDesafio);
    if (desafio) return ehGupy ? fim('captcha', `Verificação anti-robô na página da vaga (${desafio})`) : comVoce(`O site ${hostVaga} tem verificação anti-robô: essa candidatura é com você`);
    if (JA_CANDIDATADO.test(await pagina.innerText('body'))) return fim('pulada', 'Você já se candidatou a esta vaga');
    // a Gupy troca o botão "Candidatar-se" por "Candidatura enviada"/"Acompanhar candidatura"
    const jaFoi = await pagina.evaluate(() => [...document.querySelectorAll('button, a, [role=button], span, div')]
      .some((e) => e.children.length <= 2 && e.getBoundingClientRect().width > 0
        && /^(candidatura enviada|acompanhar( minha| sua)? candidatura|ver( minha| sua)? candidatura|j[aá] candidatad[oa]|voc[eê] se candidatou|applied|application sent)$/i.test((e.innerText || '').replace(/\s+/g, ' ').trim()))).catch(() => false);
    if (jaFoi) return fim('pulada', 'Você já se candidatou a esta vaga (a página mostra a candidatura enviada)');
    // última barreira: só se candidata a vaga de tecnologia
    const conferir = conferirFn || (iaFn ? null : conferirArea);
    if (lerAntes && conferir) {
      // descrição curta (só um trecho da busca): lê a página da vaga inteira
      const descricao = String(vaga.descricao || '').length >= 400 ? vaga.descricao : (await pagina.innerText('body').catch(() => '')).slice(0, 8000);
      const area = await conferir({ ...vaga, descricao }, { config: ctx.config }).catch(() => null);
      if (area && !area.ok) return fim('descartada', area.motivo);
      if (area) await ctx.log?.('info', 'gupy', `Área conferida: ${area.motivo}`);
    }
    if (lerAntes && ctx.config?.velocidade === 'humana') await lerPagina(pagina);

    // formulário já na página da vaga: "Candidatar-se" vira o botão final (clicar agora enviaria vazio)
    const camposNaVaga = await pagina.evaluate(lerCampos).catch(() => []);
    const formularioNaPagina = camposNaVaga.filter((c) =>
      /nome|e-?mail|cpf|curr[ií]culo|telefone|celular/i.test(c.rotulo) || ['email', 'tel'].includes(c.html) || c.tipo === 'arquivo').length >= 2;
    if (formularioNaPagina) {
      botoes.final = aprendizado.regexCom(`${BASE_FINAL}|${BASE_CANDIDATAR}`, memoria.botoesFinal);
      await ctx.log?.('info', 'gupy', 'Candidatura rápida: formulário na própria página da vaga.');
      return null;
    }

    if (!(await pagina.evaluate(acharBotao, botoes.candidatar))) {
      // site de empresa que abre direto no formulário
      if (!ehGupy && camposNaVaga.some((c) => !c.preenchido && c.rotulo)) {
        await ctx.log?.('info', 'gupy', 'O link já abre no formulário de candidatura.');
        return null;
      }
      // nenhum texto conhecido: a IA olha os botões
      const escolha = ajudasIA < MAX_AJUDAS_IA ? await ajudaDaIA(pagina, 'comecar', vaga, ctx) : null;
      if (escolha) ajudasIA++;
      if (!escolha || escolha.acao !== 'comecar') {
        return fim('erro', 'Botão "Candidatar-se" não encontrado (vaga encerrada ou página diferente do esperado)');
      }
      aprendizado.anotarBotao('botoesCandidatar', escolha.texto);
    }
    // Catho/InfoJobs logados enviam no primeiro clique: no modo teste para aqui
    if (ctx.config?.modoTeste && /(^|\.)(catho\.com\.br|infojobs\.com\.br)$/.test(new URL(pagina.url()).hostname)) {
      return fim('simulada', 'Modo teste: neste site o botão de candidatura já envia (um clique); parei antes dele');
    }
    pagina = await clicarBotao(pagina, contexto);
    return null;
  };

  let loginFeito = false;
  let loginsFeitos = 0; // logins com senha salva em sites que não são a Gupy
  let assinaturaAnterior = null; // detecta "Continuar" que não sai do lugar
  let confirmouNaTrava = false;
  let personalizou = false;
  const agenteFeito = new Set(); // uma vez por tela
  try {
    const parada = await abrirVaga(true);
    if (parada) return parada;

    for (let etapa = 1; etapa <= MAX_ETAPAS; etapa++) {
      const desafio = await pagina.evaluate(temDesafio);
      if (desafio) return ehGupy ? fim('captcha', `Verificação anti-robô durante a candidatura (${desafio})`) : comVoce(`O site ${hostVaga} pediu verificação anti-robô: essa candidatura é com você`);

      if (await naTelaDeLogin(pagina)) {
        // site de empresa/InfoJobs: entra com o login salvo (npm run login:salvar); o Rota nunca cria conta
        if (!ehGupy) {
          const comLinkedin = await pagina.evaluate(() => [...document.querySelectorAll('button, a, [role=button]')]
            .some((e) => e.getBoundingClientRect().width > 0 && /^(entrar com |continuar com |sign in with |login com )?linkedin$/i.test((e.innerText || e.getAttribute('aria-label') || '').trim()))).catch(() => false);
          if (comLinkedin && loginsFeitos < 2) {
            loginsFeitos++;
            await ctx.log?.('info', 'gupy', `Entrando em ${hostVaga} pelo LinkedIn...`);
            const r = await fazerLogin(pagina);
            if (!r.ok) return comVoce(`Não consegui entrar em ${hostVaga} pelo LinkedIn: ${r.motivo}`);
            await esperarPagina(pagina);
            const temForm = (await pagina.evaluate(lerCampos).catch(() => [])).some((c) => !c.preenchido && c.rotulo && !/senha|password/i.test(c.rotulo));
            if (!temForm && !(await pagina.evaluate(acharBotao, botoes.proximo).catch(() => null))) {
              const parada4 = await abrirVaga(false);
              if (parada4) return parada4;
            }
            etapa--;
            continue;
          }
          const cred = logins.obter(pagina.url()) || logins.obter(hostVaga);
          if (!cred) return comVoce(`O site ${hostVaga} pede login. Salve o seu login dele com "npm run login:salvar" (ou entre você mesmo nessa janela)`);
          if (loginsFeitos >= 2) return comVoce(`O site ${hostVaga} pediu login de novo depois de entrar: termine você nessa janela`);
          loginsFeitos++;
          await ctx.log?.('info', 'gupy', `Entrando em ${cred.dominio} com o login salvo...`);
          const r = await entrarComSenha(pagina, cred);
          if (!r.ok) return comVoce(`Não consegui entrar em ${cred.dominio}: ${r.motivo}`);
          await ctx.log?.('info', 'gupy', `Login em ${cred.dominio} feito.`);
          await esperarPagina(pagina);
          // alguns sites voltam para a vaga, outros para a página inicial
          const temForm = (await pagina.evaluate(lerCampos).catch(() => [])).some((c) => !c.preenchido && c.rotulo && !/senha|password/i.test(c.rotulo));
          if (!temForm && !(await pagina.evaluate(acharBotao, botoes.proximo).catch(() => null))) {
            const parada3 = await abrirVaga(false);
            if (parada3) return parada3;
          }
          etapa--;
          continue;
        }
        if (loginFeito) return fim('erro', 'A Gupy pediu login de novo logo depois de entrar. Veja os prints.');
        await registrar('tela-de-login', { url: pagina.url(), clicaveis: await pagina.evaluate(listarClicaveis).catch(() => []) });
        const login = await fazerLogin(pagina);
        if (!login.ok) return fim('erro', login.motivo);
        loginFeito = true;
        await ctx.log?.('info', 'gupy', 'Login refeito pelo botão do LinkedIn/Google.');
        // a tela de "Continuar" pós-login é que termina o login; sair dela causava loop.
        // Só volta para a vaga se não houver como seguir.
        const podeSeguir = await esperarBotao(pagina, [botoes.proximo, botoes.final], 8000)
          || (await pagina.evaluate(lerCampos).catch(() => [])).some((c) => !c.preenchido);
        if (!podeSeguir) {
          const parada2 = await abrirVaga(false);
          if (parada2) return parada2;
        }
        etapa--;
        continue;
      }

      await fecharAvisos(pagina, botoes);

      // "Personalizar candidatura" (IA escreve a apresentação) e depois "Finalizar"
      const janela = await pagina.evaluate(lerJanelaFinal, { final: botoes.final }).catch(() => null);
      if (janela?.personalizar && !personalizou) {
        personalizou = true;
        await pagina.evaluate(lerJanelaFinal, { final: botoes.final, marcar: 'personalizar' });
        await ctx.log?.('info', 'gupy', `Janela final: cliquei em "${janela.personalizar}" para escrever a apresentação.`);
        pagina = await clicarBotao(pagina, contexto);
        assinaturaAnterior = null;
        etapa--;
        continue;
      }
      if (janela?.final) {
        if (ctx.config.modoTeste) return fim('simulada', `Modo teste: tudo preenchido, parou antes de "${janela.final}"`);
        await pagina.evaluate(lerJanelaFinal, { final: botoes.final, marcar: 'final' });
        pagina = await clicarBotao(pagina, contexto);
        return SUCESSO.test(await pagina.innerText('body'))
          ? fim('enviada', null)
          : fim('erro', 'Cliquei em finalizar, mas não apareceu a confirmação. Confira na Gupy.');
      }

      const corpo = await pagina.innerText('body');
      if (JA_CANDIDATADO.test(corpo)) return fim('pulada', 'Você já se candidatou a esta vaga');
      if (CURRICULO_INCOMPLETO.test(corpo)) {
        return fim('erro', 'Seu currículo dentro da Gupy está incompleto. Preencha em https://www.gupy.io (área do candidato) uma vez e tente de novo.');
      }
      const titulos = await textoTitulos(pagina);

      tarjas = [];
      const campos = await pagina.evaluate(lerCampos);
      // etapa de teste (perfil, lógica...) é com o usuário; só para se não houver dados a preencher
      const dadosParaPreencher = campos.some((c) => !c.preenchido && /nome|mail|telefone|celular|curr[ií]culo|linkedin/i.test(c.rotulo));
      if (TESTE_ONLINE.test(titulos) && !dadosParaPreencher && !(await pagina.evaluate(acharBotao, botoes.proximo))) {
        return fim('pulada', `Parou em uma etapa de teste (${titulos.slice(0, 120)}). Testes são feitos por você.`);
      }
      // sem os valores: o log não guarda o que estava digitado
      await registrar(`etapa-${etapa}-antes`, { url: pagina.url(), titulos, campos: campos.map(({ valor, ...c }) => c) });

      const faltando = []; // preenche o resto e lista todas no fim
      const pendentes = []; // as que dá para responder pelo painel
      await avisar(pagina, 'trabalhando');
      const separaNome = campos.some((c) => /sobrenome|last ?name|surname|family name/i.test(c.rotulo || ''));
      // A IA lê a etapa inteira de uma vez e relaciona cada pergunta com os seus dados.
      // As regras (dados pessoais, diversidade, termos, respostas suas) continuam valendo antes dela.
      const paraPlano = campos.filter((c) => !c.preenchido && c.rotulo && !c.autopreencher && !['arquivo', 'checkbox'].includes(c.tipo));
      const fazerPlano = planoFn || (!iaFn && ia.disponivel() ? ia.planejarFormulario : null);
      const plano = paraPlano.length && fazerPlano
        ? await fazerPlano({ campos: paraPlano, vaga, contexto: { perfil: ctx.perfil, listas: ctx.listas, respostasFixas: ctx.respostasFixas, textosTreino: memoria.textos || [], respondidas: [...(ctx.respondidas || []), ...Object.values(aprendizado.carregar().respostas || {}).map((a) => ({ pergunta: a.pergunta, resposta: String(a.valor) }))] } }).catch(() => ({}))
        : {};
      for (const campo of campos) {
        if (campo.preenchido || campo.autopreencher) continue;
        if (!campo.rotulo) {
          // campo sem nome não pode ser ignorado se for obrigatório: o envio ficaria incompleto
          if (campo.obrigatorio) faltando.push(`"(campo sem nome, ${campo.tipo})"`);
          continue;
        }
        if (campo.tipo === 'combobox' && !campo.opcoes.length) campo.opcoes = await lerOpcoesLista(pagina, campo);
        // "Phone Number" repetido: o que não é type=tel é o código do país
        if (campo.tipo === 'texto' && campo.html !== 'tel' && /telefone|celular|phone|mobile/i.test(campo.rotulo)
          && campos.some((o) => o !== campo && o.html === 'tel' && o.rotulo === campo.rotulo)) campo.codigoPais = true;
        // busca com lista fixa (ex.: "Sim/Não", gênero): lê as opções e trata como lista de escolha
        if (campo.tipo === 'texto' && (campo.lista || campo.autocompletar) && !campo.opcoes.length) {
          const opcoes = await lerOpcoesLista(pagina, campo);
          if (opcoes.length) Object.assign(campo, { tipo: 'combobox', opcoes });
        }
        const decisao = await decidir(campo, { ...ctx, vaga, separaNome, plano, aprendidas: memoria.respostas, textosTreino: memoria.textos || [], ...(iaFn ? { iaFn } : {}) });
        if (!decisao) {
          if (campo.tipo === 'arquivo' && (CURRICULO.test(norm(campo.rotulo)) || (campo.obrigatorio && /pdf|doc/i.test(campo.aceita || '') && !/foto|photo|imagem/i.test(campo.rotulo)))) {
            return fim('erro', `A vaga pede o currículo, mas não achei o arquivo em "${ctx.perfil.curriculo_arquivo || '(vazio)'}". Confira o caminho em Perfil > Arquivo do currículo ou copie o PDF para dados\\curriculo.pdf.`);
          }
          if (campo.obrigatorio) {
            const detalhe = campo.opcoes?.length ? ` [${campo.tipo}, ${campo.opcoes.length} opções: ${campo.opcoes.slice(0, 3).join(' | ')}${campo.opcoes.length > 3 ? '…' : ''}]` : ` [${campo.tipo}]`;
            const pessoal = detectarPessoal(campo.rotulo);
            faltando.push(`"${campo.rotulo.slice(0, 120)}"${detalhe}${pessoal ? ' (cadastre em Perfil > Dados pessoais)' : ''}`);
            // dado pessoal vai para o cofre do Perfil, não para a caixa (sem criptografia)
            if (!pessoal && campo.tipo !== 'arquivo' && !/senha|password/i.test(campo.rotulo)) {
              pendentes.push({ pergunta: campo.rotulo.slice(0, 1000), tipo: campo.tipo, opcoes: campo.opcoes || [] });
            }
          }
          continue;
        }
        if (decisao.fonte === 'pessoal') tarjas.push(campo.id);
        try {
          await preencher(pagina, campo, decisao.valor);
        } catch (e) {
          // um campo travado não derruba a candidatura: segue e avisa no fim se era obrigatório
          const erro = String(e.message || e).split('\n')[0].slice(0, 80);
          if (campo.obrigatorio) faltando.push(`"${campo.rotulo.slice(0, 120)}" (não consegui preencher: ${erro})`);
          respostas.push({ pergunta: campo.rotulo, resposta: `não preencheu (${erro})`, fonte: 'erro' });
          continue;
        }
        respostas.push({
          pergunta: campo.rotulo,
          resposta: decisao.fonte === 'pessoal' ? '(dado pessoal)' : campo.tipo === 'arquivo' ? path.basename(decisao.valor) : campo.tipo === 'checkbox' ? 'marcado' : decisao.valor,
          fonte: decisao.fonte,
        });
      }
      const destaque = await destacarHabilidades(pagina, ctx, vaga);
      if (destaque?.escolhidas.length && !respostas.some((r) => r.pergunta === 'Habilidades destacadas')) {
        respostas.push({ pergunta: 'Habilidades destacadas', resposta: destaque.escolhidas.join(', '), fonte: destaque.fonte });
      }
      // Seções de experiência e formação (só em sites de empresas; a Gupy usa o currículo dela)
      if (!ehGupy && !secoesFeitas.has(pagina.url())) {
        secoesFeitas.add(pagina.url());
        respostas.push(...await preencherSecoes(pagina, ctx, vaga, iaFn));
      }

      // Confere o resultado: campo obrigatório que ficou vazio ou em vermelho
      // (o site recusou, o autocompletar apagou) ganha mais uma tentativa
      await pausa(700, 1000);
      const depois = await pagina.evaluate(lerCampos).catch(() => []);
      for (const campo of depois) {
        if (campo.preenchido || !campo.rotulo || !campo.obrigatorio || campo.autopreencher) continue;
        const nome = `"${campo.rotulo.slice(0, 120)}"`;
        if (faltando.some((f) => f.startsWith(nome))) continue;
        if (campo.tipo === 'combobox' && !campo.opcoes.length) campo.opcoes = await lerOpcoesLista(pagina, campo);
        if (campo.tipo === 'texto' && (campo.lista || campo.autocompletar) && !campo.opcoes.length) {
          const opcoes = await lerOpcoesLista(pagina, campo);
          if (opcoes.length) Object.assign(campo, { tipo: 'combobox', opcoes });
        }
        const decisao = await decidir(campo, { ...ctx, vaga, separaNome, aprendidas: memoria.respostas, textosTreino: memoria.textos || [], ...(iaFn ? { iaFn } : {}) }).catch(() => null);
        let ok = false;
        if (decisao) {
          await preencher(pagina, campo, decisao.valor).catch(() => {});
          // sai do campo: é aí que muitos sites validam e apagam o que não aceitaram
          await pagina.locator(`[data-rota="${campo.id}"]`).evaluate((e) => e.blur()).catch(() => {});
          await pausa(900, 1200);
          ok = await pagina.locator(`[data-rota="${campo.id}"]`).evaluate((e) => (e.type === 'checkbox' ? e.checked
            : e.type === 'file' ? e.files.length > 0 : !!String(e.value ?? e.innerText ?? '').trim())).catch(() => false);
        }
        if (ok) {
          if (!respostas.some((r) => r.pergunta === campo.rotulo)) {
            respostas.push({ pergunta: campo.rotulo, resposta: decisao.fonte === 'pessoal' ? '(dado pessoal)' : decisao.valor, fonte: decisao.fonte });
          }
          continue;
        }
        faltando.push(`${nome}${decisao ? ` (o site não aceitou "${String(decisao.valor).slice(0, 40)}")` : ''}`);
        // sem resposta: vai para a caixa Perguntas do painel; a sua resposta fica salva para as próximas vagas
        if (!decisao && !detectarPessoal(campo.rotulo) && campo.tipo !== 'arquivo' && !/senha|password/i.test(campo.rotulo)
          && !pendentes.some((x) => x.pergunta === campo.rotulo)) {
          pendentes.push({ pergunta: campo.rotulo.slice(0, 1000), tipo: campo.tipo, opcoes: campo.opcoes || [] });
        }
      }
      await registrar(`etapa-${etapa}-preenchida`);
      const telaId = JSON.stringify([pagina.url(), titulos, campos.map((c) => c.rotulo)]);
      if (faltando.length && !agenteFeito.has(telaId)) {
        // antes de desistir, o modo agente olha a tela inteira
        agenteFeito.add(telaId);
        const ag = await agenteIA(pagina, ctx, vaga, { respostas, textosTreino: memoria.textos || [] });
        for (const p of ag.perguntas) if (!detectarPessoal(p.pergunta) && !pendentes.some((x) => x.pergunta === p.pergunta)) pendentes.push(p);
        if (ag.agiu) { assinaturaAnterior = null; etapa--; continue; }
      }
      if (faltando.length) {
        const r = await fim('pulada', `Pergunta${faltando.length > 1 ? 's' : ''} obrigatória${faltando.length > 1 ? 's' : ''} sem resposta verdadeira: ${faltando.join('; ')}`);
        r.pendentes = pendentes;
        return r;
      }

      // mesma tela e mesmos campos: o clique anterior não avançou (algum campo recusado)
      const assinatura = JSON.stringify([pagina.url(), titulos, campos.map((c) => c.rotulo)]);
      // a janela final pode abrir por cima do mesmo formulário: não é trava
      if (assinatura === assinaturaAnterior && await pagina.evaluate(lerJanelaFinal, { final: botoes.final }).catch(() => null)) {
        assinaturaAnterior = null;
        continue; // sem etapa--: se repetir, o limite de etapas encerra
      }
      if (assinatura === assinaturaAnterior && !agenteFeito.has(assinatura)) {
        // provavelmente um campo que o leitor não enxerga
        agenteFeito.add(assinatura);
        const ag = await agenteIA(pagina, ctx, vaga, { respostas, textosTreino: memoria.textos || [] });
        if (ag.perguntas.length) {
          const novas = ag.perguntas.filter((p) => !detectarPessoal(p.pergunta));
          if (novas.length) {
            const r = await fim('pulada', `Campos que só você sabe responder: ${novas.map((p) => `"${p.pergunta.slice(0, 100)}"`).join('; ')}`);
            r.pendentes = novas;
            return r;
          }
        }
        if (ag.agiu) { assinaturaAnterior = null; etapa--; continue; }
      }
      if (assinatura === assinaturaAnterior && !confirmouNaTrava) {
        // talvez uma janela de confirmação esteja segurando a tela
        const antes = pagina.url();
        pagina = await confirmarDialogo(pagina, contexto, ctx);
        confirmouNaTrava = true;
        await ctx.log?.('info', 'gupy', pagina.url() !== antes ? 'Saiu da trava pela janela de confirmação.' : 'Tela parada: tentando mais uma vez.');
        assinaturaAnterior = null;
        etapa--;
        continue;
      }
      if (assinatura === assinaturaAnterior) {
        const aviso = await pagina.evaluate(() => [...document.querySelectorAll('[role=alert], [class*=error i], [class*=erro i], [aria-invalid=true]')]
          .map((e) => (e.innerText || e.getAttribute('aria-label') || '').trim()).filter(Boolean).slice(0, 3).join(' | ')).catch(() => '');
        const vazios = (await pagina.evaluate(lerCampos).catch(() => []))
          .filter((c) => c.obrigatorio && !c.preenchido && c.rotulo && !c.autopreencher).map((c) => `"${c.rotulo.slice(0, 60)}"`);
        return fim('erro', `Cliquei para avançar mas a tela não mudou${vazios.length ? `; campos obrigatórios vazios: ${vazios.slice(0, 4).join(', ')}` : ''}${aviso ? ` (a página diz: ${aviso.slice(0, 200)})` : ''}. Veja os prints.`);
      }
      assinaturaAnterior = assinatura;

      await esperarBotao(pagina, [botoes.proximo, botoes.final], 6000); // a página pode ainda estar carregando
      const textoProximo = await pagina.evaluate(acharBotao, botoes.proximo);
      // trava de segurança: botão com cara de envio nunca é tratado como "próximo"
      if (textoProximo && /envi|submit|finaliz|conclu|candidat|apply|inscrev/i.test(textoProximo) && ctx.config.modoTeste) {
        return fim('simulada', `Modo teste: tudo preenchido, parou antes de enviar (botão "${textoProximo}")`);
      }
      if (textoProximo) {
        pagina = await clicarBotao(pagina, contexto);
        pagina = await confirmarDialogo(pagina, contexto, ctx);
        continue;
      }
      const textoFinal = await pagina.evaluate(acharBotao, botoes.final);
      // nada preenchido ainda e o botão é "Candidatar-se": é a página da vaga, não o fim do formulário
      if (textoFinal && !respostas.length && !campos.some((c) => c.rotulo) && !abriuPeloFinal && /candidat|apply|inscrev|aplicar/i.test(textoFinal)) {
        abriuPeloFinal = true;
        pagina = await clicarBotao(pagina, contexto);
        await esperarPagina(pagina);
        continue;
      }
      if (textoFinal && !respostas.length && !campos.some((c) => c.rotulo)) {
        return fim('erro', `Não achei o formulário de candidatura (só o botão "${textoFinal}"). Veja os prints.`);
      }
      if (textoFinal) {
        if (ctx.config.modoTeste) return fim('simulada', 'Modo teste: tudo preenchido, parou antes de enviar');
        pagina = await clicarBotao(pagina, contexto);
        const final = await pagina.innerText('body');
        return SUCESSO.test(final)
          ? fim('enviada', null)
          : fim('erro', 'Cliquei em finalizar, mas não apareceu a confirmação. Confira na Gupy.');
      }
      if (SUCESSO.test(corpo)) return fim(ctx.config.modoTeste ? 'erro' : 'enviada', ctx.config.modoTeste ? 'A candidatura foi concluída sem botão final (confira na Gupy)' : null);
      const travado = await pagina.evaluate(botaoDesativado, botoes.final).catch(() => null)
        || await pagina.evaluate(botaoDesativado, botoes.proximo).catch(() => null);
      if (travado) {
        const vazios = campos.filter((c) => !c.preenchido && c.rotulo).map((c) => c.rotulo).slice(0, 4);
        return fim('erro', `O botão "${travado}" está desativado: falta algum campo${vazios.length ? ` (sem preencher: ${vazios.join('; ')})` : ''}.`);
      }
      // nenhum botão conhecido: a IA escolhe
      const escolha = ajudasIA < MAX_AJUDAS_IA ? await ajudaDaIA(pagina, 'avancar', vaga, ctx) : null;
      if (escolha) ajudasIA++;
      if (escolha?.acao === 'avancar') {
        aprendizado.anotarBotao('botoesAvancar', escolha.texto);
        pagina = await clicarBotao(pagina, contexto);
        pagina = await confirmarDialogo(pagina, contexto, ctx);
        continue;
      }
      if (escolha?.acao === 'finalizar') {
        if (ctx.config.modoTeste) return fim('simulada', `Modo teste: tudo preenchido, parou antes de enviar (botão final: "${escolha.texto}", achado pela IA)`);
        pagina = await clicarBotao(pagina, contexto);
        const final = await pagina.innerText('body');
        if (SUCESSO.test(final)) {
          aprendizado.anotarBotao('botoesFinal', escolha.texto); // só aprende depois de confirmar o envio
          return fim('enviada', null);
        }
        return fim('erro', `Cliquei em "${escolha.texto}" (escolhido pela IA), mas não apareceu a confirmação. Confira na Gupy.`);
      }
      const naTela = (await pagina.evaluate(listarClicaveis).catch(() => []))
        .map((c) => c.texto).filter((t) => t && t.length <= 40);
      const lista = [...new Set(naTela)].slice(0, 10).map((t) => `"${t}"`).join(', ');
      return fim('erro', `Não encontrei o botão para avançar na etapa ${etapa}. Botões na tela: ${lista || '(nenhum)'}`);
    }
    return fim('erro', `Mais de ${MAX_ETAPAS} etapas: parei por segurança`);
  } catch (e) {
    return fim('erro', e.message.split('\n')[0].slice(0, 300), 'excecao');
  } finally {
    await pausa(300, 600);
    // 1º o agente de IA tenta terminar; só se ele também travar é que chama você
    const agente = agenteFn || (!iaFn && ia.disponivel() && process.env.ROTA_AGENTE !== 'false' ? require('../agente/agente').agir : null);
    const naoAdianta = /anti-rob|captcha|já se candidatou|janela fechou|Mais de \d+ etapas|net::ERR_|page\.goto/i;
    if (agente && ['erro', 'pulada'].includes(ultimo?.resultado) && !naoAdianta.test(ultimo.motivo || '')) {
      try {
        const viva = pagina && !pagina.isClosed() ? pagina : nav.contexto.pages().at(-1);
        await avisar(viva, 'trabalhando').catch(() => {});
        await ctx.log?.('info', 'agente', `As regras travaram (${String(ultimo.motivo).slice(0, 120)}). O agente de IA vai tentar terminar.`);
        const ag = await agente({ pagina: viva, contexto: nav.contexto, ctx: { ...ctx, aprendidas: Object.values(memoria.respostas || {}).map((a) => ({ pergunta: a.pergunta, resposta: String(a.valor) })) }, vaga, preencherFn: preencher, log: ctx.log || (async () => {}) });
        respostas.push(...(ag.respostas || []));
        await ctx.log?.('info', 'agente', `Agente: ${ag.resultado} — ${ag.motivo} (${ag.passos} passos)`);
        if (['simulada', 'enviada', 'ja_candidatado'].includes(ag.resultado)) {
          Object.assign(ultimo, {
            resultado: ag.resultado === 'ja_candidatado' ? 'pulada' : ag.resultado, motivo: ag.motivo,
            paraVoce: false, pendentes: [], resolvidoPor: 'agente',
          });
          pagina = viva;
          await registrar(`agente-${ag.resultado}`, { resultado: ag.resultado, motivo: ag.motivo, url: viva.url(), respostas });
        } else {
          ultimo.motivo = `${ultimo.motivo} | Agente de IA: ${ag.motivo}`;
          pagina = viva;
        }
      } catch (e) {
        ultimo.motivo = `${ultimo.motivo} | Agente de IA deu erro: ${e.message.split('\n')[0].slice(0, 150)}`;
      }
    }
    if (aoTravar && ['erro', 'pulada'].includes(ultimo?.resultado) && !/já se candidatou/i.test(ultimo.motivo || '')) {
      ultimo.observado = await aoTravar({ contexto: nav.contexto, pagina, resultado: ultimo }).catch(() => null);
    }
    await pausa(1500, 3000);
    await nav.fechar().catch(() => {});
  }
}

module.exports = { tipo: 'candidatura', candidatar, PASTA_LOGS, preencher, fazerLogin, naTelaDeLogin };
