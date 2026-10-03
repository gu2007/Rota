// Piloto do agente de IA: pega vagas em que o Rota travou e tenta de novo, no MODO TESTE (nada é enviado).
// Primeiro as regras; se travarem, o agente de IA. No fim mostra o placar.
//   npm run piloto            -> as 10 travadas mais recentes
//   npm run piloto 5          -> 5 vagas
//   npm run piloto 244 349    -> essas vagas (pelo número)
const fs = require('fs');
const path = require('path');
const { ambiente, lerConfiguracoes } = require('../src/config');
const { LISTAS } = require('../src/db/modelo');
const modulos = require('../src/plataformas');
const ia = require('../src/ia/gemini');

const PLATAFORMAS = ['sites', 'gupy', 'infojobs'];
const NAO_ADIANTA = /anti-rob|captcha|já se candidatou|descartada|não é de tecnologia/i;

async function main() {
  const repo = require('../src/db').repo();
  await repo.iniciar(ambiente.banco);
  const log = async (nivel, origem, msg) => { if (origem === 'agente') console.log(`      [agente] ${msg}`); await repo.eventos.registrar(nivel, origem, msg).catch(() => {}); };
  const config = { ...lerConfiguracoes(await repo.config.obter()), modoTeste: true };
  const listas = {};
  for (const nome of Object.keys(LISTAS)) listas[nome] = await repo.listas.listar(nome);
  const ctx = { config, perfil: await repo.perfil.obter(), listas, pessoais: await repo.pessoais.obterTodos(), respostasFixas: await repo.respostas.listar(), respondidas: await repo.perguntas.respondidas(), log, repo };

  console.log('\n=== Rota · piloto do agente de IA (modo teste: NADA é enviado) ===\n');
  if (!ia.disponivel()) { console.log('  Precisa da GEMINI_API_KEY no .env.\n'); return repo.encerrar(); }

  const args = process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number);
  let vagas;
  if (args.length > 1 || (args.length === 1 && args[0] > 50)) {
    vagas = [];
    for (const id of args) { const v = await repo.vagas.obter(id); if (v) vagas.push(v); }
  } else {
    const quantas = args[0] || 10;
    const travadas = [];
    for (const status of ['erro', 'pulada', 'para_voce', 'aguardando']) travadas.push(...await repo.vagas.listar({ status, limite: 500 }));
    vagas = travadas
      .filter((v) => PLATAFORMAS.includes(v.plataforma_envio) && !NAO_ADIANTA.test(v.motivo_status || ''))
      .sort((a, b) => b.id - a.id)
      .slice(0, quantas);
  }
  if (!vagas.length) { console.log('  Nenhuma vaga travada para testar.\n'); return repo.encerrar(); }
  console.log(`  ${vagas.length} vagas. O Chrome vai abrir: não mexa nele.\n`);

  const placar = { regras: 0, agente: 0, voce: 0 };
  const relatorio = [];
  for (const [i, resumo] of vagas.entries()) {
    const vaga = await repo.vagas.obter(resumo.id);
    console.log(`  ${i + 1}/${vagas.length}  #${vaga.id} ${vaga.titulo} — ${vaga.empresa || ''}`);
    console.log(`      antes: ${String(vaga.motivo_status || vaga.status).slice(0, 150)}`);
    let r;
    try {
      r = await modulos[vaga.plataforma_envio].candidatar(vaga, ctx, {});
    } catch (e) {
      r = { resultado: 'erro', motivo: e.message.split('\n')[0] };
    }
    const ok = ['simulada', 'enviada'].includes(r.resultado);
    const quem = ok ? (r.resolvidoPor === 'agente' ? 'agente' : 'regras') : 'voce';
    placar[quem]++;
    console.log(`      agora: ${ok ? (quem === 'agente' ? 'CONCLUIU (agente de IA)' : 'CONCLUIU (regras)') : 'PRECISA DE VOCÊ'} — ${String(r.motivo || '').slice(0, 220)}\n`);
    if (ok) await repo.vagas.atualizar(vaga.id, { status: 'testada', motivo_status: r.motivo });
    relatorio.push({ id: vaga.id, titulo: vaga.titulo, empresa: vaga.empresa, antes: vaga.motivo_status, resultado: r.resultado, quem, motivo: r.motivo, pasta: r.pasta });
  }

  const pasta = path.join(__dirname, '..', 'dados', 'piloto');
  fs.mkdirSync(pasta, { recursive: true });
  const arquivo = path.join(pasta, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(arquivo, JSON.stringify({ placar, relatorio }, null, 2));
  console.log('  ===== PLACAR =====');
  console.log(`  Concluídas só pelas regras:     ${placar.regras}`);
  console.log(`  Concluídas pelo agente de IA:   ${placar.agente}`);
  console.log(`  Ainda precisam de você:         ${placar.voce}`);
  console.log(`\n  Relatório: ${arquivo}\n`);
  await repo.encerrar();
}

main().catch((e) => { console.error('\nErro no piloto:', e.message, '\n'); process.exit(1); });
