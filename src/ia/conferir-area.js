// Antes de candidatar: a vaga é mesmo de tecnologia (desenvolvimento, dados, banco, nuvem)?
// Primeiro as regras (título claramente de outra área já sai); depois a IA lê título + descrição.
// Sem IA, só passa título de TI ou descrição com vários termos de TI.

const { areaPorRegras } = require('./pontuador');
const ia = require('./gemini');

const CONFIRMADA = 'TI e cidade conferidas'; // (as antigas "TI confirmada" são conferidas de novo)

async function conferirArea(vaga, { config = {} } = {}) {
  if (vaga.origem_coleta === 'manual') return { ok: true, motivo: 'vaga escolhida por você', fonte: 'manual' };
  const regras = areaPorRegras(vaga);
  if (!regras.ok && /Área fora de TI/.test(regras.motivo)) return { ok: false, motivo: regras.motivo, fonte: 'regra' };
  if (String(vaga.justificativa || '').includes(CONFIRMADA)) return { ok: true, motivo: CONFIRMADA, fonte: 'anterior' };
  if (ia.disponivel()) {
    const r = await ia.classificarVaga({
      titulo: vaga.titulo, empresa: vaga.empresa, local: vaga.local, descricao: vaga.descricao,
      cidade: String(config.localizacao || 'São Paulo').split(';')[0].split(',')[0].trim() || 'São Paulo',
      incluirSuporte: !!config.incluirSuporte, aceitaJunior: !!config.aceitaJunior,
    }).catch(() => null);
    if (r && !r.localOk) return { ok: false, motivo: `Fora da sua cidade: ${r.local || 'outra cidade'} (você aceita ${config.localizacao || 'São Paulo'} ou remoto)`, fonte: 'ia' };
    if (r) return r.ti
      ? { ok: true, motivo: `${CONFIRMADA} pela IA (${r.area}: ${r.evidencias.slice(0, 3).join(', ')})`, fonte: 'ia' }
      : { ok: false, motivo: `A IA viu que não é de tecnologia: ${r.area}${r.motivo ? ` — ${r.motivo}` : ''}`, fonte: 'ia' };
  }
  return { ...regras, fonte: 'regra' };
}

module.exports = { conferirArea, CONFIRMADA };
