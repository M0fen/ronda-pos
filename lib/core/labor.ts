/**
 * Costo del equipo por turno en Colombia: recargos, festivos, carga prestacional y alertas de jornada.
 * Es una estimación para decidir turnos; la nómina legal la liquida el contador.
 * Puro, con pruebas (tests/labor.test.ts). Las cifras de ley llevan fecha de vigencia: revísalas cada enero y cada julio.
 */
import { addDays, JORNADA_CUTOFF_HOUR, toMinutes, weekdayOf } from "./time";

export type PayKind = "salario" | "hora";

export interface LaborRules {
  /** Salario mínimo mensual */
  smmlv: number;
  /** Auxilio de transporte mensual, para salarios de hasta 2 mínimos */
  transport: number;
  /** Jornada máxima semanal, en horas */
  weeklyHours: number;
  /** Horas al mes para sacar la hora ordinaria (jornada semanal × 5) */
  divisor: number;
  /** Hora en que empieza y termina el recargo nocturno (19 = 7:00 p. m.) */
  nightFrom: number;
  nightTo: number;
  night: number;
  /** Recargo por trabajar en domingo o festivo */
  rest: number;
  extraDay: number;
  extraNight: number;
}

const BASE: LaborRules = { smmlv: 1_423_500, transport: 200_000, weeklyHours: 46, divisor: 230, nightFrom: 21, nightTo: 6, night: 0.35, rest: 0.75, extraDay: 0.25, extraNight: 0.75 };

/** Cambios de ley con la fecha en que empiezan a regir. */
export const LABOR_CHANGES: { from: string; set: Partial<LaborRules>; why: string }[] = [
  { from: "2025-07-01", set: { rest: 0.8 }, why: "Dominical y festivo al 80 % (Ley 2466 de 2025)" },
  { from: "2025-07-15", set: { weeklyHours: 44, divisor: 220 }, why: "Jornada de 44 horas (Ley 2101 de 2021)" },
  { from: "2025-12-25", set: { nightFrom: 19 }, why: "Recargo nocturno desde las 7:00 p. m. (Ley 2466 de 2025)" },
  { from: "2026-01-01", set: { smmlv: 1_750_905, transport: 249_095 }, why: "Salario mínimo y auxilio de transporte de 2026 (decretos 1469 y 1470 de 2025)" },
  { from: "2026-07-01", set: { rest: 0.9 }, why: "Dominical y festivo al 90 % (Ley 2466 de 2025)" },
  { from: "2026-07-15", set: { weeklyHours: 42, divisor: 210 }, why: "Jornada de 42 horas (Ley 2101 de 2021)" },
  { from: "2027-07-01", set: { rest: 1 }, why: "Dominical y festivo al 100 % (Ley 2466 de 2025)" },
];

/** Reglas vigentes en una fecha (AAAA-MM-DD). */
export function laborRules(dayKey: string): LaborRules {
  let rules = { ...BASE };
  for (const change of LABOR_CHANGES) if (change.from <= dayKey) rules = { ...rules, ...change.set };
  return rules;
}

/* ---------- Festivos de Colombia (Ley 51 de 1983) ---------- */

const pad = (n: number) => String(n).padStart(2, "0");

function easter(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Los festivos que se corren al lunes siguiente (si no caen en lunes). */
function monday(dayKey: string) {
  const dow = weekdayOf(dayKey);
  return dow === 1 ? dayKey : addDays(dayKey, 8 - dow);
}

const holidayCache = new Map<number, Map<string, string>>();

/** Festivos de un año: fecha → nombre. */
export function holidays(year: number) {
  let map = holidayCache.get(year);
  if (map) return map;
  const e = easter(year);
  const y = (md: string) => `${year}-${md}`;
  const list: [string, string][] = [
    [y("01-01"), "Año Nuevo"],
    [monday(y("01-06")), "Reyes Magos"],
    [monday(y("03-19")), "San José"],
    [addDays(e, -3), "Jueves Santo"],
    [addDays(e, -2), "Viernes Santo"],
    [y("05-01"), "Día del Trabajo"],
    [addDays(e, 43), "Ascensión del Señor"],
    [addDays(e, 64), "Corpus Christi"],
    [addDays(e, 71), "Sagrado Corazón"],
    [monday(y("06-29")), "San Pedro y San Pablo"],
    [y("07-20"), "Independencia"],
    [y("08-07"), "Batalla de Boyacá"],
    [monday(y("08-15")), "Asunción de la Virgen"],
    [monday(y("10-12")), "Día de la Raza"],
    [monday(y("11-01")), "Todos los Santos"],
    [monday(y("11-11")), "Independencia de Cartagena"],
    [y("12-08"), "Inmaculada Concepción"],
    [y("12-25"), "Navidad"],
  ];
  map = new Map(list);
  holidayCache.set(year, map);
  return map;
}

export function holidayName(dayKey: string) {
  return holidays(Number(dayKey.slice(0, 4))).get(dayKey) ?? null;
}

/* ---------- Carga sobre el salario ---------- */

const ARL = [0.522, 1.044, 2.436, 4.35, 6.96];

export interface LaborSettings {
  /** Exonerado de salud, SENA e ICBF (art. 114-1 del Estatuto Tributario) */
  exonerated: boolean;
  /** Clase de riesgo de la ARL, de 1 a 5 */
  arlClass: number;
}

/** Lo que el empleador paga encima del salario y sus recargos: seguridad social, caja, parafiscales y prestaciones. */
export function loadRate(s: LaborSettings) {
  const arl = ARL[Math.min(5, Math.max(1, Math.round(s.arlClass || 1))) - 1]!;
  const social = 12 + arl + 4 + (s.exonerated ? 0 : 8.5 + 2 + 3);
  const benefits = 100 / 12 + 100 / 12 + 1 + 100 / 24; // prima, cesantías, intereses, vacaciones
  return (social + benefits) / 100;
}

/** El auxilio de transporte solo carga prestaciones: prima, cesantías e intereses. */
export const TRANSPORT_LOAD = (100 / 12 + 100 / 12 + 1) / 100;

/** Jornada flexible: hasta 9 horas al día sin que cuenten como extra (Ley 2101 de 2021). */
export const DAILY_MAX_MINUTES = 9 * 60;
export const MAX_DAILY_EXTRA_MINUTES = 2 * 60;
export const MAX_WEEKLY_EXTRA_MINUTES = 12 * 60;
/** Un turno sin salida se cuenta hasta 16 horas y se avisa desde las 12. */
export const MAX_OPEN_MINUTES = 16 * 60;
export const LONG_OPEN_MINUTES = 12 * 60;
/** De semanas pasadas solo se avisa si las extras pasan de 2 horas (llegar antes y salir después suma minutos). */
export const PAST_WEEK_NOTICE_MINUTES = 2 * 60;

/* ---------- Tiempo ---------- */

const OFFSET = 5 * 3_600_000; // Bogotá: UTC−5 todo el año
const DAY = 86_400_000;
const MIN = 60_000;

const dayCache = new Map<number, { key: string; dow: number; holiday: string | null }>();

function dayInfo(index: number) {
  let info = dayCache.get(index);
  if (!info) {
    const key = new Date(index * DAY).toISOString().slice(0, 10);
    info = { key, dow: ((((index % 7) + 7 + 3) % 7) + 1), holiday: holidayName(key) };
    dayCache.set(index, info);
  }
  return info;
}

/** Jornada (AAAA-MM-DD) de un momento: lo de antes de las 5:00 a. m. es del día anterior. */
export function jornadaOf(t: number | Date | string) {
  return dayInfo(Math.floor((+new Date(t) - OFFSET - JORNADA_CUTOFF_HOUR * 3_600_000) / DAY)).key;
}

/** Lunes de la semana de una fecha. */
export function weekOf(dayKey: string) {
  return addDays(dayKey, 1 - weekdayOf(dayKey));
}

export interface Turno {
  name: string;
  from: string;
}

const rel = (hhmm: string) => (toMinutes(hhmm) - JORNADA_CUTOFF_HOUR * 60 + 1440) % 1440;

/** Turnos del local en el orden de la jornada (desde las 5:00 a. m.). */
export function sortTurnos(list: Turno[]) {
  return [...list].sort((a, b) => rel(a.from) - rel(b.from));
}

/** Turno del local al que pertenece un momento. Lo de antes del primero cuenta para el primero. */
export function turnoAt(t: number | Date | string, turnos: Turno[]) {
  const local = +new Date(t) - OFFSET;
  const minute = Math.floor((((local % DAY) + DAY) % DAY) / MIN);
  const r = (minute - JORNADA_CUTOFF_HOUR * 60 + 1440) % 1440;
  let index = 0;
  turnos.forEach((tu, i) => {
    if (rel(tu.from) <= r) index = i;
  });
  return index;
}

/* ---------- Costo de los turnos ---------- */

export interface ShiftIn {
  id: string;
  staffId: string;
  start: string | Date;
  end: string | Date | null;
  payKind: PayKind;
  /** Salario mensual o valor de la hora */
  payAmount: number;
}

export interface MinuteSplit {
  ordinary: number;
  night: number;
  rest: number;
  restNight: number;
  extra: number;
  extraNight: number;
  extraRest: number;
  extraRestNight: number;
}

export interface ShiftCost {
  id: string;
  staffId: string;
  jornada: string;
  start: number;
  end: number;
  open: boolean;
  /** Sin salida y con más de 16 horas: se cuenta hasta ahí */
  capped: boolean;
  minutes: number;
  split: MinuteSplit;
  wage: number;
  load: number;
  transport: number;
  total: number;
  /** Domingos y festivos que tocó el turno */
  restDays: string[];
}

export interface StaffDay {
  staffId: string;
  jornada: string;
  minutes: number;
  /** Minutos extra del día, por el día o por haber pasado la jornada semanal */
  extra: number;
  /** Minutos por encima de las 9 horas del día */
  over: number;
}

export interface StaffWeek {
  staffId: string;
  week: string;
  minutes: number;
  extra: number;
  /** Con contrato laboral (salario): aplican recargos, extras y límites */
  legal: boolean;
}

export interface LaborCost {
  shifts: ShiftCost[];
  /** Minutos y costo por la llave que devuelve `slot` (por ejemplo, jornada y turno del local) */
  slots: Map<string, { minutes: number; cost: number }>;
  days: StaffDay[];
  weeks: StaffWeek[];
}

export interface LaborOptions extends LaborSettings {
  now?: number | Date;
  slot?: (t: number) => string;
}

const emptySplit = (): MinuteSplit => ({ ordinary: 0, night: 0, rest: 0, restNight: 0, extra: 0, extraNight: 0, extraRest: 0, extraRestNight: 0 });

/**
 * Cuesta cada turno minuto a minuto: nocturno, dominical o festivo y extra (más de 9 horas en el día
 * o más de la jornada semanal). Para pago por horas el valor es fijo y ya trae todo.
 */
export function costShifts(list: ShiftIn[], opts: LaborOptions): LaborCost {
  const now = opts.now === undefined ? Date.now() : +opts.now;
  const rate = loadRate(opts);
  const shifts: ShiftCost[] = [];
  const slots = new Map<string, { minutes: number; cost: number }>();
  const days = new Map<string, StaffDay>();
  const weeks = new Map<string, StaffWeek & { ordinary: number }>();
  const sorted = [...list].sort((a, b) => (a.staffId === b.staffId ? +new Date(a.start) - +new Date(b.start) : a.staffId < b.staffId ? -1 : 1));

  for (const s of sorted) {
    const start = +new Date(s.start);
    const rawEnd = s.end ? +new Date(s.end) : now;
    const end = Math.min(rawEnd, start + MAX_OPEN_MINUTES * MIN);
    const minutes = Math.max(0, Math.round((end - start) / MIN));
    const jornada = jornadaOf(start);
    const rules = laborRules(jornada);
    const legal = s.payKind === "salario";
    const hour = legal ? s.payAmount / rules.divisor : s.payAmount;
    const transportMinute = legal && s.payAmount > 0 && s.payAmount <= 2 * rules.smmlv ? (rules.transport / rules.divisor / 60) * (1 + TRANSPORT_LOAD) : 0;
    const week = weekOf(jornada);
    const day = days.get(`${s.staffId}|${jornada}`) ?? { staffId: s.staffId, jornada, minutes: 0, extra: 0, over: 0 };
    const wk = weeks.get(`${s.staffId}|${week}`) ?? { staffId: s.staffId, week, minutes: 0, extra: 0, ordinary: 0, legal };
    days.set(`${s.staffId}|${jornada}`, day);
    weeks.set(`${s.staffId}|${week}`, wk);
    if (legal) wk.legal = true;

    const split = emptySplit();
    const restDays = new Set<string>();
    let wage = 0;
    let transport = 0;
    for (let m = 0; m < minutes; m++) {
      const t = start + m * MIN + MIN / 2;
      const local = t - OFFSET;
      const info = dayInfo(Math.floor(local / DAY));
      const h = Math.floor((((local % DAY) + DAY) % DAY) / 3_600_000);
      const isNight = rules.nightFrom > rules.nightTo ? h >= rules.nightFrom || h < rules.nightTo : h >= rules.nightFrom && h < rules.nightTo;
      const isRest = info.dow === 7 || info.holiday !== null;
      const over = legal && day.minutes >= DAILY_MAX_MINUTES;
      const extra = over || (legal && wk.ordinary >= rules.weeklyHours * 60);
      if (over) day.over++;
      day.minutes++;
      wk.minutes++;
      if (extra) {
        day.extra++;
        wk.extra++;
      } else wk.ordinary++;
      if (isRest) restDays.add(info.key);
      if (extra) split[isRest ? (isNight ? "extraRestNight" : "extraRest") : isNight ? "extraNight" : "extra"]++;
      else split[isRest ? (isNight ? "restNight" : "rest") : isNight ? "night" : "ordinary"]++;

      const factor = !legal ? 1 : extra ? 1 + (isNight ? rules.extraNight : rules.extraDay) + (isRest ? rules.rest : 0) : 1 + (isNight ? rules.night : 0) + (isRest ? rules.rest : 0);
      const minuteWage = (hour / 60) * factor;
      const minuteTransport = extra ? 0 : transportMinute;
      wage += minuteWage;
      transport += minuteTransport;
      if (opts.slot) {
        const key = opts.slot(t);
        const acc = slots.get(key) ?? { minutes: 0, cost: 0 };
        acc.minutes++;
        acc.cost += minuteWage * (1 + (legal ? rate : 0)) + minuteTransport;
        slots.set(key, acc);
      }
    }
    const load = legal ? wage * rate : 0;
    shifts.push({
      id: s.id,
      staffId: s.staffId,
      jornada,
      start,
      end,
      open: !s.end,
      capped: rawEnd > end,
      minutes,
      split,
      wage,
      load,
      transport,
      total: wage + load + transport,
      restDays: [...restDays].sort(),
    });
  }
  return {
    shifts,
    slots,
    days: [...days.values()],
    weeks: [...weeks.values()].map(({ ordinary: _ordinary, ...w }) => w),
  };
}

/** Lo que cuesta una hora ordinaria de día con todo encima (para mostrar al registrar el pago). */
export function hourCost(payKind: PayKind, payAmount: number, s: LaborSettings, dayKey: string) {
  if (payKind === "hora") return payAmount;
  const rules = laborRules(dayKey);
  const hour = payAmount / rules.divisor;
  const transport = payAmount > 0 && payAmount <= 2 * rules.smmlv ? (rules.transport / rules.divisor) * (1 + TRANSPORT_LOAD) : 0;
  return hour * (1 + loadRate(s)) + transport;
}

/* ---------- Alertas de jornada ---------- */

const DAY_NAMES = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const MONTHS = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sept.", "oct.", "nov.", "dic."];

/** "viernes 6 de nov." */
export function dayLabel(dayKey: string) {
  return `${DAY_NAMES[weekdayOf(dayKey)]} ${Number(dayKey.slice(8, 10))} de ${MONTHS[Number(dayKey.slice(5, 7)) - 1]}`;
}

/** "7 h 30 min" */
export function fmtHours(minutes: number) {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r} min`;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** "Ana, Luis y Sara" */
export function joinNames(names: string[]) {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

export interface LaborAlert {
  tone: "red" | "yellow" | "neutral";
  text: string;
  staffId?: string;
}

/**
 * Avisos para el dueño: quién pasó o va a pasar de la jornada semanal, quién hizo más de 2 horas
 * extra en un día, quién trabajó domingo o festivo y qué turnos siguen abiertos de más.
 */
export function laborAlerts(cost: LaborCost, ctx: { names: Map<string, string>; from: string; to: string; today: string; now?: number }): LaborAlert[] {
  const alerts: LaborAlert[] = [];
  const name = (id: string) => ctx.names.get(id) ?? "Alguien del equipo";
  const rules = laborRules(ctx.today);
  const max = rules.weeklyHours * 60;
  const thisWeek = weekOf(ctx.today);
  const inRange = (d: string) => d >= ctx.from && d <= ctx.to;

  for (const s of cost.shifts) {
    if (s.open && (s.capped || s.minutes >= LONG_OPEN_MINUTES)) {
      alerts.push({ tone: "red", staffId: s.staffId, text: `${name(s.staffId)} tiene el turno abierto desde el ${dayLabel(s.jornada)} (${fmtHours(s.minutes)}${s.capped ? " o más" : ""}): marca su salida.` });
    }
  }
  const onShift = new Set(cost.shifts.filter((s) => s.open).map((s) => s.staffId));
  const extraText = (w: StaffWeek) => (w.extra ? ` (${fmtHours(w.extra)} extra${w.extra > MAX_WEEKLY_EXTRA_MINUTES ? ": el máximo son 12 h" : ""})` : "");
  for (const w of [...cost.weeks].sort((a, b) => (a.week < b.week ? 1 : -1))) {
    if (!w.legal) continue;
    if (w.week === thisWeek) {
      if (w.minutes >= max)
        alerts.push({
          tone: "red",
          staffId: w.staffId,
          text: `${name(w.staffId)} lleva ${fmtHours(w.minutes)} esta semana: ${w.minutes > max ? "pasó de" : "llegó a"} las ${rules.weeklyHours} h${extraText(w)}${onShift.has(w.staffId) ? " y sigue en turno" : ""}.`,
        });
      else if (w.minutes >= max - 4 * 60)
        alerts.push({
          tone: "yellow",
          staffId: w.staffId,
          text: onShift.has(w.staffId)
            ? `${name(w.staffId)} lleva ${fmtHours(w.minutes)} esta semana y sigue en turno: en ${fmtHours(max - w.minutes)} pasa de las ${rules.weeklyHours} h.`
            : `${name(w.staffId)} lleva ${fmtHours(w.minutes)} esta semana: le quedan ${fmtHours(max - w.minutes)} para llegar a ${rules.weeklyHours}.`,
        });
    } else if (w.extra > PAST_WEEK_NOTICE_MINUTES && w.week <= ctx.to && addDays(w.week, 6) >= ctx.from) {
      alerts.push({ tone: w.extra > MAX_WEEKLY_EXTRA_MINUTES ? "red" : "yellow", staffId: w.staffId, text: `${name(w.staffId)} trabajó ${fmtHours(w.minutes)} la semana del ${dayLabel(w.week).replace(/^\S+ /, "")}${extraText(w)}.` });
    }
  }
  const legalStaff = new Set(cost.weeks.filter((w) => w.legal).map((w) => w.staffId));
  for (const d of [...cost.days].sort((a, b) => (a.jornada < b.jornada ? 1 : -1))) {
    if (!legalStaff.has(d.staffId) || !inRange(d.jornada) || d.over <= MAX_DAILY_EXTRA_MINUTES) continue;
    alerts.push({ tone: "red", staffId: d.staffId, text: `${name(d.staffId)} trabajó ${fmtHours(d.minutes)} el ${dayLabel(d.jornada)}: ${fmtHours(d.over)} más de las 9 h del día, y el máximo de extra son 2 h.` });
  }
  // Domingos y festivos: quién trabajó (con contrato) y el recargo que aplica
  const restDays = new Map<string, Set<string>>();
  for (const s of cost.shifts) {
    if (!legalStaff.has(s.staffId)) continue;
    for (const d of s.restDays) {
      if (!inRange(d)) continue;
      const set = restDays.get(d) ?? new Set<string>();
      set.add(s.staffId);
      restDays.set(d, set);
    }
  }
  for (const [d, ids] of [...restDays].sort((a, b) => (a[0] < b[0] ? 1 : -1))) {
    const holiday = holidayName(d);
    const pct = Math.round(laborRules(d).rest * 100);
    alerts.push({
      tone: "neutral",
      text: `${dayLabel(d)}${holiday ? `, festivo de ${holiday}` : ""}: trabajaron ${joinNames([...ids].map(name))}. Recargo del ${pct} % y, si es habitual, un día de descanso en la semana.`,
    });
  }
  return alerts;
}
