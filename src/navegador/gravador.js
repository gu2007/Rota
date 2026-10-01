// Gravador do modo aprender: script injetado nas páginas avisa o Node a cada clique e campo.
// Após cada clique, o Node espera 3s e anota o que mudou.

const SUCESSO = /candidatura (enviada|realizada|conclu[ií]da|finalizada)|parab[eé]ns|inscri[cç][aã]o (realizada|conclu[ií]da)/i;

// Roda dentro da página: precisa ser autossuficiente
function scriptGravador() {
  if (window.__rotaGravando) return;
  window.__rotaGravando = true;
  const limpar = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const ehContador = (t) => /^(m[aá]x(imo)?\.?\s*(de\s*)?[\d.]+\s*caracteres?|[\d.]+\s*\/\s*[\d.]+\s*caracteres?|[\d.]+\s*caracteres?( restantes)?|\(?opcional\)?)$/i.test(t);
  const linhas = (el) => String(el?.innerText || '').split('\n').map(limpar).filter((l) => l && !ehContador(l));
  const cabecalhos = () => [...document.querySelectorAll('h1, h2, h3')].map((h) => limpar(h.innerText)).filter(Boolean).slice(0, 4);

  // Modal, pop-up ou banner de cookies por cima da página
  const emAviso = (el) => {
    if (el.closest('[role=dialog], [role=alertdialog], [aria-modal=true], [class*=modal i], [class*=dialog i], [class*=popup i], [class*=toast i], [class*=cookie i], [id*=cookie i], [class*=onetrust i], [class*=snackbar i]')) return true;
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      if (getComputedStyle(p).position === 'fixed') return true;
    }
    return false;
  };

  function rotulo(el) {
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l && limpar(l.innerText)) return limpar(l.innerText);
    }
    if (el.getAttribute('aria-label')) return limpar(el.getAttribute('aria-label'));
    const fs = el.closest('fieldset');
    if (fs?.querySelector('legend')) return limpar(fs.querySelector('legend').innerText);
    const grupo = el.closest('[role=radiogroup]');
    if (grupo?.getAttribute('aria-label')) return limpar(grupo.getAttribute('aria-label'));
    let p = el.parentElement;
    for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
      const l = linhas(p)[0];
      if (l && l.length < 300) return l;
    }
    return limpar(el.getAttribute('placeholder') || el.name || '');
  }

  function perguntaDoRadio(el) {
    const fs = el.closest('fieldset');
    if (fs?.querySelector('legend')) return limpar(fs.querySelector('legend').innerText);
    // Textos das opções do grupo nunca são a pergunta
    const grupo = el.name ? [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)] : [el];
    const opcoes = new Set(grupo.map((r) => limpar(r.closest('label')?.innerText || rotulo(r))));
    let c = el.parentElement;
    for (let i = 0; i < 6 && c; i++, c = c.parentElement) {
      const l = linhas(c).filter((x) => !opcoes.has(x) && !/^(sim|n[aã]o)$/i.test(x));
      if (l.length) return l[0];
    }
    return '';
  }

  document.addEventListener('click', (e) => {
    // Componente customizado (não é <input>): vira um campo
    const escolha = e.target.closest('[role=radio], [role=checkbox], [role=option]');
    if (escolha) {
      const role = escolha.getAttribute('role');
      const dono = role === 'option'
        ? document.querySelector('[role=combobox][aria-expanded=true]')
        : escolha.closest('[role=radiogroup], [role=group], fieldset');
      window.rotaRegistrar({
        tipo: 'campo', campo: role === 'option' ? 'select' : role,
        pergunta: dono ? rotulo(dono) : '', valor: role === 'checkbox' ? escolha.getAttribute('aria-checked') !== 'true' : limpar(escolha.innerText),
        url: location.href,
      });
      return;
    }
    const el = e.target.closest('button, a, [role=button], [role=tab], input[type=submit]');
    if (!el) return;
    window.rotaRegistrar({
      tipo: 'clique',
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      texto: limpar(el.innerText || el.value || el.getAttribute('aria-label')).slice(0, 80),
      aria: el.getAttribute('aria-label'),
      aviso: emAviso(el),
      url: location.href,
      cabecalhos: cabecalhos(),
      sucessoAntes: /candidatura (enviada|realizada|conclu[ií]da|finalizada)|parab[eé]ns|inscri[cç][aã]o (realizada|conclu[ií]da)/i.test(document.body?.innerText || ''),
    });
  }, true);

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el.matches || !el.matches('input, select, textarea')) return;
    const tipoInput = (el.getAttribute('type') || 'text').toLowerCase();
    let campo = tipoInput, pergunta = rotulo(el), valor = el.value;
    if (el.tagName === 'SELECT') { campo = 'select'; valor = limpar(el.options[el.selectedIndex]?.text); }
    else if (el.tagName === 'TEXTAREA') { campo = 'textarea'; }
    else if (tipoInput === 'radio') { pergunta = perguntaDoRadio(el); valor = limpar(el.closest('label')?.innerText) || rotulo(el); }
    else if (tipoInput === 'checkbox') {
      // Várias caixinhas juntas, sem outros campos: pergunta de escolha
      let lista = null;
      for (let p = el.parentElement, i = 0; p && i < 6 && !lista; p = p.parentElement, i++) {
        const dentro = p.querySelectorAll('input[type=checkbox]');
        if (dentro.length > 1) lista = p.querySelectorAll('input:not([type=checkbox]):not([type=hidden]), select, textarea').length ? 'nao' : p;
      }
      if (lista && lista !== 'nao' && el.checked) {
        const opcoes = new Set([...lista.querySelectorAll('input[type=checkbox]')].map((c) => limpar(c.closest('label')?.innerText || rotulo(c))));
        const fs = el.closest('fieldset');
        campo = 'radio';
        valor = limpar(el.closest('label')?.innerText || rotulo(el));
        pergunta = fs?.querySelector('legend') ? limpar(fs.querySelector('legend').innerText) : '';
        for (let c = lista, i = 0; c && i < 3 && !pergunta; c = c.parentElement, i++) pergunta = linhas(c).find((l) => !opcoes.has(l)) || '';
      } else {
        valor = el.checked;
      }
    }
    else if (tipoInput === 'file') { valor = '(arquivo)'; }
    window.rotaRegistrar({ tipo: 'campo', campo, pergunta, valor, url: location.href });
  }, true);
}

// Dados pessoais: nunca vão para o arquivo de aprendizado
const SENSIVEL = /remunera[cç][aã]o atual|[uú]ltima remunera|recebida|nacionalidade|estado civil|cpf|(^|[^a-z])rg([^a-z]|$)|senha|password|nascimento|telefone|celular|whats|e-?mail|endere[cç]o|cep|complemento|bairro|logradouro|m[aã]e|pai|documento|pis|conta|ag[eê]ncia|banco|sal[aá]rio atual/i;

function mascarar(ev) {
  if (ev.tipo !== 'campo') return ev;
  if (ev.campo === 'password' || SENSIVEL.test(ev.pergunta || '')) return { ...ev, valor: '(oculto)', sensivel: true };
  if (ev.campo === 'textarea' && typeof ev.valor === 'string') return { ...ev, valor: ev.valor.slice(0, 3000) };
  return ev;
}

// onEvento recebe cada evento já mascarado
async function gravar(contexto, onEvento) {
  await contexto.exposeBinding('rotaRegistrar', async ({ page }, ev) => {
    const evento = mascarar({ ...ev, em: new Date().toISOString() });
    // Valor original só para quem chamou (guarda cifrado), nunca para a gravação
    onEvento(evento, ev.valor);
    if (evento.tipo === 'clique' && !evento.aviso) {
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
            cabecalhos: depois.cabecalhos,
          };
        } catch { /* janela fechada ou página trocando */ }
      }, 3000);
    }
  });
  await contexto.addInitScript(scriptGravador);
  for (const p of contexto.pages()) await p.evaluate(scriptGravador).catch(() => {});
}

module.exports = { gravar, mascarar, SENSIVEL };
