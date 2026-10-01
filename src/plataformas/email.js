// Coleta de alertas de vagas no Gmail via IMAP. Só lê: não apaga nem marca como lido.
// Cada e-mail é processado uma vez (dados/email/lidos.json). Requer GMAIL_USUARIO e GMAIL_SENHA_APP (senha de app).

const fs = require('fs');
const path = require('path');
const { extrairLinks, resolverRedirecionamento } = require('../coleta/links-vagas');
const ia = require('../ia/gemini');
const { completarPorId } = require('./portal-gupy');
const { limparTitulo } = require('../ia/pontuador');

const PASTA = path.join(__dirname, '..', '..', 'dados', 'email');
const ARQUIVO_LIDOS = path.join(PASTA, 'lidos.json');
const DIAS = 4;
const MAX_EMAILS = 40;          // por leitura
const MAX_RASTREIOS = 15; // por e-mail

const BUSCA_GMAIL = `newer_than:${DIAS}d {from:linkedin.com from:gupy.io from:gupy.com.br from:infojobs.com.br from:indeed.com from:catho.com.br from:vagas.com.br from:glassdoor.com from:ciee.org.br from:nube.com.br subject:vaga subject:vagas subject:estágio subject:estagio}`;

const configurado = () => !!(process.env.GMAIL_USUARIO && process.env.GMAIL_SENHA_APP);

function carregarLidos() {
  try { return new Set(JSON.parse(fs.readFileSync(ARQUIVO_LIDOS, 'utf8'))); } catch { return new Set(); }
}
function salvarLidos(lidos) {
  fs.mkdirSync(PASTA, { recursive: true });
  fs.writeFileSync(ARQUIVO_LIDOS, JSON.stringify([...lidos].slice(-3000)));
}

// separado do IMAP para dar para testar sem Gmail
async function vagasDoEmail({ assunto, html, texto }, { fetchFn = fetch, iaFn = ia.completarVagasEmail } = {}) {
  const { vagas, rastreios } = extrairLinks(html || '');
  // links de rastreamento: segue até o destino
  for (const r of rastreios.slice(0, MAX_RASTREIOS)) {
    const destino = await resolverRedirecionamento(r, { fetchFn }).catch(() => null);
    if (destino && !vagas.some((v) => v.url === destino.url)) vagas.push({ ...destino, textos: [], titulo: null });
  }
  if (!vagas.length) return [];
  const extra = await iaFn({ assunto, texto, vagas }).catch(() => ({}));
  const MODELOS = ['presencial', 'hibrido', 'remoto'];
  const prontas = vagas
    .map((v) => {
      const x = extra[v.url] || {};
      return {
        url: v.url,
        titulo: x.titulo || (v.titulo ? limparTitulo(v.titulo) : null),
        empresa: x.empresa || null,
        local: x.local || null,
        modelo: MODELOS.includes(x.modelo) ? x.modelo : null,
        descricao: null,
      };
    })
    .filter((v) => v.titulo); // sem título não dá para pontuar

  // Gupy: busca a descrição completa no portal, senão a nota fica baixa
  for (const v of prontas) {
    const jobId = gupyJobId(v.url);
    if (!jobId) continue;
    const completa = await completarPorId(jobId, v.titulo, { fetchFn });
    if (completa) Object.assign(v, { ...completa, url: v.url });
  }
  return prontas;
}

function gupyJobId(url) {
  const m = String(url).match(/\.gupy\.io\/job\/([A-Za-z0-9=_-]+)/);
  if (!m) return null;
  try { return JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')).jobId || null; } catch { return null; }
}

async function coletar(ctx, { fetchFn = fetch } = {}) {
  if (!configurado()) {
    await ctx.log('aviso', 'email', 'Leitura de e-mails desligada: falta GMAIL_USUARIO e GMAIL_SENHA_APP no .env.');
    return [];
  }
  const { ImapFlow } = require('imapflow');
  const { simpleParser } = require('mailparser');
  const cliente = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true, logger: false,
    auth: { user: process.env.GMAIL_USUARIO, pass: process.env.GMAIL_SENHA_APP.replace(/\s+/g, '') },
  });
  const lidos = carregarLidos();
  const todas = [];
  let emails = 0;
  try {
    await cliente.connect();
  } catch (e) {
    throw new Error(`Não consegui entrar no Gmail (${e.responseText || e.message}). Confira GMAIL_USUARIO e a senha de app no .env.`);
  }
  const trava = await cliente.getMailboxLock('INBOX');
  try {
    let uids = await cliente.search({ gmraw: BUSCA_GMAIL }, { uid: true }).catch(() => null);
    if (!uids) uids = await cliente.search({ since: new Date(Date.now() - DIAS * 86400000) }, { uid: true });
    for (const uid of (uids || []).slice(-MAX_EMAILS)) {
      // peek: lê sem marcar como lido
      const msg = await cliente.fetchOne(uid, { source: true, envelope: true }, { uid: true });
      const id = msg?.envelope?.messageId || `uid-${uid}`;
      if (!msg || lidos.has(id)) continue;
      const email = await simpleParser(msg.source);
      const vagas = await vagasDoEmail({ assunto: email.subject, html: email.html || email.textAsHtml, texto: email.text }, { fetchFn });
      todas.push(...vagas);
      lidos.add(id);
      emails++;
    }
  } finally {
    trava.release();
    await cliente.logout().catch(() => {});
    salvarLidos(lidos);
  }
  const unicas = [...new Map(todas.map((v) => [v.url, v])).values()];
  await ctx.log('info', 'email', `E-mails: ${emails} alertas novos lidos, ${unicas.length} links de vagas.`);
  return unicas;
}

module.exports = { tipo: 'coleta', coletar, vagasDoEmail, configurado, BUSCA_GMAIL };
