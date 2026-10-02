// Chrome instalado no PC controlado via Playwright, com janela visível e perfil persistente
// em dados/navegador (login salvo; a pasta fica fora do Git).

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PASTA_PERFIL = path.join(__dirname, '..', '..', 'dados', 'navegador');
// Cookies de sessão somem quando o Chrome fecha: ficam aqui, cifrados com a ROTA_CHAVE
const ARQUIVO_SESSAO = path.join(__dirname, '..', '..', 'dados', 'sessao.cofre');

function lerSessao() {
  try {
    const cofre = require('../util/cofre');
    return JSON.parse(cofre.decifrar(fs.readFileSync(ARQUIVO_SESSAO, 'utf8')));
  } catch { return []; } // sem arquivo ou chave: começa sem sessão
}

function guardarSessao(cookies) {
  try {
    const cofre = require('../util/cofre');
    const deSessao = cookies.filter((c) => c.expires === -1 || !c.expires);
    fs.writeFileSync(ARQUIVO_SESSAO, cofre.cifrar(JSON.stringify(deSessao)));
  } catch { /* sem ROTA_CHAVE: não guarda */ }
}

// Dados pessoais ficam só no cofre, não no autopreenchimento do Chrome
function desligarAutopreenchimento() {
  const arquivo = path.join(PASTA_PERFIL, 'Default', 'Preferences');
  let prefs = {};
  try { prefs = JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch { /* primeira vez */ }
  prefs.autofill = { ...(prefs.autofill || {}), enabled: false, profile_enabled: false, credit_card_enabled: false };
  prefs.credentials_enable_service = false;
  prefs.profile = { ...(prefs.profile || {}), password_manager_enabled: false };
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, JSON.stringify(prefs));
}

// Fecha os Chrome que estão usando a pasta de perfil do Rota. Devolve true se fechou algum.
function fecharChromeDoRota() {
  const { execFileSync } = require('child_process');
  try {
    if (process.platform === 'win32') {
      const pasta = PASTA_PERFIL.replace(/'/g, "''");
      const script = `$p = Get-CimInstance Win32_Process -Filter "name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${pasta}*' }; $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; $p.Count`;
      const n = Number(String(execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 20000 })).trim()) || 0;
      if (n) console.log(`  (fechei ${n} processo(s) de um Chrome do Rota que tinha ficado aberto)`);
      return n > 0;
    }
    execFileSync('pkill', ['-f', `user-data-dir=${PASTA_PERFIL}`]);
    return true;
  } catch { return false; }
}

async function abrirNavegador({ headless = process.env.NAVEGADOR_OCULTO === 'true' } = {}) {
  desligarAutopreenchimento();
  const opcoes = {
    headless,
    viewport: null, // tamanho real da janela
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
  };
  // Permite outro navegador (usado nos testes)
  // No servidor Linux usa o Chromium do Playwright (NAVEGADOR_CANAL=chromium); no PC, o Chrome instalado
  const canal = process.env.NAVEGADOR_CANAL || (process.platform === 'linux' ? 'chromium' : 'chrome');
  if (process.env.NAVEGADOR_EXECUTAVEL) opcoes.executablePath = process.env.NAVEGADOR_EXECUTAVEL;
  else opcoes.channel = canal; // 'chromium' = modo oculto com o navegador completo (mais parecido com o real)
  if (headless) opcoes.args.push('--no-sandbox');

  let contexto;
  try {
    contexto = await chromium.launchPersistentContext(PASTA_PERFIL, opcoes);
  } catch (e) {
    // Um Chrome do Rota ficou aberto (janela esquecida ou travada) segurando o perfil:
    // fecha só ele (o seu Chrome pessoal usa outra pasta) e tenta de novo
    if (!fecharChromeDoRota()) throw e;
    await new Promise((r) => setTimeout(r, 2500));
    contexto = await chromium.launchPersistentContext(PASTA_PERFIL, opcoes);
  }

  const guardados = lerSessao();
  if (guardados.length) await contexto.addCookies(guardados).catch(() => {});

  // Fechando no X não dá mais para ler os cookies, então guarda a última leitura
  let ultimos = guardados;
  const foto = async () => { ultimos = await contexto.cookies().catch(() => ultimos); };
  const intervalo = setInterval(foto, 4000);
  contexto.on('close', () => { clearInterval(intervalo); guardarSessao(ultimos); });

  const pagina = contexto.pages()[0] || (await contexto.newPage());
  return {
    contexto, pagina,
    fechar: async () => { await foto(); await contexto.close(); },
  };
}

// Ritmo humano
const aleatorio = (min, max) => min + Math.random() * (max - min);
// humana: pausas e digitação de pessoa; rapida: ~1/3 das pausas e textos longos colados
let fator = 0.35;
let rapida = true;
function definirVelocidade(velocidade) {
  rapida = velocidade !== 'humana';
  fator = rapida ? 0.35 : 1;
}
const pausa = (minMs, maxMs = minMs) => new Promise((r) => setTimeout(r, aleatorio(minMs, maxMs) * fator));

async function digitar(campo, texto) {
  await campo.click();
  await pausa(200, 600);
  await campo.fill('');
  // Texto longo é colado de uma vez (digitar 600 letras levaria ~30s)
  if (rapida && String(texto).length > 40) {
    await campo.fill(String(texto));
    await pausa(200, 500);
    return;
  }
  const palavras = String(texto).split(/(\s+)/);
  for (const pedaco of palavras) {
    await campo.pressSequentially(pedaco, { delay: aleatorio(25, 75) * (rapida ? 0.4 : 1) });
    if (Math.random() < 0.06) await pausa(400, 1200);
  }
  await pausa(300, 900);
}

// Rola a página como quem está lendo
async function lerPagina(pagina, { minMs = 3000, maxMs = 8000 } = {}) {
  const fim = Date.now() + aleatorio(minMs, maxMs);
  while (Date.now() < fim) {
    await pagina.mouse.wheel(0, aleatorio(150, 450));
    await pausa(600, 1600);
  }
  await pagina.mouse.wheel(0, -5000);
  await pausa(400, 900);
}

module.exports = { abrirNavegador, pausa, digitar, lerPagina, definirVelocidade, PASTA_PERFIL };
