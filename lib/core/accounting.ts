/**
 * Exportación para el contador y diferencias de inventario. Puro: sin base de datos.
 * El CSV abre bien en Excel en Colombia: punto y coma (la coma es el decimal), BOM para las tildes y fin de línea de Windows.
 */

type Cell = string | number | null | undefined;

/** Un texto que empieza con =, +, - o @ lo ejecutaría Excel como fórmula: se le antepone un apóstrofo. */
const safeText = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

export function toCsv(rows: Cell[][], sep = ";") {
  const cell = (v: Cell) => {
    if (v == null) return "";
    const s = typeof v === "number" ? String(v) : safeText(v);
    return s.includes(sep) || /["\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${rows.map((r) => r.map(cell).join(sep)).join("\r\n")}\r\n`;
}

/** Mes calendario en Bogotá ("2026-10") como instantes: del día 1 a las 0:00 al día 1 del mes siguiente. */
export function monthBounds(month: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new Error(`Mes inválido: ${month}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  return { from: `${month}-01T00:00:00-05:00`, to: `${next}-01T00:00:00-05:00` };
}

/** El mes de una fecha en Bogotá y el anterior: "2026-11" y "2026-10". */
export function monthsAround(now: Date) {
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit" }).format(now).slice(0, 7);
  const [y, m] = key.split("-").map(Number) as [number, number];
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  return { current: key, previous: prev };
}

export interface AccountingDoc {
  /** Fecha y hora del documento (la de la nota, si es nota) */
  at: string;
  kind: "pos" | "fe" | "ajuste" | "credito";
  number: string;
  customer: string;
  customerDoc: string;
  base: number;
  tax: number;
  tip: number;
  total: number;
  payments: { method: string; amount: number }[];
  dian: string;
  code: string;
  /** Una nota: el documento que anula */
  ref: string;
  reason: string;
}

export const DOC_KIND_LABEL: Record<AccountingDoc["kind"], string> = {
  pos: "Tiquete POS electrónico",
  fe: "Factura electrónica",
  ajuste: "Nota de ajuste",
  credito: "Nota crédito",
};

export const DIAN_STATUS_LABEL: Record<string, string> = {
  simulado: "Simulado (sin enviar a la DIAN)",
  pendiente: "Pendiente",
  validado: "Validado",
  rechazado: "Rechazado",
};

export const ACCOUNTING_HEADERS = [
  "Fecha",
  "Hora",
  "Documento",
  "Número",
  "Cliente",
  "Identificación",
  "Base",
  "Impuesto",
  "Propina",
  "Total",
  "Medios de pago",
  "Estado DIAN",
  "CUDE o CUFE",
  "Anula a",
  "Motivo",
];

const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" });
const hour = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Una fila por documento, en orden de fecha. Las notas van en negativo. La propina va aparte: no es ingreso del local. */
export function accountingCsv(docs: AccountingDoc[], methodLabel: Record<string, string> = {}) {
  const sorted = [...docs].sort((a, b) => a.at.localeCompare(b.at));
  const rows: Cell[][] = [ACCOUNTING_HEADERS];
  for (const d of sorted) {
    const at = new Date(d.at);
    rows.push([
      day.format(at),
      hour.format(at),
      DOC_KIND_LABEL[d.kind],
      d.number,
      d.customer,
      d.customerDoc,
      d.base,
      d.tax,
      d.tip,
      d.total,
      d.payments.map((p) => `${methodLabel[p.method] ?? p.method} ${p.amount}`).join(" + "),
      DIAN_STATUS_LABEL[d.dian] ?? d.dian,
      d.code,
      d.ref,
      d.reason,
    ]);
  }
  return toCsv(rows);
}

/**
 * Diferencias de inventario de un insumo en un período: lo que debió salir por las recetas de lo vendido, la merma
 * que alguien registró y lo que faltó (negativo) o sobró al contar. Real = recetas + merma − diferencia del conteo.
 */
export interface VarianceInput {
  id: string;
  name: string;
  unit: string;
  cost: number;
  /** Suma de movimientos por motivo en el período (negativo = salió) */
  venta: number;
  anulacion: number;
  merma: number;
  conteo: number;
  ajuste: number;
}

export interface VarianceRow {
  id: string;
  name: string;
  unit: string;
  /** Lo que debió salir por recetas (positivo) */
  theoretical: number;
  /** Merma registrada (positivo) */
  waste: number;
  /** Diferencia al contar: negativo = faltó, positivo = sobró */
  counted: number;
  /** Lo que salió de verdad (positivo) */
  real: number;
  /** Valor en pesos de la diferencia al contar (negativo = pérdida) */
  countValue: number;
  wasteValue: number;
  theoreticalValue: number;
}

export function inventoryVariance(items: VarianceInput[]) {
  const rows: VarianceRow[] = items.map((i) => {
    const theoretical = Math.max(0, -(i.venta + i.anulacion));
    const waste = Math.max(0, -i.merma);
    const counted = i.conteo + i.ajuste;
    const real = theoretical + waste - counted;
    return {
      id: i.id,
      name: i.name,
      unit: i.unit,
      theoretical,
      waste,
      counted,
      real,
      countValue: Math.round(counted * i.cost),
      wasteValue: Math.round(waste * i.cost),
      theoreticalValue: Math.round(theoretical * i.cost),
    };
  });
  const totals = {
    theoreticalValue: rows.reduce((s, r) => s + r.theoreticalValue, 0),
    wasteValue: rows.reduce((s, r) => s + r.wasteValue, 0),
    // Lo que faltó y lo que sobró se muestran por separado: uno no tapa al otro
    missingValue: rows.reduce((s, r) => s + Math.min(0, r.countValue), 0),
    extraValue: rows.reduce((s, r) => s + Math.max(0, r.countValue), 0),
  };
  // Primero lo que más plata representa: faltantes y merma
  const notable = rows
    .filter((r) => r.counted !== 0 || r.waste !== 0)
    .sort((a, b) => Math.min(0, a.countValue) - a.wasteValue - (Math.min(0, b.countValue) - b.wasteValue) || a.name.localeCompare(b.name));
  return { rows: notable, totals, counted: rows.filter((r) => r.counted !== 0).length };
}
