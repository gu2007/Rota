// Abre o navegador do Rota para fazer login na Gupy uma vez; a sessão fica em dados/navegador.
// npm run gupy:login

const { abrirNavegador } = require('../src/navegador/navegador');

(async () => {
  const { contexto, pagina } = await abrirNavegador({ headless: false });
  await pagina.goto('https://login.gupy.io/candidates/signin');
  console.log('\n  Navegador aberto na tela de login da Gupy.');
  console.log('  1. Clique no botão "LinkedIn" e entre na sua conta do LinkedIn');
  console.log('     (marque "Manter conectado", se aparecer).');
  console.log('  2. Espere voltar para a Gupy e conferir que você está logado.');
  console.log('  3. FECHE a janela. O login do LinkedIn fica salvo no navegador do Rota,');
  console.log('     e o bot usa o botão "LinkedIn" da Gupy sempre que ela pedir login.\n');
  await new Promise((resolve) => contexto.on('close', resolve));
  await new Promise((r) => setTimeout(r, 300));
  console.log('  Pronto! Login do LinkedIn salvo no navegador do Rota e sessão da Gupy guardada (criptografada).\n');
})().catch((e) => {
  console.error('\nNão consegui abrir o navegador:', e.message);
  console.error('O Google Chrome está instalado? Se o navegador já estiver aberto por outro comando do Rota, feche-o antes.\n');
  process.exit(1);
});
