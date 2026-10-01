// Sorteia os horários do dia imitando uso humano: sessões curtas de 2-3 ações e pausas longas.
// Mínimo de 15 min na mesma plataforma e 4 min entre plataformas; os segundos também são sorteados.

const { MINUTO } = require('../util/tempo');

const GAP_MINIMO = 15;          // min, mesma plataforma
const GAP_SESSAO = [15, 45];    // min, dentro de uma sessão
const GAP_PAUSA = [50, 200];    // min, entre sessões
const GAP_ENTRE_PLATAFORMAS = 4;

function criarSorteio(rng = Math.random) {
  const entre = (min, max) => min + rng() * (max - min);
  const inteiro = (min, max) => Math.floor(entre(min, max + 1));
  return { rng, entre, inteiro };
}

// cada sessão tem pelo menos 1 ação
function dividirEmSessoes(n, k, s) {
  const tamanhos = Array(k).fill(1);
  for (let i = k; i < n; i++) tamanhos[s.inteiro(0, k - 1)]++;
  return tamanhos;
}

// Se não couber na janela (ex.: planejando às 20h), a quantidade diminui
function gerarHorarios({ quantidade, inicio, fim, rng }) {
  const s = criarSorteio(rng);
  const disponivel = (fim - inicio) / MINUTO;
  if (quantidade <= 0 || disponivel <= 0) return [];

  let n = quantidade;
  while (n > 1 && (n - 1) * GAP_MINIMO > disponivel * 0.95) n--;

  if (n === 1) return [new Date(inicio.getTime() + s.entre(0, disponivel) * MINUTO)];

  const k = s.inteiro(1, Math.min(5, Math.ceil(n / 2)));
  const sessoes = dividirEmSessoes(n, k, s);
  let gaps = [];
  sessoes.forEach((tamanho, i) => {
    for (let j = 1; j < tamanho; j++) gaps.push(s.entre(...GAP_SESSAO));
    if (i < sessoes.length - 1) gaps.push(s.entre(...GAP_PAUSA));
  });

  // não coube: encolhe os intervalos proporcionalmente, sem passar do mínimo
  const folga = disponivel * 0.95;
  let total = gaps.reduce((a, b) => a + b, 0);
  if (total > folga) {
    const excesso = total - GAP_MINIMO * gaps.length;
    const alvo = folga - GAP_MINIMO * gaps.length;
    const fator = excesso > 0 ? Math.max(0, alvo) / excesso : 0;
    gaps = gaps.map((g) => GAP_MINIMO + (g - GAP_MINIMO) * fator);
    total = gaps.reduce((a, b) => a + b, 0);
  }

  let t = inicio.getTime() + s.entre(0, Math.max(0, disponivel - total)) * MINUTO;
  const horarios = [new Date(t)];
  for (const g of gaps) {
    t += g * MINUTO;
    horarios.push(new Date(t));
  }

  // segundos aleatórios, até 50s
  return horarios.map((h) => new Date(h.getTime() + Math.floor(s.entre(0, 50)) * 1000));
}

// plataformas: [{ codigo, quantidade }]
function planejarDia({ plataformas, inicio, fim, rng }) {
  const s = criarSorteio(rng);
  const todos = [];
  for (const p of plataformas) {
    for (const horario of gerarHorarios({ quantidade: p.quantidade, inicio, fim, rng })) {
      todos.push({ plataforma: p.codigo, horario });
    }
  }
  todos.sort((a, b) => a.horario - b.horario);

  // duas plataformas no mesmo minuto parece robô: empurra a segunda
  const resultado = [];
  for (const item of todos) {
    const anterior = resultado[resultado.length - 1];
    let horario = item.horario;
    if (anterior && (horario - anterior.horario) / MINUTO < GAP_ENTRE_PLATAFORMAS) {
      horario = new Date(anterior.horario.getTime() + s.entre(GAP_ENTRE_PLATAFORMAS, 9) * MINUTO);
    }
    if (horario > fim) continue;

    // o empurrão pode ter colado na ação anterior da mesma plataforma
    const mesma = [...resultado].reverse().find((r) => r.plataforma === item.plataforma);
    if (mesma && (horario - mesma.horario) / MINUTO < GAP_MINIMO) continue;

    resultado.push({ plataforma: item.plataforma, horario });
  }
  return resultado;
}

module.exports = { gerarHorarios, planejarDia, GAP_MINIMO, GAP_ENTRE_PLATAFORMAS };
