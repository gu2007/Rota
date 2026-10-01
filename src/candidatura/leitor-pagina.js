// Funções executadas dentro da página via page.evaluate: precisam ser autossuficientes.
// lerCampos marca cada campo com data-rota="N" para o Node achar e preencher depois.
function lerCampos() {
  // Inclui shadow DOM (ex.: SmartRecruiters)
  const todos = (sel, raiz = document) => { const out = [...raiz.querySelectorAll(sel)]; for (const e of raiz.querySelectorAll('*')) if (e.shadowRoot) out.push(...todos(sel, e.shadowRoot)); return out; };
  const visivel = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };
  const limpar = (t) => String(t || '').replace(/[\u200b\u00a0]/g, ' ').replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim();
  const textoDe = (el) => limpar(el?.innerText || el?.textContent || '');
  // Contadores de caracteres e "(Opcional)" não são a pergunta
  const ehContador = (t) => /^(m[aá]x(imo)?\.?\s*(de\s*)?[\d.]+\s*caracteres?|[\d.]+\s*\/\s*[\d.]+\s*caracteres?|[\d.]+\s*caracteres?( restantes)?|\(?opcional\)?)$/i.test(t);
  const linhasDe = (el) => String(el?.innerText || '').split(/\n/).map(limpar).filter((l) => l && !ehContador(l));

  // maxlength ou o contador escrito perto ("Máx. 1000 caracteres", "até 200 palavras")
  function limiteDe(el) {
    let limite = el.maxLength > 0 && el.maxLength < 100000 ? el.maxLength : null;
    let limitePalavras = null;
    const num = (t) => Number(String(t).replace(/\./g, ''));
    let alvo = el.parentElement;
    for (let i = 0; i < 4 && alvo; i++, alvo = alvo.parentElement) {
      const texto = (alvo.innerText || '').slice(0, 600);
      const c = texto.match(/(?:m[aá]x(?:imo)?\.?\s*(?:de\s*)?|at[eé]\s*|\/\s*|limite de\s*)([\d.]{2,6})\s*(caracteres|characters|chars)/i)
        || texto.match(/([\d.]{2,6})\s*(caracteres|characters|chars)\s*(no m[aá]ximo|max)/i);
      const p = texto.match(/(?:m[aá]x(?:imo)?\.?\s*(?:de\s*)?|at[eé]\s*|\/\s*|limite de\s*)([\d.]{1,5})\s*(palavras|words)/i);
      if (c && !limite) limite = num(c[1]);
      if (p && !limitePalavras) limitePalavras = num(p[1]);
      if (limite || limitePalavras) break;
    }
    return { limite, limitePalavras };
  }

  function rotulo(el) {
    if (el.id) {
      const raiz = el.getRootNode && el.getRootNode().querySelector ? el.getRootNode() : document;
      const l = raiz.querySelector(`label[for="${CSS.escape(el.id)}"]`) || document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l && textoDe(l)) return textoDe(l);
    }
    const porId = el.getAttribute('aria-labelledby');
    if (porId) {
      // Sem o próprio elemento: numa lista ele mostra o valor atual ("Selecione")
      const t = porId.split(/\s+/).filter((id) => id !== el.id).map((id) => textoDe((el.getRootNode().getElementById ? el.getRootNode().getElementById(id) : null) || document.getElementById(id))).join(' ').trim();
      if (t) return t;
    }
    if (el.getAttribute('aria-label')) return limpar(el.getAttribute('aria-label'));
    const pai = el.closest('label');
    if (pai && textoDe(pai)) return textoDe(pai);
    const fs = el.closest('fieldset');
    if (fs?.querySelector('legend')) return textoDe(fs.querySelector('legend'));
    let p = el.parentElement;
    for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
      const primeiro = linhasDe(p)[0];
      if (primeiro && primeiro.length < 300) return primeiro;
    }
    const host = el.getRootNode && el.getRootNode().host;
    const doHost = host && (host.getAttribute('label') || host.getAttribute('aria-label') || host.getAttribute('placeholder'));
    if (doHost) return limpar(doHost);
    return limpar(el.getAttribute('placeholder') || el.name || '');
  }

  const obrigatorio = (el, texto) =>
    el.required || el.getAttribute('aria-required') === 'true' || /\*\s*$/.test(texto || '')
    // Listas customizadas guardam o required num input escondido
    || (el.tagName !== 'INPUT' && !!el.parentElement?.querySelector('input[required], input[aria-required=true]'));

  // Sites de página única reaproveitam o HTML: limpa marcas da etapa anterior
  todos('[data-rota]').forEach((el) => el.removeAttribute('data-rota'));

  const campos = [];
  let n = 0;
  const marcar = (el) => { const id = String(n++); el.setAttribute('data-rota', id); return id; };
  const usados = new Set();

  // Rádios nativos, agrupados por name
  const grupos = {};
  todos('input[type=radio]').forEach((r) => {
    if (!visivel(r) && !visivel(r.closest('label') || r)) return;
    (grupos[r.name || r.id] ||= []).push(r);
  });
  for (const radios of Object.values(grupos)) {
    radios.forEach((r) => usados.add(r));
    const fs = radios[0].closest('fieldset');
    let pergunta = fs?.querySelector('legend') ? textoDe(fs.querySelector('legend')) : '';
    if (!pergunta) {
      let c = radios[0].parentElement;
      while (c && !radios.every((r) => c.contains(r))) c = c.parentElement;
      const opcoesTxt = radios.map((r) => rotulo(r));
      let alvo = c;
      for (let i = 0; i < 3 && alvo; i++, alvo = alvo.parentElement) {
        const linhas = linhasDe(alvo).filter((l) => !opcoesTxt.includes(l));
        if (linhas.length) { pergunta = linhas[0]; break; }
      }
    }
    const opcoes = radios.map((r) => ({ id: marcar(r), texto: rotulo(r) }));
    campos.push({
      id: opcoes[0].id, tipo: 'radio', rotulo: pergunta, opcoes: opcoes.map((o) => o.texto), idsOpcoes: opcoes.map((o) => o.id),
      obrigatorio: radios.some((r) => r.required) || /\*/.test(pergunta), preenchido: radios.some((r) => r.checked),
    });
  }

  // Radiogroup ARIA (ex.: Material UI)
  todos('[role=radiogroup]').forEach((g) => {
    if (!visivel(g)) return;
    const radios = [...g.querySelectorAll('[role=radio]')].filter((r) => !usados.has(r));
    if (!radios.length) return;
    radios.forEach((r) => usados.add(r));
    const pergunta = rotulo(g);
    const opcoes = radios.map((r) => ({ id: marcar(r), texto: rotulo(r) || textoDe(r) }));
    campos.push({
      id: opcoes[0].id, tipo: 'radio', rotulo: pergunta, opcoes: opcoes.map((o) => o.texto), idsOpcoes: opcoes.map((o) => o.id),
      obrigatorio: g.getAttribute('aria-required') === 'true' || /\*/.test(pergunta),
      preenchido: radios.some((r) => r.getAttribute('aria-checked') === 'true'),
    });
  });

  // Várias caixinhas juntas, sem outros campos no meio, são uma pergunta de escolha.
  // A caixinha real às vezes fica invisível, por isso olha também o label.
  const caixinhas = [...todos('input[type=checkbox], [role=checkbox]')]
    .filter((c) => !usados.has(c) && !c.disabled && (visivel(c) || visivel(c.closest('label') || c)));
  const grupoDe = (c) => {
    if (c.name && caixinhas.filter((o) => o.name === c.name).length > 1) return caixinhas.filter((o) => o.name === c.name);
    // Menor contêiner com 2+ caixinhas e nenhum outro tipo de campo
    for (let p = c.parentElement, i = 0; p && i < 6; p = p.parentElement, i++) {
      const dentro = caixinhas.filter((o) => p.contains(o));
      if (dentro.length > 1) {
        const outros = p.querySelectorAll('input:not([type=checkbox]):not([type=hidden]), select, textarea, [role=combobox], [role=radio]');
        return outros.length ? null : dentro;
      }
    }
    return null;
  };
  const jaAgrupadas = new Set();
  for (const c of caixinhas) {
    if (jaAgrupadas.has(c)) continue;
    const grupo = grupoDe(c);
    if (!grupo) continue;
    grupo.forEach((g) => { jaAgrupadas.add(g); usados.add(g); });
    const textoOpcao = (g) => limpar(g.closest('label')?.innerText || g.getAttribute('aria-label') || (g.tagName !== 'INPUT' ? g.innerText : '') || rotulo(g));
    const opcoesTxt = grupo.map(textoOpcao);
    const fs = grupo[0].closest('fieldset');
    let pergunta = fs?.querySelector('legend') ? textoDe(fs.querySelector('legend')) : (grupo[0].closest('[role=group]')?.getAttribute('aria-label') || '');
    if (!pergunta) {
      let cont = grupo[0].parentElement;
      while (cont && !grupo.every((g) => cont.contains(g))) cont = cont.parentElement;
      for (let i = 0; i < 3 && cont && !pergunta; i++, cont = cont.parentElement) {
        pergunta = linhasDe(cont).find((l) => !opcoesTxt.includes(l)) || '';
      }
    }
    const opcoes = grupo.map((g) => ({ id: marcar(g), texto: textoOpcao(g) }));
    campos.push({
      id: opcoes[0].id, tipo: 'caixinhas', rotulo: pergunta, opcoes: opcoes.map((o) => o.texto), idsOpcoes: opcoes.map((o) => o.id),
      obrigatorio: grupo.some((g) => g.required || g.getAttribute('aria-required') === 'true') || /\*/.test(pergunta),
      preenchido: grupo.some((g) => g.checked || g.getAttribute('aria-checked') === 'true'),
    });
  }

  // aria-haspopup=listbox: listas que abrem ao clicar (ex.: Gupy)
  const seletor = 'input:not([type=radio]):not([type=hidden]):not([type=submit]):not([type=button]), textarea, select, [role=combobox], [aria-haspopup=listbox]:not(button):not(a)';
  todos(seletor).forEach((el) => {
    if (usados.has(el) || el.disabled || el.readOnly) return;
    const tipoInput = (el.getAttribute('type') || '').toLowerCase();
    // Input de arquivo costuma ficar escondido atrás de um botão
    if (tipoInput !== 'file' && !visivel(el)) return;
    if (el.closest('[data-rota-ignorar], header, nav, footer')) return;
    if (el.getAttribute('role') === 'combobox' && el.tagName === 'INPUT' && el.getAttribute('aria-autocomplete') === 'none') return;

    const r = rotulo(el);
    let tipo = 'texto', opcoes = [], preenchido = false;
    if (el.tagName === 'TEXTAREA') { tipo = 'textarea'; preenchido = !!el.value.trim(); }
    else if (el.tagName === 'SELECT') {
      tipo = 'select';
      opcoes = [...el.options].filter((o) => o.value !== '' && !o.disabled).map((o) => limpar(o.textContent));
      preenchido = el.value !== '' && el.selectedIndex > 0;
    } else if ((el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox') && el.tagName !== 'INPUT') {
      // As opções só aparecem com a lista aberta; quem lê é o Node (lerOpcoesLista)
      tipo = 'combobox'; preenchido = !!textoDe(el) && !/^(selecione|escolha|select|choose)/i.test(textoDe(el));
    } else if (tipoInput === 'checkbox') { tipo = 'checkbox'; preenchido = el.checked; }
    else if (tipoInput === 'file') { tipo = 'arquivo'; preenchido = el.files?.length > 0; }
    else { preenchido = !!el.value.trim(); }

    campos.push({
      id: marcar(el), tipo, rotulo: r, opcoes, obrigatorio: obrigatorio(el, r), preenchido,
      ...limiteDe(el),
      html: tipoInput || null, // ajuda quando o rótulo é estranho (ex.: "BR+55")
      // Autocompletar: depois de digitar é preciso clicar numa sugestão
      autocompletar: el.tagName === 'INPUT' && tipoInput !== 'file' && (!!el.getAttribute('list') || el.getAttribute('role') === 'combobox'
        || ['list', 'both'].includes(el.getAttribute('aria-autocomplete')) || /autocomplete|typeahead|location|places/i.test(`${el.className} ${el.id} ${el.name}`)),
      aceita: tipoInput === 'file' ? (el.getAttribute('accept') || '') : undefined,
    });
  });

  return campos;
}

// Marca o botão encontrado com data-rota-botao
function acharBotao(fonteRegex) {
  const todos = (sel, raiz = document) => { const out = [...raiz.querySelectorAll(sel)]; for (const e of raiz.querySelectorAll('*')) if (e.shadowRoot) out.push(...todos(sel, e.shadowRoot)); return out; };
  const re = new RegExp(fonteRegex, 'i');
  const candidatos = todos('button, a, [role=button], input[type=submit]');
  for (const el of candidatos) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
    const texto = (el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    if (texto && texto.length <= 40 && re.test(texto)) {
      el.setAttribute('data-rota-botao', '1');
      return texto;
    }
  }
  return null;
}

// Só desafios visíveis (ignora o reCAPTCHA v3 invisível)
function temDesafio() {
  const todos = (sel, raiz = document) => { const out = [...raiz.querySelectorAll(sel)]; for (const e of raiz.querySelectorAll('*')) if (e.shadowRoot) out.push(...todos(sel, e.shadowRoot)); return out; };
  for (const f of todos('iframe')) {
    const src = f.src || '';
    if (!/recaptcha|hcaptcha|turnstile|challenges\.cloudflare/i.test(src)) continue;
    if (/size=invisible/i.test(src)) continue;
    const r = f.getBoundingClientRect();
    if (r.width > 60 && r.height > 60) return src.split('?')[0];
  }
  const texto = document.body?.innerText || '';
  if (/verifique que voc[eê] [ée] humano|verify you are human|n[aã]o sou um rob[oô]|i'?m not a robot/i.test(texto)) return 'texto de verificação na página';
  return null;
}

// Botão desativado costuma indicar campo obrigatório faltando
function botaoDesativado(fonteRegex) {
  const todos = (sel, raiz = document) => { const out = [...raiz.querySelectorAll(sel)]; for (const e of raiz.querySelectorAll('*')) if (e.shadowRoot) out.push(...todos(sel, e.shadowRoot)); return out; };
  const re = new RegExp(fonteRegex, 'i');
  for (const el of todos('button, a, [role=button], input[type=submit]')) {
    const r = el.getBoundingClientRect();
    const texto = (el.innerText || el.value || '').replace(/\s+/g, ' ').trim();
    const desativado = el.disabled || el.getAttribute('aria-disabled') === 'true';
    if (r.width && r.height && desativado && texto.length <= 40 && re.test(texto)) return texto;
  }
  return null;
}

module.exports = { lerCampos, acharBotao, temDesafio, botaoDesativado };
