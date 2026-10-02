// Painel do Rota em JS puro: cada página busca dados na API e devolve HTML.
// O roteador troca a página conforme o hash (#/hoje, #/vagas...).

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

// escapa o texto para que um título de vaga não vire HTML
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function api(metodo, caminho, corpo) {
  const resp = await fetch('/api' + caminho, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : {},
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  if (resp.status === 204) return null;
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(dados.erro || `Erro ${resp.status}`);
  return dados;
}

function avisar(texto, tipo = '') {
  const el = document.createElement('div');
  el.className = `aviso-toast ${tipo}`;
  el.textContent = texto;
  $('#avisos').append(el);
  setTimeout(() => el.remove(), 3500);
}

const hora = (d) => (d ? new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—');
const dataCurta = (d) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
const dataHora = (d) => `${dataCurta(d)}, ${hora(d)}`;

function emQuanto(d) {
  const min = Math.round((new Date(d) - Date.now()) / 60000);
  if (min <= 0) return 'agora';
  if (min < 60) return `em ${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return `em ${h}h${m ? String(m).padStart(2, '0') : ''}`;
}

function saudacao() {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

const NOMES_PLATAFORMA = {
  email: 'E-mail', linkedin: 'LinkedIn', google: 'Google', gupy: 'Gupy', gupy_portal: 'Portal Gupy',
  infojobs: 'InfoJobs', sites: 'Site da empresa', manual: 'Manual',
};
const nomePlataforma = (c) => NOMES_PLATAFORMA[c] || c || '—';

const STATUS_VAGA = {
  na_fila: ['Na fila', 'azul'], testada: ['Testada', 'amarelo'], candidatada: ['Candidatada', 'verde'],
  pulada: ['Pulada', ''], descartada: ['Descartada', ''], erro: ['Erro', 'vermelho'], nova: ['Nova', 'azul'],
  aguardando: ['Esperando você', 'amarelo'],
  para_voce: ['Para você', 'azul'],
};
const RESULTADO = {
  enviada: ['Enviada', 'verde'], simulada: ['Simulada', 'amarelo'], pulada: ['Pulada', ''],
  erro: ['Erro', 'vermelho'], captcha: ['CAPTCHA', 'vermelho'],
};
const ESTADO_PLATAFORMA = {
  ativa: ['Rodando', 'verde'], pausada: ['Pausada', 'vermelho'], limite: ['Limite do dia', 'amarelo'],
  encerrada: ['Encerrada hoje', ''], desligada: ['Desligada', ''],
};

const selo = ([texto, cor]) => `<span class="selo ${cor}">${esc(texto)}</span>`;
const notaHtml = (n) => (n == null ? '<span class="nota">—</span>' : `<span class="nota ${n >= 80 ? 'alta' : n >= 60 ? 'media' : ''}">${n}</span>`);

const TEMAS = ['auto', 'claro', 'escuro'];
function aplicarTema(t) {
  if (t === 'auto') document.documentElement.removeAttribute('data-tema');
  else document.documentElement.setAttribute('data-tema', t);
}
function temaAtual() {
  try { return localStorage.getItem('rota-tema') || 'auto'; } catch { return 'auto'; }
}
function trocarTema() {
  const proximo = TEMAS[(TEMAS.indexOf(temaAtual()) + 1) % TEMAS.length];
  try { localStorage.setItem('rota-tema', proximo); } catch {}
  aplicarTema(proximo);
  desenharRodape();
}
aplicarTema(temaAtual());

let infoSistema = null;
function atualizarContador(n) {
  const el = $('#contador-perguntas');
  if (!el) return;
  el.hidden = !n;
  el.textContent = n > 99 ? '99+' : String(n || '');
}
function desenharRodape() {
  const nomesTema = { auto: 'Tema: automático', claro: 'Tema: claro', escuro: 'Tema: escuro' };
  $('#rodape-lateral').innerHTML = `
    <button type="button" id="botao-tema">${nomesTema[temaAtual()]}</button>
    ${infoSistema ? `<span>Banco: ${esc(infoSistema.banco)}</span>` : ''}`;
  $('#botao-tema').onclick = trocarTema;
}

async function paginaHoje() {
  const [r, eventos] = await Promise.all([api('GET', '/resumo'), api('GET', '/eventos?limite=12')]);
  infoSistema = r;
  desenharRodape();
  atualizarContador(r.perguntasPendentes);

  const hojeTexto = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const proxima = r.proxima
    ? `Próxima parada: <b>${esc(nomePlataforma(r.proxima.plataforma))}</b> às <span class="mono">${hora(r.proxima.horario)}</span> (${emQuanto(r.proxima.horario)})`
    : 'Sem mais paradas hoje.';

  return `
    <div class="cabecalho">
      <div>
        <h1>${saudacao()}</h1>
        <p>${esc(hojeTexto[0].toUpperCase() + hojeTexto.slice(1))} · janela das <span class="mono">${esc(r.janela.inicio)}</span> às <span class="mono">${esc(r.janela.fim)}</span></p>
      </div>
      <button class="botao leve" data-acao="replanejar" title="Apaga os horários que ainda não rodaram e sorteia de novo">Sortear horários de novo</button>
    </div>

    ${r.demo ? `<div class="faixa-status"><strong>Modo demo</strong><span>Dados de exemplo com empresas fictícias. Nada é salvo. Configure o SQL Server no .env para usar de verdade.</span></div>` : ''}

    ${r.perguntasPendentes ? `<div class="faixa-status pergunta">
      <strong>${r.perguntasPendentes} pergunta${r.perguntasPendentes > 1 ? 's' : ''} para você</strong>
      <span>${(r.vagas.aguardando || 0)} vaga${r.vagas.aguardando === 1 ? '' : 's'} esperando. Responda uma vez e vale para todas as empresas.</span>
      <a class="botao pequeno acao" href="#/perguntas">Responder</a>
    </div>` : ''}

    ${r.vagas.para_voce ? `<div class="faixa-status pergunta">
      <strong>${r.vagas.para_voce} vaga${r.vagas.para_voce > 1 ? 's' : ''} para você</strong>
      <span>Candidatura simplificada do LinkedIn: leva 1 minuto pelo app. O bot não usa a sua conta do LinkedIn.</span>
      <a class="botao pequeno acao" href="#/vagas" data-ir-status="para_voce">Ver</a>
    </div>` : ''}

    <div class="faixa-status ${r.modoTeste ? '' : 'ao-vivo'}">
      <strong>${r.modoTeste ? 'Modo teste' : 'Ao vivo'}</strong>
      <span>${r.modoTeste ? 'Preenche os formulários, mas não clica em enviar.' : 'Candidaturas estão sendo enviadas.'} ${proxima}</span>
      <a class="botao pequeno leve acao" href="#/ajustes">Ajustes</a>
    </div>

    <div class="grade grade-4">
      <div class="cartao numero"><div class="rotulo">Candidaturas hoje</div><div class="valor">${r.candidaturas.hoje}</div></div>
      <div class="cartao numero"><div class="rotulo">Nesta semana</div><div class="valor">${r.candidaturas.semana}</div></div>
      <div class="cartao numero"><div class="rotulo">Vagas na fila</div><div class="valor">${r.vagas.na_fila || 0}</div></div>
      <div class="cartao numero"><div class="rotulo">Nota mínima</div><div class="valor">${r.notaMinima}<small>/100</small></div></div>
    </div>

    <section class="secao cartao">
      <h2>A rota de hoje</h2>
      ${desenharEstrada(r)}
    </section>

    <section class="secao">
      <h2>Plataformas</h2>
      <div class="grade grade-3">${r.plataformas.map(cartaoPlataforma).join('')}</div>
    </section>

    <section class="secao cartao">
      <h2>O que aconteceu</h2>
      ${eventos.length ? `<ul class="eventos">${eventos.map((e) => `
        <li class="${esc(e.nivel)}">
          <span class="quando">${hora(e.criado_em)}</span>
          <span class="origem">${esc(nomePlataforma(e.origem))}</span>
          <span class="msg">${esc(e.mensagem)}</span>
        </li>`).join('')}</ul>` : '<p class="vazio">Nada por enquanto.</p>'}
    </section>`;
}

// "estrada": uma pista por plataforma, cada ponto é um horário sorteado
function desenharEstrada(r) {
  const [hi, mi] = r.janela.inicio.split(':').map(Number);
  const [hf, mf] = r.janela.fim.split(':').map(Number);
  const base = new Date(); base.setHours(0, 0, 0, 0);
  const inicio = base.getTime() + (hi * 60 + mi) * 60000;
  const fim = base.getTime() + (hf * 60 + mf) * 60000;
  const pos = (t) => Math.max(0, Math.min(100, ((new Date(t).getTime() - inicio) / (fim - inicio)) * 100));

  const horas = [];
  for (let h = Math.ceil(hi + mi / 60); h <= hf; h += 2) horas.push(h);
  const agoraPct = pos(Date.now());
  const agoraDentro = Date.now() >= inicio && Date.now() <= fim;

  const linhas = r.plataformas.filter((p) => p.ativa).map((p) => {
    const itens = r.agenda.filter((a) => a.plataforma === p.codigo);
    const paradas = itens.map((a) => {
      const falha = a.status === 'executado' && ['erro', 'captcha'].includes(a.resultado);
      const titulo = `${hora(a.horario)} · ${a.status}${a.resultado ? ' · ' + a.resultado : ''}`;
      return `<span class="parada ${a.status} ${falha ? 'falha' : ''}" style="left:${pos(a.horario)}%" title="${esc(titulo)}"></span>`;
    }).join('');
    return `
      <div class="estrada-linha">
        <div class="nome">${esc(p.nome)} <em>${p.feitas}/${p.limite_diario}</em></div>
        <div class="pista">${paradas}${agoraDentro ? `<span class="agora-marca" style="left:${agoraPct}%"></span>` : ''}</div>
      </div>`;
  }).join('');

  return `
    <div class="estrada">
      <div class="estrada-escala"><span class="rotulo-vazio"></span>
        <div class="horas">${horas.map((h) => `<span style="left:${pos(base.getTime() + h * 3600000)}%">${String(h).padStart(2, '0')}h</span>`).join('')}</div>
      </div>
      ${linhas || '<p class="vazio">Nenhuma plataforma ativa.</p>'}
      <div class="estrada-legenda">
        <span><i class="executado"></i> feito</span>
        <span><i></i> agendado</span>
        <span><i class="ignorado"></i> ignorado (fila vazia, módulo pendente…)</span>
        <span><i class="perdido"></i> perdido (sistema desligado)</span>
        <span><i class="falha"></i> erro / CAPTCHA</span>
        <span><i class="agora"></i> agora</span>
      </div>
    </div>`;
}

function cartaoPlataforma(p) {
  const pct = p.limite_diario ? Math.min(100, (p.feitas / p.limite_diario) * 100) : 0;
  const tipo = p.tipo === 'coleta' ? 'Procura vagas' : 'Faz candidaturas';
  let rodape = p.proxima ? `próxima às <span class="mono">${hora(p.proxima)}</span>` : '';
  if (p.estado === 'pausada') rodape = esc(p.motivo_pausa || 'pausada');
  return `
    <div class="cartao plataforma">
      <div class="topo"><span class="titulo">${esc(p.nome)}</span>${selo(ESTADO_PLATAFORMA[p.estado])}</div>
      <div class="barra"><div style="width:${pct}%"></div></div>
      <div class="rodape"><span>${tipo} · <span class="mono">${p.feitas}/${p.limite_diario}</span></span><span>${rodape}</span></div>
    </div>`;
}

// vagas
const estadoVagas = { status: 'na_fila', q: '', adicionando: false };

async function paginaVagas() {
  const params = new URLSearchParams();
  if (estadoVagas.status) params.set('status', estadoVagas.status);
  if (estadoVagas.q) params.set('q', estadoVagas.q);
  const [vagas, resumo] = await Promise.all([api('GET', '/vagas?' + params), api('GET', '/resumo')]);
  const contagem = resumo.vagas;
  const total = Object.values(contagem).reduce((a, b) => a + b, 0);

  const abas = [['', 'Todas', total], ...['na_fila', 'para_voce', 'aguardando', 'testada', 'candidatada', 'pulada', 'descartada', 'erro']
    .map((s) => [s, STATUS_VAGA[s][0], contagem[s] || 0])]
    .filter(([s, , n]) => s === '' || s === 'na_fila' || n > 0);

  return `
    <div class="cabecalho">
      <div><h1>Vagas</h1><p>Tudo que o Rota encontrou, com a nota de compatibilidade. Só vagas com nota ${resumo.notaMinima}+ entram na fila.</p></div>
      <button class="botao destaque" data-acao="nova-vaga">Adicionar vaga</button>
    </div>

    ${estadoVagas.adicionando ? formNovaVaga() : ''}

    <div class="filtros">
      ${abas.map(([s, nome, n]) => `<button class="aba ${estadoVagas.status === s ? 'ativa' : ''}" data-status="${s}">${esc(nome)}<span class="qtd">${n}</span></button>`).join('')}
      <input class="busca" type="search" placeholder="Buscar por título ou empresa" value="${esc(estadoVagas.q)}" id="busca-vagas">
    </div>

    <div class="cartao">
      ${vagas.length ? `<div class="tabela-rolagem"><table class="tabela">
        <thead><tr><th>Nota</th><th>Vaga</th><th class="so-largo">Caminho</th><th>Situação</th><th></th></tr></thead>
        <tbody>${vagas.map(linhaVaga).join('')}</tbody>
      </table></div>` : '<p class="vazio">Nenhuma vaga aqui.</p>'}
    </div>`;
}

function linhaVaga(v) {
  const detalhes = [v.empresa, v.local, v.modelo].filter(Boolean).map(esc).join(' · ');
  const acao = v.status === 'para_voce'
    ? `<a class="botao pequeno" href="${esc(v.url)}" target="_blank" rel="noopener">Abrir</a>
       <button class="botao pequeno leve" data-vaga="${v.id}" data-mover="candidatada">Já me candidatei</button>
       <button class="botao pequeno leve" data-vaga="${v.id}" data-mover="descartada">Descartar</button>`
    : v.status === 'na_fila'
    ? `<button class="botao pequeno leve" data-vaga="${v.id}" data-mover="descartada">Descartar</button>`
    : ['descartada', 'pulada', 'erro'].includes(v.status)
      ? `<button class="botao pequeno leve" data-vaga="${v.id}" data-mover="na_fila">Pôr na fila</button>` : '';
  return `
    <tr>
      <td title="${esc(v.justificativa)}">${notaHtml(v.nota)}</td>
      <td>
        <div class="vaga-titulo"><a href="${esc(v.url)}" target="_blank" rel="noopener">${esc(v.titulo)}</a></div>
        <div class="detalhe">${detalhes || '—'}</div>
      </td>
      <td class="so-largo"><div>${esc(nomePlataforma(v.origem_plataforma))} → ${esc(nomePlataforma(v.plataforma_envio))}</div><div class="detalhe">achada ${dataHora(v.coletada_em)}</div></td>
      <td>${selo(STATUS_VAGA[v.status] || [v.status, ''])}${v.motivo_status ? `<div class="detalhe">${esc(v.motivo_status)}</div>` : ''}</td>
      <td class="acoes">${acao}</td>
    </tr>`;
}

function formNovaVaga() {
  return `
    <form class="cartao form-item" id="form-vaga" style="margin-bottom:18px">
      <h2>Adicionar vaga à mão</h2>
      <div class="form-grade">
        <div class="campo inteiro"><label for="nv-url">Link da vaga *</label><input id="nv-url" name="url" type="url" required placeholder="https://empresa.gupy.io/jobs/..."></div>
        <div class="campo"><label for="nv-titulo">Título *</label><input id="nv-titulo" name="titulo" type="text" required></div>
        <div class="campo"><label for="nv-empresa">Empresa</label><input id="nv-empresa" name="empresa" type="text"></div>
        <div class="campo"><label for="nv-local">Local</label><input id="nv-local" name="local" type="text" placeholder="São Paulo, SP"></div>
        <div class="campo"><label for="nv-modelo">Modelo</label>
          <select id="nv-modelo" name="modelo"><option value="">Não sei</option><option value="presencial">Presencial</option><option value="hibrido">Híbrido</option><option value="remoto">Remoto</option></select></div>
        <div class="campo inteiro"><label for="nv-desc">Descrição (opcional, melhora a nota)</label><textarea id="nv-desc" name="descricao"></textarea></div>
      </div>
      <div class="linha-botoes">
        <button type="button" class="botao leve" data-acao="cancelar-vaga">Cancelar</button>
        <button type="submit" class="botao">Adicionar e pontuar</button>
      </div>
    </form>`;
}

// histórico
let historicoAberto = null;

async function paginaHistorico() {
  const lista = await api('GET', '/candidaturas');
  return `
    <div class="cabecalho">
      <div><h1>Histórico</h1><p>Cada candidatura com as respostas exatamente como foram enviadas. Clique numa linha para ver.</p></div>
    </div>
    <div class="cartao">
      ${lista.length ? `<div class="tabela-rolagem"><table class="tabela">
        <thead><tr><th>Quando</th><th>Vaga</th><th class="so-largo">Onde</th><th>Resultado</th><th>Nota</th></tr></thead>
        <tbody>${lista.map((c) => `
          <tr class="clicavel" data-cand="${c.id}">
            <td class="mono">${dataHora(c.criada_em)}</td>
            <td><div class="vaga-titulo">${esc(c.titulo)}</div><div class="detalhe">${esc(c.empresa || '')}</div></td>
            <td class="so-largo">${esc(nomePlataforma(c.plataforma))}</td>
            <td>${selo(RESULTADO[c.resultado] || [c.resultado, ''])}${c.modo_teste && c.resultado !== 'simulada' ? ' <span class="selo sem-ponto">teste</span>' : ''}</td>
            <td>${notaHtml(c.nota)}</td>
          </tr>
          ${historicoAberto === c.id ? `<tr class="expandido"><td colspan="5">${detalheCandidatura(c)}</td></tr>` : ''}`).join('')}
        </tbody></table></div>` : '<p class="vazio">Nenhuma candidatura ainda. Elas aparecem aqui conforme a agenda roda.</p>'}
    </div>`;
}

function detalheCandidatura(c) {
  const fontes = {
    fixa: ['resposta fixa', 'azul'], 'fixa+ia': ['fixa + IA', 'azul'], perfil: ['perfil', 'verde'],
    ia: ['IA', 'amarelo'], regra: ['regra', ''], arquivo: ['currículo', 'verde'],
    pessoal: ['dado pessoal', 'verde'], aprendido: ['aprendido', 'azul'], origem: ['origem da vaga', 'azul'],
  };
  return `
    ${c.motivo ? `<p><b>Motivo:</b> ${esc(c.motivo)}</p>` : ''}
    ${c.respostas?.length ? `<div class="respostas-enviadas">${c.respostas.map((r) => `
      <div><span class="p">${esc(r.pergunta)}</span><span>${esc(r.resposta)}</span>${selo(fontes[r.fonte] || [r.fonte, ''])}</div>`).join('')}</div>`
      : '<p class="sub">Nenhuma resposta registrada.</p>'}
    <p class="sub"><a href="${esc(c.url)}" target="_blank" rel="noopener">Abrir a vaga</a></p>`;
}

// perfil
const CAMPOS_PERFIL = [
  ['nome', 'Nome completo', 'text'], ['email', 'E-mail', 'email'], ['telefone', 'Telefone / WhatsApp', 'tel'],
  ['cidade', 'Cidade', 'text'], ['linkedin_url', 'LinkedIn', 'url'], ['github_url', 'GitHub', 'url'],
  ['portfolio_url', 'Portfólio (opcional)', 'url'], ['curriculo_arquivo', 'Arquivo do currículo (PDF)', 'text', 'Caminho no seu computador. Ex.: C:\\Users\\voce\\curriculo.pdf'],
  ['foto_arquivo', 'Foto de perfil (JPG ou PNG)', 'text', 'Para vagas que pedem foto. Caminho no seu computador. Ex.: C:\\Users\\voce\\foto.jpg'],
  ['objetivo', 'Objetivo', 'text', 'Uma linha. Ex.: Estágio em desenvolvimento back-end'],
  ['resumo', 'Resumo sobre você', 'textarea', 'A IA usa isto como base para as respostas abertas. Escreva com suas palavras.'],
];

const LISTAS_PERFIL = {
  formacoes: { titulo: 'Formação', principal: 'curso', secundario: (i) => [i.instituicao, i.status, periodo(i)].filter(Boolean).join(' · '),
    campos: [['curso', 'Curso *'], ['instituicao', 'Instituição'], ['nivel', 'Nível', 'Graduação, Técnico…'], ['status', 'Situação', 'Em andamento / Concluído'], ['inicio', 'Início', 'MM/AAAA'], ['fim', 'Fim (ou previsão)', 'MM/AAAA']] },
  experiencias: { titulo: 'Experiências', principal: 'cargo', secundario: (i) => [i.empresa, periodo(i)].filter(Boolean).join(' · ') + (i.descricao ? '\n' + i.descricao : ''),
    campos: [['cargo', 'Cargo *'], ['empresa', 'Empresa'], ['inicio', 'Início', 'MM/AAAA'], ['fim', 'Fim', 'MM/AAAA ou vazio se atual'], ['descricao', 'O que você fazia', '', 'textarea']] },
  projetos: { titulo: 'Projetos', principal: 'nome', secundario: (i) => [i.tecnologias, i.repo_url].filter(Boolean).join(' · ') + (i.descricao ? '\n' + i.descricao : ''),
    campos: [['nome', 'Nome *'], ['tecnologias', 'Tecnologias', 'Node.js, Express, SQL Server'], ['repo_url', 'Link do GitHub'], ['demo_url', 'Link de demonstração'], ['descricao', 'Descrição', 'O que ele faz e o que você aprendeu', 'textarea']] },
  cursos: { titulo: 'Cursos', principal: 'nome', secundario: (i) => [i.instituicao, i.carga_horaria ? i.carga_horaria + 'h' : '', i.concluido_em].filter(Boolean).join(' · '),
    campos: [['nome', 'Curso *'], ['instituicao', 'Onde'], ['carga_horaria', 'Carga horária (h)'], ['concluido_em', 'Concluído em', 'MM/AAAA']] },
  textos: { titulo: 'Textos sobre você', principal: 'titulo', secundario: (i) => (i.texto || '').slice(0, 220) + ((i.texto || '').length > 220 ? '…' : ''),
    campos: [['titulo', 'Assunto *', 'Ex.: Minha trajetória profissional'], ['texto', 'Texto', 'Escreva com suas palavras. A IA adapta para cada pergunta e vaga.', 'textarea']] },
  habilidades: { titulo: 'Habilidades', principal: 'nome', secundario: (i) => i.nivel || '',
    campos: [['nome', 'Habilidade *', 'Uma ou várias separadas por vírgula: Node.js, Git, SQL'], ['nivel', 'Nível', 'Básico, intermediário, avançado']] },
};
const periodo = (i) => (i.inicio || i.fim ? `${i.inicio || '?'} → ${i.fim || 'atual'}` : '');
const editandoLista = { nome: null, id: null }; // id null = novo item

async function paginaPerfil() {
  const [{ perfil, listas }, pessoais] = await Promise.all([api('GET', '/perfil'), api('GET', '/pessoais')]);
  const preenchidos = CAMPOS_PERFIL.filter(([c]) => perfil[c]).length + Object.values(listas).filter((l) => l.length).length;
  const totalItens = CAMPOS_PERFIL.length + Object.keys(LISTAS_PERFIL).length;
  const pct = Math.round((preenchidos / totalItens) * 100);

  return `
    <div class="cabecalho">
      <div><h1>Perfil</h1><p>Tudo que o Rota sabe sobre você. A IA só usa o que está aqui: nada é inventado.</p></div>
    </div>

    <div class="cartao" style="margin-bottom:18px">
      <div class="progresso-perfil"><span class="sub">Perfil ${pct}% completo</span><div class="barra"><div style="width:${pct}%"></div></div></div>
      <p class="sub" style="margin:10px 0 0">Ir para:
        <a href="#/perfil" data-rolar="form-pessoais">Dados pessoais</a>
        ${Object.entries(LISTAS_PERFIL).map(([nome, def]) => ` · <a href="#/perfil" data-rolar="lista-${nome}">${def.titulo}</a>`).join('')}</p>
    </div>

    <form class="cartao" id="form-perfil">
      <h2>Dados básicos</h2>
      <div class="form-grade">
        ${CAMPOS_PERFIL.map(([c, rotulo, tipo, ajuda]) => `
          <div class="campo ${tipo === 'textarea' || c === 'objetivo' || c === 'curriculo_arquivo' || c === 'foto_arquivo' ? 'inteiro' : ''}">
            <label for="p-${c}">${rotulo}</label>
            ${tipo === 'textarea'
              ? `<textarea id="p-${c}" name="${c}" rows="5">${esc(perfil[c])}</textarea>`
              : `<input id="p-${c}" name="${c}" type="${tipo}" value="${esc(perfil[c])}">`}
            ${ajuda ? `<span class="ajuda">${esc(ajuda)}</span>` : ''}
          </div>`).join('')}
      </div>
      <div class="linha-botoes"><button class="botao" type="submit">Salvar dados básicos</button></div>
    </form>

    <form class="cartao secao" id="form-pessoais">
      <h2>Dados pessoais <span class="selo verde sem-ponto" style="vertical-align:middle">criptografados</span></h2>
      <p class="sub" style="margin-top:-6px">Usados pelo bot quando a vaga pedir. Ficam embaralhados no banco (AES-256) e o painel só mostra o final.
        Para trocar, digite o novo valor; campos vazios não mudam nada.</p>
      <div class="form-grade">
        ${pessoais.map((d) => `
          <div class="campo">
            <label for="dp-${d.chave}">${esc(d.rotulo)} ${d.preenchido ? `<span class="selo verde sem-ponto">salvo ${esc(d.mascara)}</span>` : ''}</label>
            <div style="display:flex;gap:8px">
              <input id="dp-${d.chave}" name="${d.chave}" type="text" autocomplete="off" placeholder="${d.preenchido ? 'digite para trocar' : esc(d.ajuda)}">
              ${d.preenchido ? `<button type="button" class="botao pequeno leve perigo" data-apagar-pessoal="${d.chave}" title="Apagar">Apagar</button>` : ''}
            </div>
          </div>`).join('')}
      </div>
      <div class="linha-botoes"><button class="botao" type="submit">Salvar dados pessoais</button></div>
    </form>

    ${Object.entries(LISTAS_PERFIL).map(([nome, def]) => blocoLista(nome, def, listas[nome])).join('')}`;
}

function blocoLista(nome, def, itens) {
  const editando = editandoLista.nome === nome;
  const itemEditado = editando && editandoLista.id != null ? itens.find((i) => i.id === editandoLista.id) : {};
  return `
    <section class="cartao secao" id="lista-${nome}">
      <div class="topo" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <h2 style="margin:0">${def.titulo}</h2>
        ${editando ? '' : `<button class="botao pequeno leve" data-lista="${nome}" data-editar="novo">Adicionar</button>`}
      </div>
      <div class="itens">
        ${itens.map((i) => editando && editandoLista.id === i.id ? '' : `
          <div class="item">
            <div><div class="t">${esc(i[def.principal])}</div><div class="d">${esc(def.secundario(i))}</div></div>
            <div class="botoes">
              <button class="botao pequeno leve" data-lista="${nome}" data-editar="${i.id}">Editar</button>
              <button class="botao pequeno leve perigo" data-lista="${nome}" data-remover="${i.id}">Remover</button>
            </div>
          </div>`).join('')}
        ${!itens.length && !editando ? '<p class="sub">Nada cadastrado ainda.</p>' : ''}
        ${editando ? formItem(nome, def, itemEditado || {}) : ''}
      </div>
    </section>`;
}

function formItem(nome, def, item) {
  return `
    <form class="form-item" data-form-lista="${nome}">
      <div class="form-grade">
        ${def.campos.map(([c, rotulo, dica, tipo]) => `
          <div class="campo ${tipo === 'textarea' ? 'inteiro' : ''}">
            <label for="l-${nome}-${c}">${rotulo}</label>
            ${tipo === 'textarea'
              ? `<textarea id="l-${nome}-${c}" name="${c}" placeholder="${esc(dica)}">${esc(item[c])}</textarea>`
              : `<input id="l-${nome}-${c}" name="${c}" type="${c === 'carga_horaria' ? 'number' : 'text'}" value="${esc(item[c])}" placeholder="${esc(dica)}">`}
          </div>`).join('')}
      </div>
      <div class="linha-botoes">
        <button type="button" class="botao leve" data-acao="cancelar-item">Cancelar</button>
        <button type="submit" class="botao">${item.id ? 'Salvar' : 'Adicionar'}</button>
      </div>
    </form>`;
}

async function paginaRespostas() {
  const lista = await api('GET', '/respostas');
  const preenchidas = lista.filter((r) => r.resposta).length;
  return `
    <div class="cabecalho">
      <div>
        <h1>Respostas fixas</h1>
        <p>Suas respostas para perguntas que quase todo formulário faz. O bot usa exatamente o que está aqui, e a IA usa como verdade para montar outras respostas. Campo vazio: a IA só responde se souber de outro lugar do seu perfil; se não souber, a vaga é pulada.</p>
      </div>
      <span class="selo ${preenchidas === lista.length ? 'verde' : 'amarelo'}">${preenchidas} de ${lista.length} preenchidas</span>
    </div>
    <form class="cartao" id="form-respostas">
      <div class="form-grade">
        ${lista.map((r) => `
          <div class="campo">
            <label for="r-${esc(r.chave)}">${esc(r.rotulo)}</label>
            <input id="r-${esc(r.chave)}" name="${esc(r.chave)}" type="text" value="${esc(r.resposta)}" placeholder="${esc(r.ajuda)}">
          </div>`).join('')}
      </div>
      <div class="linha-botoes"><button class="botao" type="submit">Salvar respostas</button></div>
    </form>`;
}

async function paginaAjustes() {
  const [c, plataformas] = await Promise.all([api('GET', '/configuracoes'), api('GET', '/plataformas')]);
  const modelos = (c.modelos_aceitos || '').split(/[;,]/).map((s) => s.trim().toLowerCase());
  const agora = new Date();
  const linhaPlataforma = (p) => {
    const pausada = p.pausada_ate && new Date(p.pausada_ate) > agora;
    return `
      <div class="opcao-linha">
        <div class="texto"><strong>${esc(p.nome)}</strong>
          <span>${p.tipo === 'coleta' ? 'Procura vagas' : 'Faz candidaturas'}${pausada ? ` · <b style="color:var(--vermelho)">pausada: ${esc(p.motivo_pausa || '')}</b>` : ''}</span>
        </div>
        <div style="display:flex;gap:12px;align-items:center">
          ${pausada ? `<button class="botao pequeno leve" data-despausar="${p.codigo}">Retomar</button>` : ''}
          <label class="sub" for="lim-${p.codigo}">por dia</label>
          <input id="lim-${p.codigo}" type="number" min="0" max="100" value="${p.limite_diario}" data-limite="${p.codigo}" style="width:76px">
          <label class="chave" title="Ligar/desligar"><input type="checkbox" data-ativa="${p.codigo}" ${p.ativa ? 'checked' : ''}><span></span></label>
        </div>
      </div>`;
  };

  return `
    <div class="cabecalho"><div><h1>Ajustes</h1><p>Como o Rota procura, escolhe e se candidata.</p></div></div>

    <form id="form-ajustes">
      <section class="cartao">
        <h2>Candidaturas</h2>
        <div class="opcao-linha">
          <div class="texto"><strong>Modo teste</strong><span>Preenche os formulários e registra no histórico, mas não clica em enviar. Deixe ligado até conferir as respostas.</span></div>
          <label class="chave"><input type="checkbox" name="modo_teste" ${c.modo_teste !== 'false' ? 'checked' : ''}><span></span></label>
        </div>
        <div class="opcao-linha">
          <div class="texto"><strong>Incluir vagas afirmativas</strong><span>Vagas reservadas a um grupo (pessoas negras, mulheres, PcD, pessoas trans…), com autodeclaração. Ligue só se você fizer parte do grupo da vaga.</span></div>
          <label class="chave"><input type="checkbox" name="incluir_afirmativas" ${c.incluir_afirmativas === 'true' ? 'checked' : ''}><span></span></label>
        </div>
        <div class="opcao-linha">
          <div class="texto"><strong>Modo rápido</strong><span>Cola textos longos de uma vez e encurta as pausas. Desligado: digita e espera como uma pessoa (mais lento).</span></div>
          <label class="chave"><input type="checkbox" name="velocidade_rapida" ${c.velocidade !== 'humana' ? 'checked' : ''}><span></span></label>
        </div>
        <div class="opcao-linha" style="display:block">
          <div class="texto" style="display:flex;justify-content:space-between"><strong>Nota mínima para se candidatar</strong><b class="mono" id="valor-nota">${esc(c.nota_minima)}</b></div>
          <input type="range" min="0" max="100" step="5" name="nota_minima" value="${esc(c.nota_minima)}" aria-label="Nota mínima">
          <span class="sub">Vagas abaixo disso são descartadas automaticamente.</span>
        </div>
      </section>

      <section class="cartao secao">
        <h2>Busca de vagas</h2>
        <div class="form-grade">
          <div class="campo inteiro"><label for="a-termos">Procurar por</label>
            <textarea id="a-termos" name="termos_busca" rows="3">${esc(c.termos_busca)}</textarea>
            <span class="ajuda">Separe com ponto e vírgula. Ex.: estágio desenvolvedor; estágio back-end</span></div>
          <div class="campo inteiro"><label for="a-excluir">Nunca se candidatar se tiver</label>
            <input id="a-excluir" name="termos_excluir" type="text" value="${esc(c.termos_excluir)}">
            <span class="ajuda">Ex.: sênior; pleno; especialista</span></div>
          <div class="campo"><label for="a-local">Cidades onde aceita trabalhar (presencial/híbrido)</label><input id="a-local" name="localizacao" type="text" value="${esc(c.localizacao)}">
            <span class="ajuda">Separe com ponto e vírgula. Ex.: São Paulo; Osasco. Vagas remotas valem de qualquer cidade.</span></div>
          <div class="campo"><label>Modelos aceitos</label>
            <div style="display:flex;gap:16px;padding-top:6px">
              ${[['presencial', 'Presencial'], ['hibrido', 'Híbrido'], ['remoto', 'Remoto']].map(([v, n]) =>
                `<label style="display:flex;gap:6px;align-items:center;font-weight:400"><input type="checkbox" name="modelo" value="${v}" ${modelos.includes(v) ? 'checked' : ''}> ${n}</label>`).join('')}
            </div></div>
        </div>
      </section>

      <section class="cartao secao">
        <h2>Janela de atividade</h2>
        <p class="sub" style="margin-top:-6px">O Rota só age dentro deste horário. Fora dele, nada acontece, como uma pessoa dormindo.</p>
        <div class="form-grade">
          <div class="campo"><label for="a-ini">Começa às</label><input id="a-ini" name="janela_inicio" type="time" value="${esc(c.janela_inicio)}"></div>
          <div class="campo"><label for="a-fim">Termina às</label><input id="a-fim" name="janela_fim" type="time" value="${esc(c.janela_fim)}"></div>
        </div>
      </section>

      <div class="linha-botoes"><button class="botao" type="submit">Salvar ajustes</button></div>
    </form>

    <section class="cartao secao">
      <h2>Plataformas e limites diários</h2>
      ${plataformas.map(linhaPlataforma).join('')}
      <div class="linha-botoes">
        <span class="sub" style="margin-right:auto;align-self:center">Mudou limites ou janela? Sorteie os horários de hoje de novo.</span>
        <button class="botao leve" data-acao="replanejar">Sortear horários de novo</button>
      </div>
    </section>`;
}

// perguntas que o bot não soube responder com a verdade
const estadoPerguntas = { editando: null };
const TIPO_CAMPO = { texto: 'Texto curto', textarea: 'Texto longo', radio: 'Escolha', select: 'Lista', combobox: 'Lista', caixinhas: 'Caixinhas', checkbox: 'Caixinha' };

function formPergunta(p) {
  const escolha = p.opcoes?.length > 0;
  const longa = p.tipo === 'textarea';
  return `
    <form class="form-pergunta" data-form-pergunta="${p.id}">
      ${escolha ? `
        <div class="opcoes-pergunta" role="radiogroup" aria-label="Opções">
          ${p.opcoes.map((o, i) => `
            <label class="opcao-chip"><input type="radio" name="opcao" value="${esc(o)}" ${p.resposta === o ? 'checked' : ''}><span>${esc(o)}</span></label>`).join('')}
        </div>
        <label class="sub" for="pr-${p.id}">Ou escreva com suas palavras (ajuda quando outra empresa usar opções diferentes):</label>` : ''}
      ${longa || !escolha && String(p.pergunta).length > 90
        ? `<textarea id="pr-${p.id}" name="resposta" rows="${longa ? 5 : 3}" placeholder="Sua resposta verdadeira">${esc(p.resposta || '')}</textarea>`
        : `<input id="pr-${p.id}" name="resposta" type="text" value="${esc(escolha && p.opcoes.includes(p.resposta) ? '' : p.resposta || '')}" placeholder="${escolha ? 'Opcional' : 'Sua resposta verdadeira'}">`}
      <div class="linha-botoes">
        ${p.resposta == null
          ? `<button type="button" class="botao leve" data-ignorar-pergunta="${p.id}" title="As vagas que esperam por esta pergunta são puladas">Não quero responder</button>`
          : `<button type="button" class="botao leve" data-cancelar-pergunta>Cancelar</button>`}
        <button type="submit" class="botao">Salvar</button>
      </div>
    </form>`;
}

async function paginaPerguntas() {
  const lista = await api('GET', '/perguntas');
  const pendentes = lista.filter((p) => p.resposta == null);
  const respondidas = lista.filter((p) => p.resposta != null);
  atualizarContador(pendentes.length);
  const meta = (p) => `${esc(TIPO_CAMPO[p.tipo] || 'Pergunta')} · apareceu ${p.vezes} ${p.vezes > 1 ? 'vezes' : 'vez'}${p.vagas.length ? ` · ${p.vagas.length} vaga${p.vagas.length > 1 ? 's' : ''}` : ''}`;
  return `
    <div class="cabecalho">
      <div>
        <h1>Perguntas</h1>
        <p>Quando uma vaga pergunta algo que o Rota não sabe responder com a verdade, ela para aqui e a vaga fica esperando. Responda uma vez: a resposta vale para todas as empresas, mesmo quando a pergunta vier com outras palavras ou outras opções. Ao salvar, as vagas voltam para a fila sozinhas.</p>
      </div>
      <span class="selo ${pendentes.length ? 'amarelo' : 'verde'}">${pendentes.length ? `${pendentes.length} esperando você` : 'Tudo respondido'}</span>
    </div>

    ${pendentes.length ? pendentes.map((p) => `
      <section class="cartao secao pergunta-cartao">
        <div class="pergunta-meta">${meta(p)}</div>
        <h3 class="pergunta-texto">${esc(p.pergunta)}</h3>
        ${formPergunta(p)}
      </section>`).join('') : `
      <section class="cartao secao"><p class="vazio">Nenhuma pergunta esperando. O Rota está respondendo tudo sozinho.</p></section>`}

    ${respondidas.length ? `
      <section class="cartao secao">
        <h2>Já respondidas <span class="sub">(${respondidas.length})</span></h2>
        <ul class="lista-respondidas">
          ${respondidas.map((p) => `
            <li>
              <div class="pergunta-texto pequena">${esc(p.pergunta)}</div>
              ${estadoPerguntas.editando === p.id ? formPergunta(p) : `
                <div class="resposta-dada"><span>${esc(p.resposta)}</span>
                  <button type="button" class="botao pequeno leve" data-editar-pergunta="${p.id}">Editar</button></div>`}
            </li>`).join('')}
        </ul>
      </section>` : ''}`;
}

// processos: respostas das empresas por e-mail, lidas pela IA
const SITUACAO = {
  recebida: ['Candidatura recebida', 'azul'], em_analise: ['Em análise', 'azul'], avancou: ['Avançou de etapa', 'verde'],
  teste: ['Teste para fazer', 'amarelo'], entrevista: ['Entrevista', 'verde'], proposta: ['Proposta', 'verde'],
  aprovado: ['Aprovado', 'verde'], reprovado: ['Não seguiu', ''], outro: ['Atualização', ''],
};

// "2026-10-02" + "23:59" -> "02/10/2026 às 23:59" (ou o prazo como veio no e-mail)
function prazoProc(p) {
  if (p.prazo_dia) { const [a, m, d] = p.prazo_dia.split('-'); return `${d}/${m}/${a}${p.prazo_hora ? ` às ${p.prazo_hora}` : ''}`; }
  return p.prazo || '';
}

async function paginaProcessos() {
  const lista = await api('GET', '/processos');
  const comAcao = lista.filter((p) => p.acao && !['reprovado'].includes(p.situacao));
  const ativos = new Set(lista.filter((p) => !['reprovado'].includes(p.situacao)).map((p) => (p.empresa || '').toLowerCase())).size;
  const item = (p) => `
    <li class="processo">
      <div class="processo-topo">
        ${selo(SITUACAO[p.situacao] || SITUACAO.outro)}
        <strong>${esc(p.empresa || 'Empresa não identificada')}</strong>
        <span class="sub">${dataHora(p.recebido_em)}</span>
      </div>
      ${p.vaga_titulo ? `<div class="detalhe">${p.vaga_url ? `<a href="${esc(p.vaga_url)}" target="_blank" rel="noopener">${esc(p.vaga_titulo)}</a>` : esc(p.vaga_titulo)}</div>` : ''}
      ${p.resumo ? `<p class="processo-resumo">${esc(p.resumo)}</p>` : ''}
      ${p.acao ? `<p class="processo-acao"><b>O que fazer:</b> ${esc(p.acao)}${prazoProc(p) ? ` <span class="selo amarelo">prazo: ${esc(prazoProc(p))}</span>` : ''}</p>` : ''}
      <div class="processo-links">
        ${p.link ? `<a class="botao pequeno" href="${esc(p.link)}" target="_blank" rel="noopener">${p.situacao === 'reprovado' ? 'Ver o processo' : 'Abrir o processo'}</a>` : ''}
        ${p.email_id && !String(p.email_id).startsWith('demo-') ? `<a class="botao pequeno leve" href="https://mail.google.com/mail/u/0/#search/rfc822msgid%3A${encodeURIComponent(String(p.email_id).replace(/^<|>$/g, ''))}" target="_blank" rel="noopener">Ver o e-mail</a>` : ''}
      </div>
      <div class="sub">${p.notificado ? '✓ avisado no WhatsApp' : 'aguardando envio no WhatsApp'}${p.lembrete_enviado ? ' · ✓ lembrete da véspera enviado' : ''} · e-mail: ${esc(p.assunto || '')}</div>
    </li>`;
  return `
    <div class="cabecalho">
      <div><h1>Processos</h1><p>O que as empresas responderam por e-mail sobre as suas candidaturas. A IA lê cada e-mail e o Rota te avisa no WhatsApp.</p></div>
    </div>
    <div class="grade grade-3">
      <div class="cartao numero"><div class="rotulo">Empresas em andamento</div><div class="valor">${ativos}</div></div>
      <div class="cartao numero"><div class="rotulo">Precisam de você</div><div class="valor">${comAcao.length}</div></div>
      <div class="cartao numero"><div class="rotulo">Atualizações</div><div class="valor">${lista.length}</div></div>
    </div>
    ${comAcao.length ? `<section class="cartao secao"><h2>Precisam de você</h2><ul class="lista-processos">${comAcao.map(item).join('')}</ul></section>` : ''}
    <section class="cartao secao">
      <h2>Tudo que chegou</h2>
      ${lista.length ? `<ul class="lista-processos">${lista.map(item).join('')}</ul>` : '<p class="vazio">Nenhum e-mail de processo seletivo ainda. O Rota olha seu Gmail nos horários de "Alertas por e-mail".</p>'}
    </section>`;
}

// roteador
const PAGINAS = {
  hoje: paginaHoje, vagas: paginaVagas, historico: paginaHistorico,
  perfil: paginaPerfil, processos: paginaProcessos, perguntas: paginaPerguntas, respostas: paginaRespostas, ajustes: paginaAjustes,
};
let paginaAtual = 'hoje';
let timerAtualizar = null;

async function mostrar(nome = paginaAtual, { manterRolagem = false } = {}) {
  paginaAtual = PAGINAS[nome] ? nome : 'hoje';
  $$('.menu a').forEach((a) => a.classList.toggle('ativo', a.dataset.rota === paginaAtual));
  const rolagem = window.scrollY;
  try {
    $('#conteudo').innerHTML = await PAGINAS[paginaAtual]();
  } catch (e) {
    $('#conteudo').innerHTML = `<div class="cartao"><h2>Não consegui carregar</h2><p class="sub">${esc(e.message)}. O servidor está rodando?</p></div>`;
  }
  if (manterRolagem) window.scrollTo(0, rolagem);

  clearInterval(timerAtualizar);
  if (paginaAtual === 'hoje') {
    timerAtualizar = setInterval(() => document.visibilityState === 'visible' && mostrar('hoje', { manterRolagem: true }), 30000);
  }
}

const recarregar = () => mostrar(paginaAtual, { manterRolagem: true });

window.addEventListener('hashchange', () => {
  mostrar(location.hash.replace('#/', '') || 'hoje');
  window.scrollTo(0, 0);
});

// ações (delegação de eventos)
const conteudo = $('#conteudo');
const dadosForm = (form) => Object.fromEntries(new FormData(form).entries());

conteudo.addEventListener('click', (ev) => {
  // atalhos do Perfil: rola até a seção sem trocar de página
  const rolar = ev.target.closest('a[data-rolar]');
  if (rolar) {
    ev.preventDefault();
    document.getElementById(rolar.dataset.rolar)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const link = ev.target.closest('a[data-ir-status]');
  if (link) estadoVagas.status = link.dataset.irStatus;
});

conteudo.addEventListener('click', async (ev) => {
  const alvo = ev.target.closest('button, tr[data-cand]');
  if (!alvo) return;
  const d = alvo.dataset;
  try {
    if (d.acao === 'replanejar') {
      const r = await api('POST', '/agenda/replanejar');
      avisar(`${r.acoes} horários sorteados para o resto do dia`);
      return recarregar();
    }
    if (d.status !== undefined) { estadoVagas.status = d.status; return recarregar(); }
    if (d.acao === 'nova-vaga') { estadoVagas.adicionando = true; await recarregar(); return $('#nv-url')?.focus(); }
    if (d.acao === 'cancelar-vaga') { estadoVagas.adicionando = false; return recarregar(); }
    if (d.mover) {
      await api('PATCH', `/vagas/${d.vaga}`, { status: d.mover });
      avisar({ na_fila: 'Vaga voltou para a fila', candidatada: 'Marcada como candidatada', descartada: 'Vaga descartada' }[d.mover]);
      return recarregar();
    }
    if (d.cand) { historicoAberto = historicoAberto === Number(d.cand) ? null : Number(d.cand); return recarregar(); }
    if (d.editar) {
      Object.assign(editandoLista, { nome: d.lista, id: d.editar === 'novo' ? null : Number(d.editar) });
      await recarregar();
      return $(`[data-form-lista="${d.lista}"] input`)?.focus();
    }
    if (d.acao === 'cancelar-item') { Object.assign(editandoLista, { nome: null, id: null }); return recarregar(); }
    if (d.remover) {
      await api('DELETE', `/perfil/${d.lista}/${d.remover}`);
      avisar('Removido');
      return recarregar();
    }
    if (d.apagarPessoal) {
      await api('PUT', '/pessoais', { [d.apagarPessoal]: null });
      avisar('Apagado');
      return recarregar();
    }
    if (d.editarPergunta) { estadoPerguntas.editando = Number(d.editarPergunta); return recarregar(); }
    if (d.cancelarPergunta !== undefined) { estadoPerguntas.editando = null; return recarregar(); }
    if (d.ignorarPergunta) {
      await api('DELETE', `/perguntas/${d.ignorarPergunta}`);
      avisar('Pergunta descartada. As vagas dela foram puladas.');
      return recarregar();
    }
    if (d.despausar) {
      await api('PATCH', `/plataformas/${d.despausar}`, { despausar: true });
      avisar('Plataforma retomada');
      return recarregar();
    }
  } catch (e) { avisar(e.message, 'erro'); }
});

conteudo.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  try {
    if (form.id === 'form-vaga') {
      const r = await api('POST', '/vagas', dadosForm(form));
      estadoVagas.adicionando = false;
      avisar(r.aprovada ? `Nota ${r.nota}: entrou na fila` : `Nota ${r.nota}: abaixo do mínimo, descartada`);
      return recarregar();
    }
    if (form.id === 'form-perfil') {
      await api('PUT', '/perfil', dadosForm(form));
      avisar('Perfil salvo');
      return recarregar();
    }
    if (form.dataset.formLista) {
      const nome = form.dataset.formLista;
      const dados = dadosForm(form);
      // lista colada ("Node.js, Git, SQL") vira um item para cada
      const varias = nome === 'habilidades' && !editandoLista.id
        ? dados.nome.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean) : [];
      if (varias.length > 1) {
        for (const h of varias) await api('POST', `/perfil/${nome}`, { ...dados, nome: h });
        Object.assign(editandoLista, { nome: null, id: null });
        avisar(`${varias.length} habilidades adicionadas`);
        return recarregar();
      }
      if (editandoLista.id) await api('PUT', `/perfil/${nome}/${editandoLista.id}`, dados);
      else await api('POST', `/perfil/${nome}`, dados);
      Object.assign(editandoLista, { nome: null, id: null });
      avisar('Salvo');
      return recarregar();
    }
    if (form.id === 'form-pessoais') {
      await api('PUT', '/pessoais', dadosForm(form));
      avisar('Dados pessoais salvos (criptografados)');
      return recarregar();
    }
    if (form.dataset.formPergunta) {
      const f = new FormData(form);
      // o texto tem prioridade sobre a opção, pois é mais completo para outras empresas
      const resposta = String(f.get('resposta') || '').trim() || String(f.get('opcao') || '').trim();
      const r = await api('PUT', `/perguntas/${form.dataset.formPergunta}`, { resposta });
      estadoPerguntas.editando = null;
      const partes = ['Salvo.'];
      if (r.aproveitadas) partes.push(`A IA usou sua resposta em mais ${r.aproveitadas} pergunta${r.aproveitadas > 1 ? 's parecidas' : ' parecida'} (confira em "Já respondidas").`);
      if (r.liberadas) partes.push(`${r.liberadas} vaga${r.liberadas > 1 ? 's voltaram' : ' voltou'} para a fila.`);
      avisar(partes.join(' '));
      return recarregar();
    }
    if (form.id === 'form-respostas') {
      const lista = Object.entries(dadosForm(form)).map(([chave, resposta]) => ({ chave, resposta }));
      await api('PUT', '/respostas', lista);
      avisar('Respostas salvas');
      return recarregar();
    }
    if (form.id === 'form-ajustes') {
      const f = new FormData(form);
      await api('PUT', '/configuracoes', {
        modo_teste: f.get('modo_teste') ? 'true' : 'false',
        incluir_afirmativas: f.get('incluir_afirmativas') ? 'true' : 'false',
        velocidade: f.get('velocidade_rapida') ? 'rapida' : 'humana',
        nota_minima: f.get('nota_minima'),
        termos_busca: f.get('termos_busca'),
        termos_excluir: f.get('termos_excluir'),
        localizacao: f.get('localizacao'),
        modelos_aceitos: f.getAll('modelo').join('; '),
        janela_inicio: f.get('janela_inicio'),
        janela_fim: f.get('janela_fim'),
      });
      avisar('Ajustes salvos');
      return recarregar();
    }
  } catch (e) { avisar(e.message, 'erro'); }
});

conteudo.addEventListener('input', (ev) => {
  // marcou uma opção: limpa o texto, senão ele prevaleceria
  if (ev.target.name === 'opcao') { const t = ev.target.form?.querySelector('[name=resposta]'); if (t) t.value = ''; }
  if (ev.target.name === 'nota_minima') $('#valor-nota').textContent = ev.target.value;
});

let esperaBusca;
conteudo.addEventListener('input', (ev) => {
  if (ev.target.id !== 'busca-vagas') return;
  clearTimeout(esperaBusca);
  esperaBusca = setTimeout(async () => {
    estadoVagas.q = ev.target.value.trim();
    await recarregar();
    const campo = $('#busca-vagas');
    campo.focus();
    campo.setSelectionRange(campo.value.length, campo.value.length);
  }, 300);
});

conteudo.addEventListener('change', async (ev) => {
  const d = ev.target.dataset;
  try {
    if (d.ativa) {
      await api('PATCH', `/plataformas/${d.ativa}`, { ativa: ev.target.checked });
      avisar(ev.target.checked ? 'Plataforma ligada' : 'Plataforma desligada');
    }
    if (d.limite) {
      await api('PATCH', `/plataformas/${d.limite}`, { limite_diario: Number(ev.target.value) });
      avisar('Limite salvo. Sorteie os horários de novo para valer hoje.');
    }
  } catch (e) { avisar(e.message, 'erro'); }
});

desenharRodape();
api('GET', '/resumo').then((r) => { infoSistema = r; desenharRodape(); atualizarContador(r.perguntasPendentes); }).catch(() => {});
mostrar(location.hash.replace('#/', '') || 'hoje');
