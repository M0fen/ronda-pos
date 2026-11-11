import { createHash } from "node:crypto";

/**
 * Documentos electrónicos ante la DIAN (Resolución 165 de 2023). Puro: arma el documento que se transmite, su código
 * único (CUDE o CUFE, SHA-384 con la receta de la DIAN), la dirección del QR y lo que falta para poder facturar.
 * El envío lo hace un proveedor tecnológico (lib/server/dian.ts); sin proveedor, todo queda simulado y se dice.
 */

/** pos: documento equivalente electrónico tiquete POS (consumidor final o identificado). fe: factura electrónica de venta. */
export type DianDocType = "pos" | "fe";
export type DianStatus = "simulado" | "pendiente" | "validado" | "rechazado";
export type DianEnvironment = "demo" | "pruebas" | "produccion";

/** Fabricante y nombre del software: van impresos en cada documento */
export const SOFTWARE = { maker: "PuntoNeutro", name: "Ronda" } as const;

export const DOC_TITLE: Record<DianDocType, string> = {
  pos: "Documento equivalente electrónico tiquete de máquina registradora con sistema POS",
  fe: "Factura electrónica de venta",
};
export const DOC_SHORT: Record<DianDocType, string> = { pos: "Tiquete POS electrónico", fe: "Factura electrónica" };
/** El código único: CUDE en los documentos equivalentes y las notas; CUFE en la factura */
export const CODE_LABEL: Record<DianDocType, string> = { pos: "CUDE", fe: "CUFE" };
/** Cómo se anula cada uno: el número anulado no se reutiliza */
export const NOTE_LABEL: Record<DianDocType, string> = { pos: "Nota de ajuste", fe: "Nota crédito" };

export interface DianIssuer {
  nit: string;
  legalName: string;
  tradeName: string;
  regime: "ordinario" | "simple";
  responsibilities: string;
  address: string;
  city: string;
  phone: string;
}

export interface DianResolution {
  number: string;
  prefix: string;
  from: number;
  to: number;
  validFrom: string;
  validTo: string;
}

export interface DianLine {
  code: string;
  description: string;
  qty: number;
  /** Precio unitario sin impuesto (con las opciones) */
  unitBase: number;
  taxRate: number;
  tax: number;
  /** Con impuesto */
  total: number;
}

export interface DianDocument {
  type: DianDocType;
  environment: DianEnvironment;
  prefix: string;
  number: number;
  /** Fecha y hora de generación (la de expedición la da la validación) */
  generatedAt: string;
  resolution: DianResolution;
  issuer: DianIssuer;
  buyer: { identified: boolean; doc: string; name: string; email: string | null };
  lines: DianLine[];
  /** La propina va aparte: no es base del impuesto */
  totals: { base: number; tax: number; tip: number; total: number };
  payments: { method: string; amount: number }[];
  software: { maker: string; name: string };
}

export const CONSUMIDOR_FINAL = "222222222222";

const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/** Fecha y hora de Bogotá en el formato de la DIAN: 2026-11-11 y 15:04:05-05:00 */
export function bogotaStamp(iso: string) {
  const d = new Date(new Date(iso).getTime() - 5 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return { date: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`, time: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}-05:00` };
}

/**
 * Código único con la receta de la DIAN: SHA-384 de número, fecha, hora, valor, impuestos (01 IVA, 04 INC, 03 ICA),
 * total, NIT del emisor, documento del adquirente, clave (técnica o PIN del software) y ambiente (1 producción, 2 pruebas).
 */
export function uniqueCode(doc: Pick<DianDocument, "prefix" | "number" | "generatedAt" | "totals" | "issuer" | "buyer" | "environment">, key: string) {
  const { date, time } = bogotaStamp(doc.generatedAt);
  const parts = [
    `${doc.prefix}${doc.number}`,
    date,
    time,
    money(doc.totals.base),
    "01",
    money(0),
    "04",
    money(doc.totals.tax),
    "03",
    money(0),
    money(doc.totals.base + doc.totals.tax),
    doc.issuer.nit.replace(/\D/g, ""),
    doc.buyer.doc.replace(/\D/g, ""),
    key,
    doc.environment === "produccion" ? "1" : "2",
  ];
  return createHash("sha384").update(parts.join("")).digest("hex");
}

/** El QR del documento lleva a la consulta de la DIAN (habilitación en pruebas) */
export function dianQrUrl(code: string, environment: DianEnvironment) {
  const host = environment === "produccion" ? "catalogo-vpfe.dian.gov.co" : "catalogo-vpfe-hab.dian.gov.co";
  return `https://${host}/document/searchqr?documentkey=${code}`;
}

/** Lo que falta para que el documento salga bien. Vacío: listo. */
export function readiness(doc: Pick<DianDocument, "issuer" | "resolution" | "type"> & { lines?: Pick<DianLine, "code" | "description">[] }): string[] {
  const out: string[] = [];
  const i = doc.issuer;
  if (!/^\d{6,10}(-\d)?$/.test(i.nit.replace(/[.\s]/g, ""))) out.push("El NIT del local, con dígito de verificación (Ajustes → El local)");
  if (i.legalName.trim().length < 3) out.push("La razón social (Ajustes → El local)");
  if (i.address.trim().length < 5) out.push("La dirección del local (Ajustes → El local)");
  if (!i.responsibilities.trim()) out.push("Las responsabilidades tributarias del RUT (Ajustes → Facturación)");
  const r = doc.resolution;
  const name = doc.type === "fe" ? "de factura electrónica" : "del tiquete POS electrónico";
  if (!r.number.trim()) out.push(`El número de la resolución ${name}`);
  if (!r.prefix) out.push(`El prefijo de la resolución ${name}`);
  if (!r.to || r.to < r.from) out.push(`El rango autorizado de la resolución ${name}`);
  if (!r.validTo) out.push(`La vigencia de la resolución ${name}`);
  const missing = (doc.lines ?? []).filter((l) => !l.code.trim()).map((l) => l.description);
  if (missing.length) out.push(`Código de producto para ${[...new Set(missing)].slice(0, 4).join(", ")}${missing.length > 4 ? "…" : ""} (Carta → el producto)`);
  return out;
}
