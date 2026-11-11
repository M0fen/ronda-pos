import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Reportes contra la demo sembrada: cuadran con las facturas, las propinas y lo que queda en el registro. */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));

type Staff = import("../lib/server/auth").Staff;
type Db = import("../lib/db-core").Db;

const dir = mkdtempSync(path.join(tmpdir(), "ronda-reportes-"));
let db: Db;
let biz: string;
let reports: typeof import("../lib/server/reports");
let checks: typeof import("../lib/server/checks");
let today: string, from: string;

beforeAll(async () => {
  process.env.PGLITE_DIR = dir;
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.VERCEL;
  db = await (await import("../lib/server/db")).getDb();
  reports = await import("../lib/server/reports");
  checks = await import("../lib/server/checks");
  const time = await import("../lib/core/time");
  today = time.jornadaKey();
  from = time.addDays(today, -13);
  biz = (await db.one<{ id: string }>("select id from businesses order by created_at limit 1"))!.id;
}, 180_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("reportes", () => {
  it("las ventas por plato cuadran con lo facturado sin impuesto", async () => {
    const dishes = await reports.dishSales(biz, from, today);
    const net = dishes.reduce((s, d) => s + d.net, 0);
    const billed = (await db.one<{ base: number }>(
      `select coalesce(sum(v.subtotal), 0)::int as base from invoices v join checks c on c.id = v.check_id
        where c.business_id = $1 and c.status = 'paid' and v.voided_at is null and ${reports.JORNADA("c.closed_at")} between $2::date and $3::date`,
      [biz, from, today],
    ))!.base;
    expect(billed).toBeGreaterThan(0);
    // Redondeos por línea: la diferencia es de pesos, no de puntos porcentuales
    expect(Math.abs(net - billed) / billed).toBeLessThan(0.005);
    expect(dishes.every((d) => d.cost >= 0 && d.units > 0)).toBe(true);
  });

  it("la propina se reparte completa entre quienes trabajaron", async () => {
    const r = await reports.tipShares(biz, from, today, { split: "horas", roles: ["waiter", "bar", "cashier"] });
    expect(r.total).toBeGreaterThan(0);
    expect(r.shares.length).toBeGreaterThan(0);
    expect(r.shares.reduce((s, p) => s + p.amount, 0)).toBe(r.total);
    // Sin nadie de esos cargos no hay a quién repartir
    expect((await reports.tipShares(biz, from, today, { split: "horas", roles: [] })).shares).toEqual([]);
  });

  it("los tiempos de barra y cocina salen de lo marcado como listo", async () => {
    const k = await reports.kitchenTimes(biz, from, today, { barra: 12, cocina: 20 });
    const cocina = k.stations.find((s) => s.station === "cocina")!;
    expect(cocina.count).toBeGreaterThan(0);
    expect(cocina.avg).toBeGreaterThan(0);
    expect(cocina.p90).toBeGreaterThanOrEqual(0);
    expect(cocina.latePct).toBeGreaterThanOrEqual(0);
  });

  it("control: una anulación sale con quién la pidió, quién autorizó y el motivo", async () => {
    const person = async (name: string) => (await db.one<Staff>("select id, business_id, name, role, color from staff where business_id = $1 and name = $2", [biz, name]))!;
    const [juanPablo, valentina] = [await person("Juan Pablo"), await person("Valentina")];
    const floor = await checks.floorState(biz);
    const zone = (await db.one<{ id: string }>("select id from zones where business_id = $1 limit 1", [biz]))!.id;
    let table = floor.tables.find((t) => !t.check);
    if (!table) {
      await db.query("insert into floor_tables (business_id, zone_id, name, seats, qr_token) values ($1, $2, 'R1', 2, 'prueba-reportes-1')", [biz, zone]);
      table = (await checks.floorState(biz)).tables.find((t) => !t.check)!;
    }
    const product = (await db.one<{ id: string }>("select id from products where business_id = $1 and name = 'Antojo de patatas'", [biz]))!.id;
    const id = await checks.openCheck(juanPablo, { kind: "mesa", tableId: table.id, guests: 1 });
    await checks.addItems(juanPablo, id, [{ productId: product, qty: 1 }]);
    await checks.sendRound(juanPablo, id);
    const line = (await db.one<{ id: string }>("select id from check_items where check_id = $1", [id]))!.id;
    const valentinaPin = { id: valentina.id, pin: "2222" };
    await checks.voidItem(juanPablo, line, { reason: "Salió mal preparado", waste: true, auth: valentinaPin });
    const c = await reports.controlReport(biz, today, today);
    expect(c.totals.void!.count).toBeGreaterThanOrEqual(1);
    const ev = c.events.find((e) => e.action === "void" && e.reason === "Salió mal preparado")!;
    expect(ev).toMatchObject({ who: "Juan Pablo", authorizedBy: "Valentina", item: "Antojo de patatas" });
    expect(c.people.find((p) => p.name === "Juan Pablo")!.byAction.void).toBeGreaterThanOrEqual(1);
    expect(c.reasons.some((r) => r.reason === "Salió mal preparado")).toBe(true);
  });
});
