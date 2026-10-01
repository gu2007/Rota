// Lê agora os alertas de vaga do Gmail e põe as vagas na fila (precisa de GMAIL_USUARIO e GMAIL_SENHA_APP).
// npm run testar:email

const { ambiente, lerConfiguracoes } = require('../src/config');
const { registrarVaga } = require('../src/agendador/executor');
const email = require('../src/plataformas/email');
const ia = require('../src/ia/gemini');

async function main() {
  const repo = require('../src/db').repo();
  await repo.iniciar(ambiente.banco);
  const log = async (nivel, origem, msg) => { console.log(`  [${origem}] ${msg}`); await repo.eventos.registrar(nivel, origem, msg); };
  const config = lerConfiguracoes(await repo.config.obter());

  console.log('\n=== Rota · leitura dos alertas de vaga no Gmail ===\n');
  if (!email.configurado()) {
    console.log('  Falta GMAIL_USUARIO e GMAIL_SENHA_APP no .env (veja o passo a passo no README).\n');
    return repo.encerrar();
  }
  if (!ia.disponivel()) console.log('  Aviso: sem GEMINI_API_KEY. Empresa e local das vagas podem ficar vazios.\n');

  const vagas = await email.coletar({ config, log });
  let novas = 0, fila = 0;
  const destino = { gupy: 'fila da Gupy', linkedin: 'vai abrir no LinkedIn para achar o link', infojobs: 'fila do InfoJobs', sites: 'fila de sites' };
  for (const v of vagas) {
    const r = await registrarVaga(repo, v, { origem_plataforma: 'email', origem_coleta: 'email' });
    if (!r.nova) continue;
    novas++;
    const salva = await repo.vagas.obter(r.id);
    if (r.aprovada) fila++;
    console.log(`  ${r.aprovada ? '+' : '-'} [${String(r.nota).padStart(3)}] ${v.titulo}${v.empresa ? ` — ${v.empresa}` : ''}${v.local ? ` (${v.local})` : ''}`);
    console.log(`        ${r.aprovada ? destino[salva.plataforma_envio] || salva.plataforma_envio : 'descartada pela nota'} · ${v.url}`);
  }
  console.log(`\n  ${vagas.length} links · ${novas} vagas novas · ${fila} entraram na fila\n`);
  await repo.encerrar();
}

main().catch((e) => { console.error('\nErro ao ler e-mails:', e.message, '\n'); process.exit(1); });
