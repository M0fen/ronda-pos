/**
 * CSV para el contador, como lo abre Excel en Colombia: separador ";", UTF-8 con BOM y saltos CRLF.
 * Los decimales van con coma. Puro: sin React ni base de datos, con pruebas en tests/csv.test.ts.
 */

export type CsvCell = string | number | boolean | null | undefined;

/** Una celda lista para el archivo: comillas solo cuando hacen falta; los números con coma decimal. */
export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value).replace(".", ",") : "";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  const s = String(value);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** El archivo completo. El BOM hace que Excel lo abra en UTF-8 (tildes y eñes bien). */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers, ...rows].map((r) => r.map(csvCell).join(";"));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

const BOGOTA_OFFSET = -5 * 3_600_000;

/** "2026-11-08 21:35" en hora de Bogotá, para ordenar y filtrar en Excel sin pelear con formatos. */
export function csvStamp(d: Date | string | null | undefined): string {
  if (!d) return "";
  const t = new Date(d).getTime();
  if (!Number.isFinite(t)) return "";
  return new Date(t + BOGOTA_OFFSET).toISOString().slice(0, 16).replace("T", " ");
}

/** Nombre de archivo sin caracteres raros: ronda-ventas-2026-11-01-a-2026-11-08.csv */
export function csvFilename(kind: string, from: string, to: string, suffix = "") {
  const range = from === to ? from : `${from}-a-${to}`;
  return `ronda-${kind}-${range}${suffix ? `-${suffix}` : ""}.csv`.replace(/[^a-z0-9.-]/gi, "-");
}
