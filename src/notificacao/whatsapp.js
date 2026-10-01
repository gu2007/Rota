// Envia mensagens para o próprio número (conversa "Você") via whatsapp-web.js.
// Primeira conexão: npm run whatsapp:conectar. A sessão fica em dados/whatsapp.

const fs = require('fs');
const path = require('path');

const PASTA = path.join(__dirname, '..', '..', 'dados', 'whatsapp');
let cliente = null;
let pronto = null; // conexão em andamento

const numero = () => String(process.env.WHATSAPP_NUMERO || '').replace(/\D/g, '');
const configurado = () => numero().length >= 12;

// No Linux ARM (Oracle) o puppeteer não tem Chrome próprio: usa o Chromium do Playwright.
function navegador() {
  if (process.env.WHATSAPP_NAVEGADOR) return process.env.WHATSAPP_NAVEGADOR;
  if (process.platform !== 'linux') return undefined;
  try {
    const caminho = require('playwright').chromium.executablePath();
    return fs.existsSync(caminho) ? caminho : undefined;
  } catch { return undefined; }
}

function conectar({ mostrarQr = false, limiteMs = 90000, progresso = null } = {}) {
  if (pronto) return pronto;
  const { Client, LocalAuth } = require('whatsapp-web.js');
  cliente = new Client({
    authStrategy: new LocalAuth({ dataPath: PASTA }),
    puppeteer: { headless: true, executablePath: navegador(), args: ['--no-sandbox', '--disable-setuid-sandbox'] },
  });
  pronto = new Promise((resolve, reject) => {
    const tempo = setTimeout(() => reject(new Error('O WhatsApp demorou demais para conectar. Feche o WhatsApp "escondido" que ficou aberto (veja o README) e tente de novo.')), limiteMs);
    cliente.on('qr', (qr) => {
      if (!mostrarQr) {
        clearTimeout(tempo);
        reject(new Error('WhatsApp não conectado: rode "npm run whatsapp:conectar" e escaneie o QR Code.'));
        return;
      }
      console.log('\n  Escaneie com o celular: WhatsApp > Aparelhos conectados > Conectar aparelho\n');
      require('qrcode-terminal').generate(qr, { small: true });
    });
    cliente.on('loading_screen', (pct) => progresso?.(`carregando o WhatsApp Web… ${pct}%`));
    cliente.on('authenticated', () => progresso?.('sessão aceita, abrindo as conversas…'));
    cliente.on('ready', () => { clearTimeout(tempo); resolve(cliente); });
    cliente.on('auth_failure', (m) => { clearTimeout(tempo); reject(new Error(`WhatsApp recusou a sessão (${m}). Rode "npm run whatsapp:conectar" de novo.`)); });
    cliente.on('disconnected', () => { pronto = null; cliente = null; });
    cliente.initialize().catch((e) => { clearTimeout(tempo); reject(e); });
  }).catch((e) => { pronto = null; throw e; });
  return pronto;
}

// Espera o ack do servidor: se o navegador fechar antes, a mensagem fica presa e não chega.
function esperarEntrega(c, msg, limiteMs = 20000) {
  return new Promise((resolve) => {
    if (!msg) return resolve(false);
    if ((msg.ack ?? 0) >= 1) return resolve(true);
    const id = msg.id?._serialized;
    const fim = setTimeout(() => { c.removeListener('message_ack', ouvir); resolve(false); }, limiteMs);
    function ouvir(m, ack) {
      if (m?.id?._serialized === id && ack >= 1) { clearTimeout(fim); c.removeListener('message_ack', ouvir); resolve(true); }
    }
    c.on('message_ack', ouvir);
  });
}

// Algumas versões do WhatsApp Web não devolvem a mensagem no sendMessage,
// então ela é pega pelo message_create com o mesmo texto.
function escutarCriada(c, texto, limiteMs = 15000) {
  let cancelar;
  const promessa = new Promise((resolve) => {
    const fim = setTimeout(() => { c.removeListener('message_create', ouvir); resolve(null); }, limiteMs);
    function ouvir(m) {
      if (m?.fromMe && String(m.body || '').trim() === String(texto).trim()) {
        clearTimeout(fim); c.removeListener('message_create', ouvir); resolve(m);
      }
    }
    c.on('message_create', ouvir);
    cancelar = () => { clearTimeout(fim); c.removeListener('message_create', ouvir); resolve(null); };
  });
  return { promessa, cancelar };
}

// para o próprio número usa o wid da sessão, que cai na conversa "Você"
async function destino(c) {
  const meu = c.info?.wid?._serialized;
  const digitosMeu = String(c.info?.wid?.user || '').replace(/\D/g, '');
  if (meu && digitosMeu && digitosMeu.slice(-8) === numero().slice(-8)) return meu;
  const id = await c.getNumberId(numero());
  if (!id) throw new Error(`O número ${numero()} não foi encontrado no WhatsApp.`);
  return id._serialized;
}

async function enviar(texto) {
  if (!configurado()) throw new Error('Falta WHATSAPP_NUMERO no .env (55 + DDD + número).');
  const c = await conectar();
  const para = await destino(c);
  const criada = escutarCriada(c, texto);
  // sendSeen: false evita o erro de "marcar como visto" nas versões novas
  const devolvida = await c.sendMessage(para, texto, { sendSeen: false });
  const msg = devolvida?.id ? devolvida : await criada.promessa;
  if (devolvida?.id) criada.cancelar();
  if (!msg) throw new Error('O WhatsApp não registrou a mensagem. Abra o WhatsApp no celular e rode de novo.');
  const entregue = await esperarEntrega(c, msg);
  if (!entregue) throw new Error('O WhatsApp não confirmou o envio em 20s (celular sem internet?). Tento de novo na próxima.');
  return true;
}

async function desconectar() {
  const c = cliente;
  pronto = null;
  cliente = null;
  if (c) {
    await new Promise((r) => setTimeout(r, 3000)); // deixa a fila do WhatsApp Web esvaziar
    await c.destroy().catch(() => {});
  }
}

module.exports = { conectar, enviar, desconectar, configurado };
