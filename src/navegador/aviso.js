// Faixa no rodapé da página do site mostrando o que o Rota está fazendo:
//   'trabalhando' -> o robô está preenchendo: não mexa
//   'ajuda'       -> o robô parou e é a sua vez (ele só observa)
//   'enviada'     -> você enviou; pode fechar
// Não bloqueia cliques (pointer-events: none) e o leitor de campos ignora a faixa.

const TEXTOS = {
  trabalhando: { cor: '#1f6feb', texto: 'Rota preenchendo… não mexa nesta janela' },
  ajuda: { cor: '#d9480f', texto: '🙋 O Rota precisa da sua ajuda: complete o que falta e FECHE a janela quando terminar. Ele não mexe mais na tela.' },
  enviada: { cor: '#2f9e44', texto: '✅ Candidatura enviada. Pode fechar a janela.' },
};

function mostrarNaPagina({ cor, texto, grande }) {
  let el = document.getElementById('rota-aviso');
  if (!el) {
    el = document.createElement('div');
    el.id = 'rota-aviso';
    el.setAttribute('data-rota-ignorar', '1');
    el.setAttribute('aria-hidden', 'true');
    (document.body || document.documentElement).appendChild(el);
  }
  el.textContent = texto;
  el.style.cssText = `position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:2147483647;pointer-events:none;
    background:${cor};color:#fff;font:600 ${grande ? 18 : 13}px/1.35 system-ui,sans-serif;padding:${grande ? '14px 22px' : '6px 14px'};
    border-radius:10px;box-shadow:0 4px 18px rgba(0,0,0,.25);max-width:92vw;text-align:center`;
  const prefixo = grande ? '🙋 AJUDA · ' : '';
  if (!document.title.startsWith('🙋')) document.title = prefixo + document.title.replace(/^🙋 AJUDA · /, '');
}

async function avisar(pagina, tipo) {
  const t = TEXTOS[tipo];
  if (!pagina || !t) return;
  await pagina.evaluate(mostrarNaPagina, { ...t, grande: tipo !== 'trabalhando' }).catch(() => {});
}

module.exports = { avisar };
