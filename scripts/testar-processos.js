// Lê os e-mails dos processos seletivos e avisa no WhatsApp.
// npm run testar:processos
const { ambiente } = require('../src/config');
const acompanhamento = require('../src/acompanhamento/processos');
const whatsapp = require('../src/notificacao/whatsapp');

async function main() {
  const repo = require('../src/db').repo();
  await repo.iniciar(ambiente.banco);
  const log = async (nivel, origem, msg) => { console.log(`  [${origem}] ${msg}`); await repo.eventos.registrar(nivel, origem, msg); };
  console.log('\n=== Rota · acompanhamento dos processos seletivos ===\n');
  await acompanhamento.verificar({ repo, log });
  const lista = await repo.processos.listar(15);
  for (const p of lista) {
    const [icone, texto] = acompanhamento.ROTULO[p.situacao] || acompanhamento.ROTULO.outro;
    console.log(`  ${icone} ${new Date(p.recebido_em).toLocaleDateString('pt-BR')}  ${p.empresa || '?'} — ${texto}${p.vaga_titulo ? ` (${p.vaga_titulo})` : ''}`);
    if (p.acao) console.log(`        o que fazer: ${p.acao}`);
  }
  if (!whatsapp.configurado()) console.log('\n  WhatsApp: falta WHATSAPP_NUMERO no .env (as novidades ficam guardadas e são enviadas depois).');
  else {
    console.log(`\n  WhatsApp: ${await acompanhamento.notificar({ repo, log })} mensagens enviadas.`);
    console.log(`  Lembretes (prazo amanhã): ${await acompanhamento.lembrar({ repo, log })}.`);
  }
  await whatsapp.desconectar();
  await repo.encerrar();
  console.log('');
  process.exit(0);
}
main().catch(async (e) => { console.error('\nErro:', e.message, '\n'); await whatsapp.desconectar(); process.exit(1); });
process.on('SIGINT', async () => { await whatsapp.desconectar(); process.exit(1); });
