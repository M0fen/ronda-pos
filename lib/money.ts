const formatter = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

/** Pesos colombianos: $32.900 */
export function cop(value: number) {
  const n = Math.round(value);
  return `${n < 0 ? "−" : ""}$${formatter.format(Math.abs(n))}`;
}

/** Convierte "$32.900", "32900" o 32900 en un entero de pesos. */
export function parsePesos(value: unknown): number {
  if (typeof value === "number") return Math.round(value);
  if (typeof value !== "string") return 0;
  const clean = value.replace(/[^\d-]/g, "");
  const n = parseInt(clean, 10);
  return Number.isFinite(n) ? n : 0;
}

export function parseOptionalPesos(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = parsePesos(value);
  return n > 0 ? n : null;
}

export function percent(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

/**
 * Lee una cantidad escrita como en Colombia: punto de miles y coma decimal.
 * "2.400" = 2400, "2,5" = 2,5, "1.234,5" = 1234,5. Un punto que no separa miles ("2.5") se toma como decimal.
 */
export function parseQty(text: string) {
  const s = String(text ?? "").trim().replace(/\s/g, "");
  if (!s) return NaN;
  if (s.includes(",")) return Number(s.replace(/\./g, "").replace(",", "."));
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ""));
  return Number(s);
}
