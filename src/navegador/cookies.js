// Aceita os cookies dos sites (pedido do Gustavo): banner de cookies tapando o formulário trava o Rota.
// Procura primeiro os botões conhecidos (OneTrust, Cookiebot, Didomi...) e depois pelo texto,
// só dentro de avisos que falam de cookies/consentimento (para nunca clicar em outro "Aceitar").

const { pausa } = require('./navegador');

function acharAceitar() {
  const todos = (sel, raiz = document) => { const out = [...raiz.querySelectorAll(sel)]; for (const e of raiz.querySelectorAll('*')) if (e.shadowRoot) out.push(...todos(sel, e.shadowRoot)); return out; };
  const visivel = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const CONHECIDOS = '#onetrust-accept-btn-handler, #accept-recommended-btn-handler, #CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, #CybotCookiebotDialogBodyButtonAccept, #didomi-notice-agree-button, .cc-allow, .cc-accept-all, #truste-consent-button, [data-testid=uc-accept-all-button], [data-cookiebanner=accept_button], #hs-eu-confirmation-button, .cky-btn-accept, #cookie-accept, #accept-cookies, #acceptCookies, [id*=cookie i][id*=accept i], [class*=cookie i][class*=accept i]';
  let botao = todos(CONHECIDOS).find(visivel);
  if (!botao) {
    const TEXTO = /^(aceitar( todos| tudo| cookies| todos os cookies| e fechar| e continuar)?|aceito|concordo|concordar|permitir( todos| tudo)?|accept( all)?( cookies)?|allow( all)?( cookies)?|i agree|agree|got it|ok,? entendi|entendi|ok)$/i;
    const AVISO = /cookie|consentimento|consent|privacidade|privacy|parceiros|lgpd/i;
    botao = todos('button, a, [role=button], input[type=button], input[type=submit]').filter(visivel).find((b) => {
      const t = (b.innerText || b.value || b.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
      if (!TEXTO.test(t)) return false;
      // sobe até achar o aviso; tem que falar de cookies e não ser um formulário de candidatura
      for (let n = b.parentElement, i = 0; n && i < 8; n = n.parentElement, i++) {
        const txt = (n.innerText || '').slice(0, 3000);
        if (AVISO.test(txt)) return !n.querySelector('input[type=email], input[type=tel], input[type=file], textarea');
      }
      return false;
    });
  }
  if (!botao) return null;
  botao.setAttribute('data-rota-cookie', '1');
  return (botao.innerText || botao.value || botao.id || 'aceitar').trim().slice(0, 40);
}

async function aceitarCookies(pagina) {
  for (let i = 0; i < 2; i++) {
    const achou = await pagina.evaluate(acharAceitar).catch(() => null);
    if (!achou) return i > 0;
    await pagina.locator('[data-rota-cookie]').first().click({ timeout: 4000 })
      .catch(() => pagina.locator('[data-rota-cookie]').first().evaluate((e) => e.click()).catch(() => {}));
    await pagina.evaluate(() => document.querySelectorAll('[data-rota-cookie]').forEach((e) => e.removeAttribute('data-rota-cookie'))).catch(() => {});
    await pausa(600, 1200);
  }
  return true;
}

module.exports = { aceitarCookies, acharAceitar };
