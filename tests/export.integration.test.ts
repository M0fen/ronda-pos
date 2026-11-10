import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Exportar para el contador contra la demo sembrada: cada archivo sale con sus columnas y con filas de las dos semanas de ventas. */

const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined),
    set: (k: string, v: string) => void jar.set(k, v),
    delete: (k: string) => void jar.delete(k),
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));

type Staff = import("../lib/server/auth").Staff;

const dir = mkdtempSync(path.join(tmpdir(), "ronda-export-"));
let exportCsv: typeof import("../lib/server/export").exportCsv;
let andres: Staff, valentina: Staff, daniela: Staff;
let today: string;
let from: string;

beforeAll(async () => {
  process.env.PGLITE_DIR = dir;
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.VERCEL;
  const db = await (await import("../lib/server/db")).getDb();
  ({ exportCsv } = await import("../lib/server/export"));
  const { addDays, jornadaKey } = await import("../lib/core/time");
  today = jornadaKey();
  from = addDays(today, -13);
  const person = async (name: string) => (await db.one<Staff>("select id, business_id, name, role, color from staff where name = $1 order by created_at limit 1", [name]))!;
  [andres, valentina, daniela] = await Promise.all([person("Andrés"), person("Valentina"), person("Daniela")]);
}, 180_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const lines = (csv: string) => csv.replace(/^﻿/, "").trimEnd().split("\r\n");

describe("exportar para el contador", () => {
  it("ventas: una fila por factura, con base e impuesto que cuadran con el total", async () => {
    const r = await exportCsv(andres, { kind: "ventas", from, to: today });
    const rows = lines(r.content);
    expect(rows[0]).toContain("Jornada;Fecha y hora;Sede;Documento;Estado");
    expect(r.rows).toBeGreaterThan(50);
    expect(r.filename).toBe(`ronda-ventas-${from}-a-${today}.csv`);
    const cols = rows[0]!.split(";");
    const base = cols.indexOf("Base gravable");
    const tax = cols.indexOf("Impuesto");
    const gross = cols.indexOf("Total con impuesto");
    const tip = cols.indexOf("Propina");
    const total = cols.indexOf("Total pagado");
    for (const line of rows.slice(1, 40)) {
      const c = line.split(";");
      expect(Number(c[base]) + Number(c[tax])).toBe(Number(c[gross]));
      expect(Number(c[gross]) + Number(c[tip])).toBe(Number(c[total]));
    }
  }, 60_000);

  it("impuestos: base e impuesto por jornada y tarifa, y la suma coincide con las ventas vigentes", async () => {
    const [imp, ven] = await Promise.all([exportCsv(andres, { kind: "impuestos", from, to: today }), exportCsv(andres, { kind: "ventas", from, to: today })]);
    const rows = lines(imp.content);
    expect(rows[0]).toBe("Jornada;Sede;Tarifa %;Base gravable;Impuesto;Total con impuesto;Cuentas");
    expect(imp.rows).toBeGreaterThan(5);
    const taxTotal = rows.slice(1).reduce((s, l) => s + Number(l.split(";")[4]), 0);
    const vcols = lines(ven.content)[0]!.split(";");
    const ti = vcols.indexOf("Impuesto");
    const st = vcols.indexOf("Estado");
    const fromInvoices = lines(ven.content)
      .slice(1)
      .filter((l) => l.split(";")[st] === "Vigente")
      .reduce((s, l) => s + Number(l.split(";")[ti]), 0);
    expect(taxTotal).toBe(fromInvoices);
  }, 60_000);

  it("propinas, caja y compras salen con sus columnas", async () => {
    const tips = await exportCsv(andres, { kind: "propinas", from, to: today });
    expect(lines(tips.content)[0]).toBe("Jornada;Sede;Atendió;Cuentas;Ventas netas;Propinas");
    expect(tips.rows).toBeGreaterThan(5);
    const cash = await exportCsv(andres, { kind: "caja", from, to: today });
    expect(lines(cash.content)[0]).toContain("Jornada;Sede;Abrió;Cerró;Quién abrió");
    expect(cash.rows).toBeGreaterThan(0);
    const buys = await exportCsv(andres, { kind: "compras", from, to: today });
    expect(lines(buys.content)[0]).toContain("Jornada;Fecha y hora;Sede;Movimiento;Insumo");
  }, 60_000);

  it("el dueño saca todas las sedes; la administradora solo la suya; caja no exporta", async () => {
    const all = await exportCsv(andres, { kind: "ventas", from, to: today, allSedes: true });
    const one = await exportCsv(andres, { kind: "ventas", from, to: today });
    expect(all.rows).toBeGreaterThan(one.rows);
    expect(all.filename).toContain("todas-las-sedes");
    const sedes = new Set(lines(all.content).slice(1).map((l) => l.split(";")[2]));
    expect(sedes.size).toBeGreaterThan(1);
    const mine = await exportCsv(daniela, { kind: "ventas", from, to: today, allSedes: true });
    expect(new Set(lines(mine.content).slice(1).map((l) => l.split(";")[2])).size).toBe(1);
    await expect(exportCsv(valentina, { kind: "ventas", from, to: today })).rejects.toThrow(/dueño o el administrador/);
  }, 60_000);

  it("rechaza fechas al revés, rangos de más de un año y archivos que no existen", async () => {
    await expect(exportCsv(andres, { kind: "ventas", from: today, to: from })).rejects.toThrow(/mayor que la final/);
    await expect(exportCsv(andres, { kind: "ventas", from: "2020-01-01", to: today })).rejects.toThrow(/un año/);
    await expect(exportCsv(andres, { kind: "nomina", from, to: today })).rejects.toThrow(/qué exportar/);
  });
});
