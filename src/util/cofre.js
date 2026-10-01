// Criptografia AES-256-GCM dos dados pessoais. A chave (ROTA_CHAVE) fica só no .env.
// Formato no banco: "iv:tag:conteudo" em base64. Perdeu a chave, perdeu os dados.

const crypto = require('crypto');

function chave() {
  const texto = process.env.ROTA_CHAVE;
  if (!texto) throw new Error('ROTA_CHAVE não está no .env. Rode "npm run db:init" para gerar uma.');
  const bytes = Buffer.from(texto, 'base64');
  if (bytes.length !== 32) throw new Error('ROTA_CHAVE inválida (precisa ter 32 bytes em base64).');
  return bytes;
}

const gerarChave = () => crypto.randomBytes(32).toString('base64');

function cifrar(texto) {
  const iv = crypto.randomBytes(12);
  const cifra = crypto.createCipheriv('aes-256-gcm', chave(), iv);
  const conteudo = Buffer.concat([cifra.update(String(texto), 'utf8'), cifra.final()]);
  return [iv, cifra.getAuthTag(), conteudo].map((b) => b.toString('base64')).join(':');
}

function decifrar(guardado) {
  const [iv, tag, conteudo] = String(guardado).split(':').map((p) => Buffer.from(p, 'base64'));
  const decifra = crypto.createDecipheriv('aes-256-gcm', chave(), iv);
  decifra.setAuthTag(tag);
  return Buffer.concat([decifra.update(conteudo), decifra.final()]).toString('utf8');
}

// para o painel: mostra só o final
function mascarar(valor) {
  const t = String(valor || '');
  if (t.length <= 3) return '***';
  return `${'•'.repeat(Math.min(8, t.length - 3))}${t.slice(-3)}`;
}

module.exports = { cifrar, decifrar, gerarChave, mascarar };
