// Acompanhamento dos processos seletivos: lê o Gmail, a IA classifica cada e-mail e as novidades
// vão para o painel e o WhatsApp. Cada e-mail é lido uma vez (dados/email/processos-lidos.json).

const fs = require('fs');
const path = require('path');
const gmail = require('../util/gmail');
const ia = require('../ia/gemini');
const whatsapp = require('../notificacao/whatsapp');
const { dataLocal } = require('../util/tempo');

const ARQUIVO_LIDOS = path.join(__dirname, '..', '..', 'dados', 'email', 'processos-lidos.json');

// possíveis e-mails de processo seletivo, sem os alertas de vagas novas
const BUSCA = 'newer_than:14d -from:jobalerts-noreply@linkedin.com -from:jobs-noreply@linkedin.com -subject:"vagas para você" -subject:"novas vagas" '
  + '{subject:candidatura subject:processo subject:seletivo subject:etapa subject:entrevista subject:teste subject:inscrição subject:inscricao '
  + 'subject:application subject:interview subject:"next steps" subject:feedback subject:infelizmente subject:parabéns subject:aprovado subject:convite '
  + 'from:gupy.io from:gupy.com.br from:smartrecruiters.com from:factorialhr.com from:greenhouse.io from:lever.co from:workable.com from:inhire.com.br from:solides.com.br from:pandape.com.br from:kenoby.com}';

const ROTULO = {
  recebida: ['📨', 'Candidatura recebida'], em_analise: ['🔎', 'Em análise'], avancou: ['🟢', 'Você avançou de etapa'],
  teste: ['📝', 'Teste para fazer'], entrevista: ['🗣️', 'Entrevista'], proposta: ['💼', 'Proposta'],
  aprovado: ['🎉', 'Aprovado!'], reprovado: ['⚪', 'Não seguiu no processo'], outro: ['ℹ️', 'Atualização'],
};

const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function carregarLidos() { try { return new Set(JSON.parse(fs.readFileSync(ARQUIVO_LIDOS, 'utf8'))); } catch { return new Set(); } }
function salvarLidos(s) { fs.mkdirSync(path.dirname(ARQUIVO_LIDOS), { recursive: true }); fs.writeFileSync(ARQUIVO_LIDOS, JSON.stringify([...s].slice(-3000))); }

// liga o e-mail a uma vaga candidatada pela empresa e, se houver mais de uma, pelo título
async function acharVaga(repo, info) {
  if (!info.empresa) return null;
  const candidatas = [
    ...(await repo.vagas.listar({ status: 'candidatada', limite: 500 })),
    ...(await repo.vagas.listar({ status: 'testada', limite: 500 })),
  ];
  const emp = norm(info.empresa).split(' ').filter((p) => p.length > 2);
  const daEmpresa = candidatas.filter((v) => emp.some((p) => norm(v.empresa).includes(p)));
  if (daEmpresa.length <= 1) return daEmpresa[0] || null;
  const tit = norm(info.vaga).split(' ').filter((p) => p.length > 3);
  return daEmpresa.map((v) => ({ v, pontos: tit.filter((p) => norm(v.titulo).includes(p)).length }))
    .sort((a, b) => b.pontos - a.pontos)[0].v;
}

// "2026-10-02" + "23:59" -> "02/10/2026 às 23:59"
function prazoBonito(p) {
  const dia = p.prazo_dia || p.prazo_data;
  if (dia && /^\d{4}-\d{2}-\d{2}/.test(dia)) {
    const [a, m, d] = String(dia).slice(0, 10).split('-');
    return `${d}/${m}/${a}${p.prazo_hora ? ` às ${p.prazo_hora}` : ''}`;
  }
  return p.prazo || null;
}

function linhasDeLink(p) {
  const naoPassou = p.situacao === 'reprovado';
  return [
    p.link ? `🔗 *${naoPassou ? 'Ver o processo' : 'Abrir o processo'}:* ${p.link}` : null,
    p.email_id && !String(p.email_id).startsWith('demo-') ? `📧 *Ver o e-mail:* ${gmail.linkGmail(p.email_id)}` : null,
  ].filter(Boolean);
}

function mensagem(p) {
  const [icone, texto] = ROTULO[p.situacao] || ROTULO.outro;
  const prazo = prazoBonito(p);
  return [
    `${icone} *${texto}* — ${p.empresa || 'empresa não identificada'}`,
    p.vaga_titulo ? `Vaga: ${p.vaga_titulo}` : null,
    p.resumo ? `\n${p.resumo}` : null,
    p.acao ? `\n👉 *O que fazer:* ${p.acao}` : null,
    prazo ? `⏰ *Prazo:* ${prazo}` : null,
    '',
    ...linhasDeLink(p),
    '\n_Rota · acompanhamento de candidaturas_',
  ].filter((l) => l !== null).join('\n');
}

function mensagemLembrete(p) {
  return [
    `⏰ *O prazo é AMANHÃ* — ${p.empresa || 'processo seletivo'}`,
    p.vaga_titulo ? `Vaga: ${p.vaga_titulo}` : null,
    p.acao ? `\n👉 ${p.acao}` : null,
    `📅 Prazo: ${prazoBonito(p)}`,
    '',
    ...linhasDeLink(p),
    '\n_Rota · lembrete de prazo_',
  ].filter((l) => l !== null).join('\n');
}

async function verificar({ repo, log }, { lerFn = gmail.lerEmails, entenderFn = ia.entenderEmailProcesso } = {}) {
  if (!gmail.configurado()) { await log('aviso', 'processos', 'Acompanhamento desligado: falta GMAIL_USUARIO e GMAIL_SENHA_APP no .env.'); return 0; }
  if (!ia.disponivel()) { await log('aviso', 'processos', 'Acompanhamento precisa da IA (GEMINI_API_KEY) para entender os e-mails.'); return 0; }
  const lidos = carregarLidos();
  for (const id of await repo.processos.idsLidos()) lidos.add(id);
  const emails = await lerFn({ busca: BUSCA, dias: 14, max: 30, jaLidos: lidos });
  let novos = 0;
  try {
    for (const e of emails) {
      const info = await entenderFn({ assunto: e.assunto, de: e.de, texto: e.texto || e.html.replace(/<[^>]+>/g, ' '), links: e.links || [], data: e.data });
      lidos.add(e.id);
      if (!info) continue;
      const vaga = await acharVaga(repo, info);
      const id = await repo.processos.registrar({
        email_id: e.id, vaga_id: vaga?.id || null, empresa: info.empresa || vaga?.empresa, vaga_titulo: info.vaga || vaga?.titulo,
        situacao: info.situacao, resumo: info.resumo, acao: info.acao, prazo: info.prazo, assunto: e.assunto, recebido_em: e.data,
        link: info.link, prazo_data: info.prazoData, prazo_hora: info.prazoHora,
      });
      if (id) novos++;
    }
  } finally {
    salvarLidos(lidos);
  }
  await log('info', 'processos', `Processos seletivos: ${emails.length} e-mails olhados, ${novos} novidades.`);
  return novos;
}

// se um envio falhar, para e o resto vai na próxima rodada
async function notificar({ repo, log }, { enviarFn = whatsapp.enviar } = {}) {
  if (!whatsapp.configurado() && enviarFn === whatsapp.enviar) return 0;
  const pendentes = await repo.processos.naoNotificados();
  let enviados = 0;
  for (const p of pendentes) {
    try {
      await enviarFn(mensagem(p));
      await repo.processos.marcarNotificado(p.id);
      enviados++;
    } catch (e) {
      await log('aviso', 'processos', `WhatsApp: ${e.message}`);
      break;
    }
  }
  return enviados;
}

// lembrete na véspera dos prazos
async function lembrar({ repo, log }, { enviarFn = whatsapp.enviar, agora = new Date() } = {}) {
  if (!whatsapp.configurado() && enviarFn === whatsapp.enviar) return 0;
  const amanha = dataLocal(new Date(agora.getTime() + 86400000));
  let enviados = 0;
  for (const p of await repo.processos.lembretesPara(amanha)) {
    try {
      await enviarFn(mensagemLembrete({ ...p, prazo_dia: p.prazo_dia || amanha }));
      await repo.processos.marcarLembrete(p.id);
      enviados++;
    } catch (e) {
      await log('aviso', 'processos', `WhatsApp (lembrete): ${e.message}`);
      break;
    }
  }
  if (enviados) await log('info', 'processos', `${enviados} lembrete(s) de prazo enviados no WhatsApp.`);
  return enviados;
}

module.exports = { verificar, notificar, lembrar, mensagem, mensagemLembrete, BUSCA, ROTULO };
