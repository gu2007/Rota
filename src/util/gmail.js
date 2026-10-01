// Leitura do Gmail via IMAP. Só lê: não apaga nem marca como lido.

// links ignorados antes de a IA escolher o do processo
const LINK_INUTIL = /unsubscribe|descadastr|cancelar inscri|preferenc|privacy|privacidade|politica|facebook\.com|instagram\.com|twitter\.com|x\.com\/|youtube\.com|tiktok\.com|linkedin\.com\/company|play\.google|apps\.apple|mailto:|tel:/i;
function linksDe(html) {
  const vistos = new Set();
  const lista = [];
  const re = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || ''))) && lista.length < 40) {
    const url = m[1].replace(/&amp;/g, '&').trim();
    const texto = m[2].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!/^https?:/i.test(url) || LINK_INUTIL.test(url) || LINK_INUTIL.test(texto) || vistos.has(url)) continue;
    vistos.add(url);
    lista.push({ url, texto });
  }
  return lista;
}

// abre o e-mail no Gmail pelo Message-ID
const linkGmail = (id) => `https://mail.google.com/mail/u/0/#search/rfc822msgid%3A${encodeURIComponent(String(id || '').replace(/^<|>$/g, ''))}`;

const configurado = () => !!(process.env.GMAIL_USUARIO && process.env.GMAIL_SENHA_APP);

// busca usa a sintaxe do Gmail; ids em jaLidos são pulados
async function lerEmails({ busca, dias = 7, max = 40, jaLidos = new Set() }) {
  const { ImapFlow } = require('imapflow');
  const { simpleParser } = require('mailparser');
  const cliente = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true, logger: false,
    auth: { user: process.env.GMAIL_USUARIO, pass: String(process.env.GMAIL_SENHA_APP).replace(/\s+/g, '') },
  });
  try {
    await cliente.connect();
  } catch (e) {
    throw new Error(`Não consegui entrar no Gmail (${e.responseText || e.message}). Confira GMAIL_USUARIO e a senha de app no .env.`);
  }
  const trava = await cliente.getMailboxLock('INBOX');
  const saida = [];
  try {
    let uids = await cliente.search({ gmraw: busca }, { uid: true }).catch(() => null);
    if (!uids) uids = await cliente.search({ since: new Date(Date.now() - dias * 86400000) }, { uid: true });
    for (const uid of (uids || []).slice(-max)) {
      const msg = await cliente.fetchOne(uid, { source: true, envelope: true }, { uid: true });
      const id = msg?.envelope?.messageId || `uid-${uid}`;
      if (!msg || jaLidos.has(id)) continue;
      const email = await simpleParser(msg.source);
      saida.push({
        id, assunto: email.subject || '', de: email.from?.text || '', data: email.date || new Date(),
        texto: email.text || '', html: email.html || '', links: linksDe(email.html || email.textAsHtml || ''),
      });
    }
  } finally {
    trava.release();
    await cliente.logout().catch(() => {});
  }
  return saida;
}

module.exports = { lerEmails, configurado, linksDe, linkGmail };
