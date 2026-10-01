// Conecta o WhatsApp ao Rota e manda uma mensagem de teste.
// npm run whatsapp:conectar
require('dotenv').config();
const whatsapp = require('../src/notificacao/whatsapp');

(async () => {
  if (!whatsapp.configurado()) {
    console.log('\n  Falta WHATSAPP_NUMERO no .env. Ex.: WHATSAPP_NUMERO=5511999999999 (55 + DDD + número)\n');
    process.exit(1);
  }
  console.log('\n  Conectando ao WhatsApp (pode levar até 1 minuto)…');
  await whatsapp.conectar({ mostrarQr: true, limiteMs: 180000, progresso: (m) => console.log(`  … ${m}`) });
  console.log('  ✓ Conectado. Mandando mensagem de teste para você…');
  await whatsapp.enviar('✅ *Rota conectado!*\nDaqui para frente eu te aviso aqui quando um processo seletivo andar.');
  console.log('  ✓ O WhatsApp confirmou a entrega. Confira a conversa "Você" / "Mensagem para mim" (o seu próprio número).\n');
  await whatsapp.desconectar();
  process.exit(0);
})().catch(async (e) => {
  console.error('\nErro:', e.message, '\n');
  await whatsapp.desconectar(); // senão o WhatsApp fica aberto em segundo plano segurando a sessão
  process.exit(1);
});
process.on('SIGINT', async () => { await whatsapp.desconectar(); process.exit(1); });
