// O banco guarda tudo em UTC; dia e horário seguem o fuso local.
// Na VPS, rode com TZ=America/Sao_Paulo.

const MINUTO = 60 * 1000;

const doisDigitos = (n) => String(n).padStart(2, '0');

// Date -> '2026-09-27'
function dataLocal(d = new Date()) {
  return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`;
}

// ('2026-09-27', '08:30') -> Date
function horarioLocal(data, hhmm) {
  const [ano, mes, dia] = data.split('-').map(Number);
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  return new Date(ano, mes - 1, dia, h || 0, m || 0, 0, 0);
}

function inicioDoDia(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function fimDoDia(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

// segunda-feira 00:00 da semana atual
function inicioDaSemana(d = new Date()) {
  const dia = inicioDoDia(d);
  const diaSemana = (dia.getDay() + 6) % 7; // 0 = segunda
  dia.setDate(dia.getDate() - diaSemana);
  return dia;
}

module.exports = { MINUTO, dataLocal, horarioLocal, inicioDoDia, fimDoDia, inicioDaSemana };
