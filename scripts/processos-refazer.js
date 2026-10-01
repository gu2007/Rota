// Apaga o que foi lido dos processos seletivos e lê tudo de novo (útil após mudar a leitura).
// As mensagens do WhatsApp são reenviadas.
// npm run processos:refazer
const fs = require('fs');
const path = require('path');
const { ambiente } = require('../src/config');
const acompanhamento = require('../src/acompanhamento/processos');
const whatsapp = require('../src/notificacao/whatsapp');

async function main() {
  const repo = require('../src/db').repo();
  await repo.iniciar(ambiente.banco);
  const log = async (nivel, origem, msg) => { console.log(`  [${origem}] ${msg}`); await repo.eventos.registrar(nivel, origem, msg); };
  console.log('\n=== Rota · lendo de novo os e-mails dos processos seletivos ===\n');
  await repo.processos.limpar();
  fs.rmSync(path.join(__dirname, '..', 'dados', 'email', 'processos-lidos.json'), { force: true });
  await acompanhamento.verificar({ repo, log });
  console.log(`  WhatsApp: ${await acompanhamento.notificar({ repo, log })} mensagens enviadas.`);
  console.log(`  Lembretes de amanhã: ${await acompanhamento.lembrar({ repo, log })}.\n`);
  await whatsapp.desconectar();
  await repo.encerrar();
  process.exit(0);
}
main().catch(async (e) => { console.error('\nErro:', e.message, '\n'); await whatsapp.desconectar(); process.exit(1); });
