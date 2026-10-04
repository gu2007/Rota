// Entra num site de vagas com o login salvo (npm run login:salvar).
// Preenche e-mail/usuário e senha, clica em Entrar e confere. Se o site pedir CAPTCHA ou código
// por e-mail/SMS, para e devolve o motivo (aí o Rota pede a sua ajuda; ele nunca resolve CAPTCHA).
// A senha nunca vai para log, print ou resposta: o campo é type=password e os prints tarjam.

const { pausa } = require('./navegador');
const { temDesafio } = require('../candidatura/leitor-pagina');

const CAMPO_USUARIO = 'input[type=email], input[autocomplete=username], input[name*=email i], input[id*=email i], input[name*=user i], input[id*=user i], input[name*=login i], input[id*=login i], input[placeholder*=mail i], input[placeholder*=usu i]';
const BOTAO_ENTRAR = /^(entrar|acessar|login|log in|sign in|fazer login|continuar|continue|pr[oó]ximo|next|avan[cç]ar|enviar)$/i;
const PEDE_CODIGO = /c[oó]digo de (verifica|seguran|acesso)|enviamos um c[oó]digo|verification code|one-time|digite o c[oó]digo|2fa|autentica[cç][aã]o em dois/i;
const ERRO_SENHA = /senha (incorreta|inv[aá]lida|errada)|(e-?mail|usu[aá]rio) ou senha (incorret|inv[aá]lid)|incorrect password|invalid (password|credentials)|dados (incorretos|inv[aá]lidos)/i;

async function visivel(loc) {
  const n = await loc.count().catch(() => 0);
  for (let i = 0; i < n; i++) if (await loc.nth(i).isVisible().catch(() => false)) return loc.nth(i);
  return null;
}

async function clicarEntrar(pagina) {
  const submit = await visivel(pagina.locator('button[type=submit], input[type=submit]'));
  if (submit) return submit.click({ timeout: 6000 }).catch(() => {});
  const botao = await visivel(pagina.getByRole('button', { name: BOTAO_ENTRAR }));
  if (botao) return botao.click({ timeout: 6000 }).catch(() => {});
  return pagina.keyboard.press('Enter').catch(() => {});
}

// devolve { ok: true } ou { ok: false, motivo }
async function entrarComSenha(pagina, cred) {
  if (await pagina.evaluate(temDesafio).catch(() => null)) return { ok: false, motivo: 'o site pediu verificação anti-robô (CAPTCHA) no login' };

  // alguns sites mostram primeiro um botão "Entrar com e-mail"
  if (!(await visivel(pagina.locator(CAMPO_USUARIO))) && !(await visivel(pagina.locator('input[type=password]')))) {
    const comEmail = await visivel(pagina.getByRole('button', { name: /(entrar|continuar|acessar) com (e-?mail|senha)|usar e-?mail/i }));
    if (comEmail) { await comEmail.click().catch(() => {}); await pausa(1500, 2500); }
  }

  const usuario = await visivel(pagina.locator(CAMPO_USUARIO)) || await visivel(pagina.locator('input[type=text]'));
  if (usuario) {
    await usuario.click().catch(() => {});
    await usuario.fill('').catch(() => {});
    await usuario.pressSequentially(cred.usuario, { delay: 60 }).catch(() => {});
    await pausa(400, 900);
  }
  let senha = await visivel(pagina.locator('input[type=password]'));
  if (!senha) {
    // e-mail primeiro, senha na tela seguinte
    await clicarEntrar(pagina);
    await pausa(2500, 4000);
    senha = await visivel(pagina.locator('input[type=password]'));
  }
  if (!senha) {
    const texto = await pagina.innerText('body').catch(() => '');
    return { ok: false, motivo: PEDE_CODIGO.test(texto) ? 'o site mandou um código por e-mail/SMS para entrar' : 'não achei o campo de senha' };
  }
  await senha.click().catch(() => {});
  await senha.fill('').catch(() => {});
  await senha.pressSequentially(cred.senha, { delay: 60 }).catch(() => {});
  await pausa(400, 900);
  await clicarEntrar(pagina);

  // espera sair da tela de login
  for (let i = 0; i < 20; i++) {
    await pausa(900, 1100);
    const texto = await pagina.innerText('body').catch(() => '');
    if (ERRO_SENHA.test(texto)) return { ok: false, motivo: 'o site disse que o e-mail ou a senha estão errados (confira com npm run login:salvar)' };
    if (PEDE_CODIGO.test(texto)) return { ok: false, motivo: 'o site mandou um código por e-mail/SMS para entrar' };
    if (await pagina.evaluate(temDesafio).catch(() => null)) return { ok: false, motivo: 'o site pediu verificação anti-robô (CAPTCHA) no login' };
    if (!(await visivel(pagina.locator('input[type=password]')))) return { ok: true };
  }
  const aviso = await pagina.evaluate(() => [...document.querySelectorAll('[role=alert], [class*=error i], [class*=erro i], [class*=invalid i], .validation-summary-errors, .field-validation-error')]
    .map((e) => (e.innerText || '').trim()).filter(Boolean).join(' | ').slice(0, 200)).catch(() => '');
  const captcha = await pagina.locator('iframe[src*=recaptcha], iframe[src*=hcaptcha], iframe[src*=turnstile]').count().catch(() => 0);
  return { ok: false, motivo: `cliquei em Entrar, mas a tela de login não saiu${aviso ? ` (a página diz: ${aviso})` : ''}${captcha ? ' (tem CAPTCHA na tela)' : ''}` };
}

module.exports = { entrarComSenha };
