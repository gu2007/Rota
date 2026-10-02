// Seções repetidas do formulário ("Adicionar experiência", "Adicionar educação"):
// o Rota clica em Adicionar e preenche cada item com o que está no seu Perfil.

const { norm, escolherOpcao } = require('./respostas');

const MESES = [
  ['janeiro', 'january', 'jan'], ['fevereiro', 'february', 'fev', 'feb'], ['marco', 'march', 'mar'], ['abril', 'april', 'abr', 'apr'],
  ['maio', 'may', 'mai'], ['junho', 'june', 'jun'], ['julho', 'july', 'jul'], ['agosto', 'august', 'ago', 'aug'],
  ['setembro', 'september', 'set', 'sep', 'sept'], ['outubro', 'october', 'out', 'oct'], ['novembro', 'november', 'nov'], ['dezembro', 'december', 'dez', 'dec'],
];
const ATUAL = /atual|presente|present|hoje|cursando|em andamento|andamento|current|now|ate o momento/;

// "01/2021", "2021-01", "jan/2021", "janeiro de 2021", "2021", "atual"
function parseData(texto) {
  const t = norm(texto);
  if (!t) return { mes: null, ano: null, atual: false };
  if (ATUAL.test(t) && !/\d{4}/.test(t)) return { mes: null, ano: null, atual: true };
  const ano = Number((t.match(/(19|20)\d{2}/) || [])[0]) || null;
  let mes = null;
  const num = t.match(/(^|\D)(0?[1-9]|1[0-2])\s*[/.-]\s*(19|20)\d{2}/) || t.match(/(19|20)\d{2}\s*[/.-]\s*(0?[1-9]|1[0-2])(\D|$)/);
  if (num) mes = Number(/^(19|20)/.test(num[0].trim()) ? num[2] : num[2]);
  if (!mes) {
    const i = MESES.findIndex((nomes) => nomes.some((n) => new RegExp(`(^|[^a-z])${n}([^a-z]|$)`).test(t)));
    if (i >= 0) mes = i + 1;
  }
  return { mes, ano, atual: ATUAL.test(t) };
}

const doisDigitos = (n) => String(n).padStart(2, '0');

// Valor de uma data para um campo: lista de meses/anos, input type=month/date ou texto
function valorData(campo, data, parte) {
  if (!data.ano && !data.mes) return null;
  const opcoes = campo.opcoes || [];
  if (parte === 'mes') {
    if (!data.mes) return null;
    if (opcoes.length) {
      return opcoes.find((o) => MESES[data.mes - 1].includes(norm(o).replace(/[^a-z]/g, '')))
        || opcoes.find((o) => Number(norm(o)) === data.mes) || null;
    }
    return doisDigitos(data.mes);
  }
  if (parte === 'ano') {
    if (!data.ano) return null;
    return opcoes.length ? (opcoes.find((o) => norm(o) === String(data.ano)) || null) : String(data.ano);
  }
  const mm = doisDigitos(data.mes || 1);
  if (campo.html === 'month') return `${data.ano}-${mm}`;
  if (campo.html === 'date') return `${data.ano}-${mm}-01`;
  return data.mes ? `${mm}/${data.ano}` : String(data.ano);
}

// De qual parte do item o campo fala. Devolve { valor } ou null (deixa vazio)
function valorDoItem(campo, item, tipo, perfil = {}) {
  const r = norm(campo.rotulo).replace(/[\s*:]+$/, '');
  const inicio = parseData(item.inicio);
  const fim = parseData(item.fim);
  const atual = !item.fim || fim.atual;

  // "trabalho aqui atualmente" / "cursando"
  if (campo.tipo === 'checkbox') {
    return /atualmente|currently|current|presente|present|cursando|em andamento|ainda (trabalho|estudo)/.test(r) ? { valor: !!atual } : null;
  }
  const ehInicio = /inicio|start|from|desde|admissao|ingresso|(^|\s)de$/.test(r);
  const ehFim = /termino|fim\b|\bend\b|to date|(^|\s)(ate|para|to)$|conclus|saida|graduat|formatura|previsao/.test(r);
  if (ehInicio || ehFim) {
    const data = ehInicio ? inicio : fim;
    if (ehFim && atual) return null; // em andamento: fica vazio e a caixinha "atual" é marcada
    const parte = /(^|\s)(mes|month)(\s|$)/.test(r) ? 'mes' : /(^|\s)(ano|year)(\s|$)/.test(r) ? 'ano' : 'data';
    const v = valorData(campo, data, parte);
    return v ? { valor: v } : null;
  }
  if (/pais|country/.test(r)) {
    const v = (campo.opcoes || []).length ? escolherOpcao(campo.opcoes, 'Brasil') || escolherOpcao(campo.opcoes, 'Brazil') : 'Brasil';
    return v ? { valor: v } : null;
  }
  if (/cidade|city|localiza|location/.test(r)) return perfil.cidade ? { valor: String(perfil.cidade).split(',')[0].trim() } : null;

  if (tipo === 'experiencias') {
    if (/cargo|titulo|title|position|funcao|role|ocupacao/.test(r)) return item.cargo ? { valor: item.cargo } : null;
    if (/empresa|empregador|employer|company|organiza/.test(r)) return item.empresa ? { valor: item.empresa } : null;
    if (/descri|responsab|atividades|summary|duties|resumo/.test(r)) return item.descricao ? { valor: item.descricao } : null;
  } else {
    // grau antes de escola: "Degree" às vezes vem junto de "High School" nas opções
    if (/grau|degree|nivel|level|tipo de (curso|formacao)|escolaridade/.test(r) && item.nivel) {
      if (!(campo.opcoes || []).length) return { valor: item.nivel };
      const v = escolherOpcao(campo.opcoes, item.nivel);
      return v ? { valor: v } : { ia: true }; // nomes de grau variam muito: a IA escolhe
    }
    if (/institui|escola|school|universidade|faculdade|college|university/.test(r)) return item.instituicao ? { valor: item.instituicao } : null;
    if (/curso|major|area|field|principal|disciplina|programa|course/.test(r)) return item.curso ? { valor: item.curso } : null;
    if (/status|situacao/.test(r) && item.status) {
      const v = (campo.opcoes || []).length ? escolherOpcao(campo.opcoes, item.status) : item.status;
      return v ? { valor: v } : null;
    }
  }
  return null;
}

// Roda na página: marca os botões "Adicionar" de cada seção com data-rota-secao
function acharBotoesSecao() {
  const todos = (sel, raiz = document) => { const out = [...raiz.querySelectorAll(sel)]; for (const e of raiz.querySelectorAll('*')) if (e.shadowRoot) out.push(...todos(sel, e.shadowRoot)); return out; };
  const textoDe = (e) => {
    let t = (e.innerText || e.value || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    const host = !t && e.getRootNode && e.getRootNode().host;
    if (host) t = (host.innerText || '').replace(/\s+/g, ' ').trim();
    return t;
  };
  const EXP = /experi|emprego|trabalho|profission|work|employment|job|position/i;
  const EDU = /educa|forma[cç]|escola|escolar|acad[eê]m|school|education|degree|estudo/i;
  const ADD = /^(\+\s*)?(adicionar|adicione|add|incluir|nova|novo|\+)(\s|$)/i;
  todos('[data-rota-secao]').forEach((e) => e.removeAttribute('data-rota-secao'));
  const achados = [];
  for (const b of todos('button, a, [role=button]')) {
    const r = b.getBoundingClientRect();
    if (!r.width || !r.height || b.disabled) continue;
    const texto = textoDe(b);
    if (!ADD.test(texto) || texto.length > 50) continue;
    let tipo = EXP.test(texto) ? 'experiencias' : EDU.test(texto) ? 'formacoes' : null;
    // "Adicionar" sozinho: a seção é o título logo acima
    for (let p = b.parentElement || b.getRootNode().host, i = 0; !tipo && p && i < 5; i++, p = p.parentElement || (p.getRootNode && p.getRootNode().host)) {
      const cabeca = (p.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      tipo = EXP.test(cabeca) ? 'experiencias' : EDU.test(cabeca) ? 'formacoes' : null;
    }
    if (!tipo || achados.some((a) => a.tipo === tipo)) continue;
    b.setAttribute('data-rota-secao', tipo);
    achados.push({ tipo, texto });
  }
  return achados;
}

// Roda na página: marca todos os campos que já existem, para achar os que surgirem depois
function marcarCamposVelhos() {
  const todos = (sel, raiz = document) => { const out = [...raiz.querySelectorAll(sel)]; for (const e of raiz.querySelectorAll('*')) if (e.shadowRoot) out.push(...todos(sel, e.shadowRoot)); return out; };
  todos('input, textarea, select, [role=combobox], [role=checkbox], [role=radio], button, [role=button]').forEach((e) => e.setAttribute('data-rota-velho', '1'));
}

// Roda na página: o botão que confirma o item recém-aberto (só entre os botões que surgiram)
function acharSalvarItem() {
  const todos = (sel, raiz = document) => { const out = [...raiz.querySelectorAll(sel)]; for (const e of raiz.querySelectorAll('*')) if (e.shadowRoot) out.push(...todos(sel, e.shadowRoot)); return out; };
  const SALVAR = /^(salvar|save|adicionar|add|concluir|done|ok|confirmar|confirm|salvar e fechar|save and close|aplicar|apply changes)$/i;
  todos('[data-rota-salvar]').forEach((e) => e.removeAttribute('data-rota-salvar'));
  for (const b of todos('button, [role=button]')) {
    if (b.hasAttribute('data-rota-velho') || b.hasAttribute('data-rota-secao') || b.disabled) continue;
    const r = b.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    let t = (b.innerText || b.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    const host = !t && b.getRootNode && b.getRootNode().host;
    if (host) t = (host.innerText || '').replace(/\s+/g, ' ').trim();
    if (SALVAR.test(t)) { b.setAttribute('data-rota-salvar', '1'); return t; }
  }
  return null;
}

// Roda na página: dos ids lidos, quais são campos novos
function idsNovos(ids) {
  const todos = (sel, raiz = document) => { const out = [...raiz.querySelectorAll(sel)]; for (const e of raiz.querySelectorAll('*')) if (e.shadowRoot) out.push(...todos(sel, e.shadowRoot)); return out; };
  return ids.filter((id) => { const e = todos(`[data-rota="${id}"]`)[0]; return e && !e.hasAttribute('data-rota-velho'); });
}

module.exports = { parseData, valorData, valorDoItem, acharBotoesSecao, marcarCamposVelhos, idsNovos, acharSalvarItem, MESES };
