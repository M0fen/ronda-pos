/**
 * Motor de precios. Puro: no depende de React ni de la base, y tiene pruebas (tests/pricing.test.ts).
 * Reglas: pesos enteros, precios con impuesto incluido, el impuesto se saca por línea y la suma cuadra
 * al peso con el total. La propina va aparte: no es base del impuesto.
 */

export interface PricedModifier {
  name: string;
  price: number;
}

export interface PricedLine {
  /** Precio unitario con impuesto incluido (ya con happy hour si aplica). */
  unitPrice: number;
  qty: number;
  modifiers?: PricedModifier[];
  /** 8 = 8 % */
  taxRate: number;
  courtesy?: boolean;
  status?: string;
}

export interface TaxGroup {
  rate: number;
  base: number;
  tax: number;
}

export interface CheckTotals {
  /** Suma de líneas antes de descuento */
  gross: number;
  discount: number;
  /** Lo que paga el cliente sin propina */
  total: number;
  base: number;
  tax: number;
  taxes: TaxGroup[];
  units: number;
}

export function unitWithModifiers(line: Pick<PricedLine, "unitPrice" | "modifiers">) {
  return line.unitPrice + (line.modifiers ?? []).reduce((s, m) => s + Math.max(0, Math.round(m.price)), 0);
}

export function lineGross(line: PricedLine) {
  if (line.status === "void" || line.courtesy) return 0;
  return unitWithModifiers(line) * Math.max(0, Math.floor(line.qty));
}

/** Separa base e impuesto de un valor con impuesto incluido. $8.000 al 8 % = base $7.407 + impuesto $593. */
export function splitTax(gross: number, rate: number) {
  if (!rate) return { base: gross, tax: 0 };
  const base = Math.round(gross / (1 + rate / 100));
  return { base, tax: gross - base };
}

export function checkTotals(lines: PricedLine[], discountPct = 0): CheckTotals {
  const pct = Math.min(100, Math.max(0, discountPct));
  const groups = new Map<number, TaxGroup>();
  let gross = 0;
  let total = 0;
  let units = 0;
  for (const line of lines) {
    const g = lineGross(line);
    if (line.status !== "void") units += line.qty;
    if (!g) continue;
    const net = g - Math.round((g * pct) / 100);
    gross += g;
    total += net;
    const { base, tax } = splitTax(net, line.taxRate);
    const group = groups.get(line.taxRate) ?? { rate: line.taxRate, base: 0, tax: 0 };
    group.base += base;
    group.tax += tax;
    groups.set(line.taxRate, group);
  }
  const taxes = [...groups.values()].sort((a, b) => b.rate - a.rate);
  return {
    gross,
    discount: gross - total,
    total,
    base: taxes.reduce((s, t) => s + t.base, 0),
    tax: taxes.reduce((s, t) => s + t.tax, 0),
    taxes,
    units,
  };
}

/** Propina sugerida redondeada a $100. La ley la limita al 10 %. */
export function suggestedTip(total: number, pct: number) {
  const p = Math.min(10, Math.max(0, pct));
  return Math.round((total * p) / 100 / 100) * 100;
}

/** Partes iguales en pesos redondos: las primeras se redondean a $100 y la última cuadra el total. */
export function splitEqual(total: number, parts: number) {
  const n = Math.max(1, Math.floor(parts));
  if (n === 1) return [total];
  const per = Math.ceil(total / n / 100) * 100;
  const last = total - per * (n - 1);
  if (last > 0) return [...Array.from({ length: n - 1 }, () => per), last];
  const exact = Math.floor(total / n);
  const rem = total - exact * n;
  return Array.from({ length: n }, (_, i) => exact + (i < rem ? 1 : 0));
}

/**
 * Reparte un valor en proporción a unos pesos: la propina según lo que consumió cada quien en "Cada quien lo suyo".
 * Cada parte se redondea a `step` ($100) y la última con peso cuadra el total, como en partes iguales.
 * Quien no tiene peso recibe 0. Con step 1 reparte al peso (lo de cada persona cuando la cuenta tiene descuento).
 */
export function splitProportional(total: number, weights: number[], step = 100) {
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const out = w.map(() => 0);
  const amount = Math.max(0, Math.round(Number(total) || 0));
  if (!out.length || !amount) return out;
  const sum = w.reduce((a, b) => a + b, 0);
  // Nadie tiene peso: no hay proporción que seguir; queda en la primera parte para que no se pierda
  if (!sum) {
    out[0] = amount;
    return out;
  }
  const last = w.reduce((found, x, i) => (x > 0 ? i : found), 0);
  const unit = Math.max(1, Math.floor(step));
  let left = amount;
  w.forEach((x, i) => {
    if (i === last || !x) return;
    const part = Math.min(left, Math.round((amount * x) / sum / unit) * unit);
    out[i] = part;
    left -= part;
  });
  out[last] = left;
  return out;
}

/** Billetes con los que suele pagar alguien: el valor exacto y los siguientes redondos. */
export function cashSuggestions(due: number) {
  if (due <= 0) return [];
  const options = new Set<number>([due]);
  for (const step of [1000, 5000, 10000, 20000, 50000, 100000]) {
    const v = Math.ceil(due / step) * step;
    if (v > due) options.add(v);
  }
  return [...options].sort((a, b) => a - b).slice(0, 4);
}

export function change(received: number, due: number) {
  return Math.max(0, received - due);
}

/**
 * Lo que falta por pagar de una cuenta (sin propina) según los pagos registrados. Solo cuentan los pagos en firme ("ok", o sin
 * estado): uno pendiente, rechazado o quitado no resta, y un estado nuevo tampoco hasta que se agregue aquí.
 */
export function balance(total: number, payments: { amount: number; status?: string }[]) {
  const paid = payments.filter((p) => !p.status || p.status === "ok").reduce((s, p) => s + p.amount, 0);
  return { paid, due: Math.max(0, total - paid) };
}

export interface LoyaltyRule {
  minPurchase: number;
  goal: number;
}

/** Un sello por visita que supere el mínimo. */
export function stampsEarned(total: number, rule: LoyaltyRule) {
  return total >= rule.minPurchase ? 1 : 0;
}
