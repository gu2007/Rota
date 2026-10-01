// A mesma vaga chega com parâmetros de rastreio diferentes; normalizar evita candidatura dupla.
const PARAMETROS_LIXO = /^(utm_|ref|refid|trk|tracking|src|source|fbclid|gclid|jobboardsource)/i;

function normalizarUrl(bruta) {
  try {
    const u = new URL(String(bruta).trim());
    u.hash = '';
    for (const chave of [...u.searchParams.keys()]) {
      if (PARAMETROS_LIXO.test(chave)) u.searchParams.delete(chave);
    }
    u.hostname = u.hostname.toLowerCase();
    // mesma vaga em endereços diferentes: padroniza
    const gupyNumero = u.hostname.endsWith('.gupy.io') && u.pathname.match(/^\/jobs\/(\d+)/);
    if (gupyNumero) return require('../coleta/links-vagas').gupyCanonica(u.hostname.split('.')[0], gupyNumero[1]);
    const linkedin = /(^|\.)linkedin\.com$/.test(u.hostname) && u.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d{7,})/);
    if (linkedin) return `https://www.linkedin.com/jobs/view/${linkedin[1]}`;
    let texto = u.toString();
    if (texto.endsWith('/')) texto = texto.slice(0, -1);
    return texto;
  } catch {
    return null;
  }
}

function detectarPlataformaEnvio(url) {
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  if (host.endsWith('gupy.io')) return 'gupy';
  if (host.includes('infojobs')) return 'infojobs';
  if (/(^|\.)linkedin\.com$/.test(host)) return 'linkedin'; // o destino real é descoberto depois
  return 'sites';
}

module.exports = { normalizarUrl, detectarPlataformaEnvio };
