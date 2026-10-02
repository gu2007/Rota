// Quando o robô trava, você termina a candidatura na mesma janela e ele observa:
// guarda as respostas que você deu e os botões que clicou, para fazer sozinho da próxima vez.
// Funciona com shadow DOM (lê os campos com o mesmo leitor do robô, não com eventos).

const { lerCampos } = require('./leitor-pagina');
const aprendizado = require('./aprendizado');
const { mascarar } = require('../navegador/gravador');
const { detectarPessoal } = require('./respostas');

const SUCESSO = /candidatura (enviada|realizada|conclu[ií]da|finalizada)|parab[eé]ns|inscri[cç][aã]o (realizada|conclu[ií]da)|application (submitted|received|sent)|thank you for applying|obrigad[oa] (por|pela) (se candidatar|candidatura|sua candidatura)/i;

// Roda dentro da página: avisa cada clique em botão, atravessando shadow DOM
function scriptCliques() {
  if (window.__rotaObservando) return;
  window.__rotaObservando = true;
  document.addEventListener('click', (e) => {
    const el = e.composedPath().find((n) => n.matches && n.matches('button, a, [role=button], input[type=submit]'));
    if (!el) return;
    let texto = (el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    if (!texto) {
      const host = el.getRootNode && el.getRootNode().host;
      texto = ((host && host.innerText) || '').replace(/\s+/g, ' ').trim();
    }
    const emAviso = !!el.closest('[role=dialog], [aria-modal=true], [class*=cookie i], [id*=cookie i], [class*=onetrust i]');
    // lido aqui, antes de o clique mudar a página
    const sucessoAntes = /candidatura (enviada|realizada|conclu[ií]da|finalizada)|parab[eé]ns|application (submitted|received)|thank you for applying/i.test(document.body?.innerText || '');
    window.rotaObservar({
      tipo: 'clique', tag: el.tagName.toLowerCase(), texto: texto.slice(0, 80), aviso: emAviso, url: location.href, sucessoAntes,
      cabecalhos: [...document.querySelectorAll('h1, h2, h3')].map((h) => h.innerText.trim()).filter(Boolean).slice(0, 4),
    });
  }, true);
}

const TIPO_GRAVADOR = { texto: 'text', textarea: 'textarea', select: 'select', combobox: 'select', radio: 'radio', caixinhas: 'radio', checkbox: 'checkbox' };
const chaveDe = (c) => aprendizado.chavePergunta(c.rotulo);
const vazio = (v) => v == null || v === '' || v === false;

async function lerValores(pagina) {
  const campos = await pagina.evaluate(lerCampos).catch(() => []);
  return campos.filter((c) => c.rotulo && c.tipo !== 'arquivo' && !c.autopreencher);
}

// Devolve { respostas, botoes, pessoais } e já salva o aprendizado
async function observar(contexto, pagina, { log = console.log, salvarPessoais } = {}) {
  const eventos = [];
  const iniciais = new Map(); // o que já estava na tela quando você assumiu
  const finais = new Map();   // último valor visto de cada pergunta

  for (const c of await lerValores(pagina)) iniciais.set(chaveDe(c), c.valor);

  await contexto.exposeBinding('rotaObservar', async ({ page }, ev) => {
    const evento = { ...ev, em: new Date().toISOString() };
    eventos.push(evento);
    if (!ev.aviso) log(`   você clicou: "${ev.texto}"`);
    // antes de sair da página, guarda o que estava preenchido
    for (const c of await lerValores(page)) if (!vazio(c.valor)) finais.set(chaveDe(c), c);
    setTimeout(async () => {
      try {
        const depois = await page.evaluate(() => ({
          url: location.href,
          texto: (document.body?.innerText || '').slice(0, 3000),
          cabecalhos: [...document.querySelectorAll('h1, h2, h3')].map((h) => h.innerText.trim()).filter(Boolean).slice(0, 4),
        }));
        evento.depois = {
          url: depois.url,
          mudouPagina: depois.url !== evento.url || JSON.stringify(depois.cabecalhos) !== JSON.stringify(evento.cabecalhos),
          sucesso: SUCESSO.test(depois.texto),
        };
      } catch { /* página fechada ou trocando */ }
    }, 3000);
  }).catch(() => {});
  await contexto.addInitScript(scriptCliques).catch(() => {});
  for (const p of contexto.pages()) await p.evaluate(scriptCliques).catch(() => {});

  // de tempos em tempos lê os campos (o evento "change" não atravessa componentes)
  let aberto = true;
  contexto.on('close', () => { aberto = false; });
  const limite = Date.now() + 30 * 60 * 1000; // no máximo 30 minutos
  let enviada = false;
  while (aberto && Date.now() < limite) {
    for (const p of contexto.pages()) {
      for (const c of await lerValores(p)) if (!vazio(c.valor)) finais.set(chaveDe(c), c);
      if (!enviada && SUCESSO.test(await p.innerText('body').catch(() => ''))) {
        enviada = true;
        log('   Candidatura enviada por você. Pode fechar a janela.');
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  await new Promise((r) => setTimeout(r, 300));

  // Só o que você mudou vira lição
  const pessoais = {};
  for (const [chave, c] of finais) {
    if (iniciais.has(chave) && String(iniciais.get(chave)) === String(c.valor)) continue;
    const ev = mascarar({ tipo: 'campo', campo: TIPO_GRAVADOR[c.tipo] || 'text', pergunta: c.rotulo, valor: c.valor, url: '' });
    // dado pessoal (CPF, RG…) vai para o cofre criptografado, nunca para o arquivo de aprendizado
    const pessoal = detectarPessoal(c.rotulo);
    if (pessoal && typeof c.valor === 'string') { pessoais[pessoal] = c.valor; continue; }
    if (ev.sensivel) continue;
    eventos.push(ev);
  }
  const novo = aprendizado.aprender(eventos);
  if (salvarPessoais && Object.keys(pessoais).length) await salvarPessoais(pessoais);
  enviada = enviada || eventos.some((e) => e.depois?.sucesso);
  return { novo, pessoais: Object.keys(pessoais), enviada };
}

module.exports = { observar };
