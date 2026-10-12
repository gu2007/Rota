// Senha do painel. No PC o painel só abre no próprio computador; no servidor ele fica na
// internet (via Nginx), então toda página e toda chamada da API passam a pedir a senha.
//   A senha é definida com: npm run painel:senha   (fica só o "hash" dela no .env)
const crypto = require('crypto');
const express = require('express');

const DURACAO = 30 * 24 * 60 * 60 * 1000; // 30 dias logado no mesmo aparelho
const COOKIE = 'rota_sessao';

// hash da senha: scrypt com sal aleatório, guardado como "sal:hash" (base64)
function gerarHash(senha) {
  const sal = crypto.randomBytes(16);
  return `${sal.toString('base64')}:${crypto.scryptSync(senha, sal, 64).toString('base64')}`;
}
function conferirSenha(senha, guardado) {
  const [sal, hash] = String(guardado || '').split(':');
  if (!sal || !hash) return false;
  const calc = crypto.scryptSync(String(senha), Buffer.from(sal, 'base64'), 64);
  const esperado = Buffer.from(hash, 'base64');
  return calc.length === esperado.length && crypto.timingSafeEqual(calc, esperado);
}

// chave que assina o cookie: muda se a senha mudar (trocar a senha desloga todo mundo)
const chaveCookie = () => crypto.createHash('sha256').update(`${process.env.ROTA_CHAVE}|${process.env.PAINEL_SENHA_HASH}`).digest();
const assinar = (validade) => `${validade}.${crypto.createHmac('sha256', chaveCookie()).update(String(validade)).digest('base64url')}`;
function sessaoValida(token) {
  const [validade, assinatura] = String(token || '').split('.');
  if (!validade || !assinatura || Number(validade) < Date.now()) return false;
  const certo = Buffer.from(assinar(validade).split('.')[1]);
  const veio = Buffer.from(assinatura);
  return certo.length === veio.length && crypto.timingSafeEqual(certo, veio);
}
const lerCookie = (req) => (req.headers.cookie || '').split(';').map((c) => c.trim().split('='))
  .find(([k]) => k === COOKIE)?.[1];

// limite de tentativas erradas por IP: 5 a cada 15 minutos
const tentativas = new Map();
function bloqueado(ip) {
  const t = tentativas.get(ip);
  if (!t || t.ate < Date.now()) { tentativas.delete(ip); return false; }
  return t.erros >= 5;
}
function errou(ip) {
  const t = tentativas.get(ip) && tentativas.get(ip).ate > Date.now() ? tentativas.get(ip) : { erros: 0, ate: Date.now() + 15 * 60 * 1000 };
  t.erros += 1;
  tentativas.set(ip, t);
}

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const paginaEntrar = (erro = '') => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Rota · entrar</title>
<style>
:root{--fundo:#f4f3ef;--sup:#fff;--borda:#e0ded7;--texto:#15171a;--texto2:#5c636d;--faixa:#f2b33d;--asfalto:#22262b;--erro:#d0453f}
@media (prefers-color-scheme:dark){:root{--fundo:#121417;--sup:#1b1e22;--borda:#2c3036;--texto:#eceae4;--texto2:#a3a9b2}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--fundo);color:var(--texto);font:16px system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:16px}
form{width:100%;max-width:340px;background:var(--sup);border:1px solid var(--borda);border-radius:14px;padding:28px 22px}
h1{margin:0 0 4px;font-size:26px;letter-spacing:-.02em}h1 span{display:inline-block;width:28px;height:6px;background:var(--faixa);border-radius:3px;margin-left:8px;vertical-align:middle}
p{margin:0 0 20px;color:var(--texto2);font-size:14px}label{font-size:13px;color:var(--texto2)}
input{width:100%;margin:6px 0 16px;padding:12px;border:1px solid var(--borda);border-radius:10px;font-size:16px;background:var(--fundo);color:var(--texto)}
button{width:100%;padding:12px;border:0;border-radius:10px;background:var(--asfalto);color:#fff;font-size:16px;font-weight:600}
@media (prefers-color-scheme:dark){button{background:var(--faixa);color:#15171a}}
.erro{color:var(--erro);font-size:14px;margin:-6px 0 14px}
</style></head><body><form method="post" action="/entrar">
<h1>Rota<span></span></h1><p>Painel de candidaturas</p>
<label for="s">Senha</label><input id="s" name="senha" type="password" autocomplete="current-password" autofocus required>
${erro ? `<div class="erro">${esc(erro)}</div>` : ''}<button type="submit">Entrar</button></form></body></html>`;

// Liga a proteção. Se não houver senha definida, só deixa entrar quem está no próprio
// computador (sem passar pelo Nginx), como era antes.
function protegerPainel(app) {
  app.set('trust proxy', 'loopback'); // o Nginx do servidor fica na frente e avisa o IP real
  const temSenha = () => Boolean(process.env.PAINEL_SENHA_HASH);
  const veioDeFora = (req) => Boolean(req.headers['x-forwarded-for'] || req.headers['x-real-ip']);

  app.get('/entrar', (req, res) => res.type('html').send(paginaEntrar()));
  app.post('/entrar', express.urlencoded({ extended: false, limit: '2kb' }), (req, res) => {
    const ip = req.ip;
    if (!temSenha()) return res.status(503).type('html').send(paginaEntrar('Senha do painel ainda não definida (npm run painel:senha).'));
    if (bloqueado(ip)) return res.status(429).type('html').send(paginaEntrar('Muitas tentativas. Espere 15 minutos.'));
    if (!conferirSenha(req.body?.senha || '', process.env.PAINEL_SENHA_HASH)) {
      errou(ip);
      return res.status(401).type('html').send(paginaEntrar('Senha errada.'));
    }
    tentativas.delete(ip);
    res.cookie(COOKIE, assinar(Date.now() + DURACAO), {
      httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: DURACAO, path: '/',
    });
    res.redirect('/');
  });
  app.get('/sair', (req, res) => { res.clearCookie(COOKIE, { path: '/' }); res.redirect('/entrar'); });

  app.use((req, res, next) => {
    if (!temSenha()) {
      if (!veioDeFora(req)) return next();
      return res.status(503).send('Painel sem senha: rode npm run painel:senha no servidor.');
    }
    if (sessaoValida(lerCookie(req))) return next();
    if (req.path.startsWith('/api')) return res.status(401).json({ erro: 'Entre de novo no painel.' });
    return res.redirect('/entrar');
  });
}

module.exports = { protegerPainel, gerarHash, conferirSenha };
