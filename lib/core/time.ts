/** Hora de Bogotá (UTC−5, sin horario de verano) para reglas por día y hora. Puro, con pruebas. */

const BOGOTA_OFFSET = -5 * 3_600_000;

export interface HappyHour {
  enabled: boolean;
  /** 1 = lunes … 7 = domingo */
  days: number[];
  from: string;
  to: string;
  label: string;
}

export function bogotaParts(now = new Date()) {
  const wall = new Date(now.getTime() + BOGOTA_OFFSET);
  const dow = wall.getUTCDay() === 0 ? 7 : wall.getUTCDay();
  return { dow, minutes: wall.getUTCHours() * 60 + wall.getUTCMinutes(), hour: wall.getUTCHours(), dayKey: wall.toISOString().slice(0, 10) };
}

/** La jornada de un bar no termina a medianoche: lo que se vende antes de las 5:00 a. m. cuenta para el día anterior. */
export const JORNADA_CUTOFF_HOUR = 5;

/** Fecha (AAAA-MM-DD) de la jornada a la que pertenece un momento. */
export function jornadaKey(now = new Date()) {
  return bogotaParts(new Date(now.getTime() - JORNADA_CUTOFF_HOUR * 3_600_000)).dayKey;
}

/** Suma (o resta) días a una fecha AAAA-MM-DD. */
export function addDays(dayKey: string, n: number) {
  return new Date(Date.parse(`${dayKey}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Día de la semana de una fecha AAAA-MM-DD: 1 = lunes … 7 = domingo. */
export function weekdayOf(dayKey: string) {
  const d = new Date(`${dayKey}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  return (h ?? 0) * 60 + (m ?? 0);
}

/** ¿Está activo el happy hour? Admite horarios que cruzan la medianoche (por ejemplo 22:00 a 01:00). */
export function isHappyHour(rule: HappyHour | undefined, now = new Date()) {
  if (!rule?.enabled) return false;
  const { dow, minutes } = bogotaParts(now);
  const from = toMinutes(rule.from);
  const to = toMinutes(rule.to);
  if (from === to) return false;
  if (from < to) return rule.days.includes(dow) && minutes >= from && minutes < to;
  // Cruza la medianoche: la parte de después de las 00:00 pertenece al día anterior
  if (minutes >= from) return rule.days.includes(dow);
  const prev = dow === 1 ? 7 : dow - 1;
  return minutes < to && rule.days.includes(prev);
}

export function effectivePrice(product: { price: number; happy_price: number | null }, happy: boolean) {
  return happy && product.happy_price !== null && product.happy_price < product.price ? product.happy_price : product.price;
}

export function minutesSince(from: Date | string, now = new Date()) {
  return Math.max(0, Math.floor((now.getTime() - new Date(from).getTime()) / 60_000));
}

const DAY_NAMES = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

/** "jueves a sábado, de 5:00 p. m. a 7:00 p. m." */
export function describeSchedule(rule: HappyHour) {
  const days = [...rule.days].sort((a, b) => a - b);
  const contiguous = days.every((d, i) => i === 0 || d === days[i - 1]! + 1);
  const dayText = days.length === 7 ? "todos los días" : contiguous && days.length > 2 ? `${DAY_NAMES[days[0]!]} a ${DAY_NAMES[days[days.length - 1]!]}` : days.map((d) => DAY_NAMES[d]).join(", ");
  return `${dayText}, de ${clock(rule.from)} a ${clock(rule.to)}`;
}

export function clock(hhmm: string) {
  const total = toMinutes(hhmm);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  const suffix = h < 12 ? "a. m." : "p. m.";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}
