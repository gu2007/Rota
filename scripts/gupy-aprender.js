// Modo aprender: você se candidata na vaga e o Rota grava os passos.
// npm run gupy:aprender -- <link da vaga>
// Atenção: a candidatura é real. Se clicar em finalizar, ela é enviada.

const fs = require('fs');
const path = require('path');
const { abrirNavegador } = require('../src/navegador/navegador');
const { gravar } = require('../src/navegador/gravador');
const { aprender, PASTA, ARQUIVO } = require('../src/candidatura/aprendizado');
const { detectarPessoal } = require('../src/candidatura/respostas');
const { ambiente } = require('../src/config');
const { DADOS_PESSOAIS } = require('../src/db/padroes');

(async () => {
  const link = process.argv[2];
  if (!link) {
    console.log('\n  Use: npm run gupy:aprender -- <link da vaga da Gupy>\n');
    process.exit(1);
  }

  const repo = require('../src/db').repo();
  await repo.iniciar(ambiente.banco);
  const paraCofre = {};

  const { contexto, pagina } = await abrirNavegador({ headless: false });
  const eventos = [];
  await gravar(contexto, (ev, valorOriginal) => {
    eventos.push(ev);
    // dados pessoais digitados vão criptografados para o banco, não para a gravação
    const pessoal = ev.tipo === 'campo' && ev.sensivel && ev.campo !== 'password' && detectarPessoal(ev.pergunta);
    if (pessoal && typeof valorOriginal === 'string' && valorOriginal.trim()) paraCofre[pessoal] = valorOriginal;
    if (ev.tipo === 'clique') console.log(`   clique: "${ev.texto}"${ev.aviso ? '  (aviso)' : ''}`);
    else console.log(`   campo:  ${ev.pergunta.slice(0, 60)} → ${ev.sensivel ? '(oculto)' : String(ev.valor).slice(0, 40)}`);
  });

  await pagina.goto(link);
  console.log('\n  MODO APRENDER ligado. Candidate-se normalmente na janela do Chrome.');
  console.log('  Feche avisos, preencha, avance as etapas. Quando terminar, FECHE a janela.\n');

  await new Promise((resolve) => contexto.on('close', resolve));
  await new Promise((r) => setTimeout(r, 500));

  fs.mkdirSync(PASTA, { recursive: true });
  const arquivoGravacao = path.join(PASTA, `gravacao-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(arquivoGravacao, JSON.stringify({ link, eventos }, null, 2));

  const novo = aprender(eventos);
  if (Object.keys(paraCofre).length) await repo.pessoais.salvar(paraCofre);
  await repo.encerrar();
  console.log('\n  === O que o Rota aprendeu ===');
  console.log(`  Botões de começar:  ${novo.botoesCandidatar.map((t) => `"${t}"`).join(', ') || '(nada novo)'}`);
  console.log(`  Botões de avançar:  ${novo.botoesAvancar.map((t) => `"${t}"`).join(', ') || '(nada novo)'}`);
  console.log(`  Botões de finalizar: ${novo.botoesFinal.map((t) => `"${t}"`).join(', ') || '(nada novo)'}`);
  console.log(`  Avisos fechados:    ${novo.botoesFechar.map((t) => `"${t}"`).join(', ') || '(nada novo)'}`);
  const respostas = Object.values(novo.respostas);
  console.log(`  Respostas objetivas: ${respostas.length ? '' : '(nada novo)'}`);
  for (const r of respostas) console.log(`     • ${r.pergunta.slice(0, 70)} → ${String(r.valor).slice(0, 40)}`);
  console.log(`  Textos (exemplos para a IA): ${(novo.textos || []).map((t) => `"${t.slice(0, 50)}"`).join(', ') || '(nada novo)'}`);
  const nomes = Object.keys(paraCofre).map((k) => DADOS_PESSOAIS.find((d) => d.chave === k)?.rotulo || k);
  console.log(`  Guardado no cofre (criptografado): ${nomes.join(', ') || '(nada)'}`);
  console.log(`\n  Gravação: ${arquivoGravacao}`);
  console.log(`  Aprendizado acumulado: ${ARQUIVO}\n`);
})().catch((e) => {
  console.error('\nErro no modo aprender:', e.message, '\n');
  process.exit(1);
});
