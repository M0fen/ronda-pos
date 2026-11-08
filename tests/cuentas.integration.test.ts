import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Barra y cuentas contra una base real (PGlite en una carpeta temporal, con la demo sembrada): retener y mandar después,
 * alergias, repetir ronda, separar, mover, unir, cambiar de mesero, cortesías con motivo y anulaciones que barra y cocina ven.
 */

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
type Db = import("../lib/db-core").Db;

const dir = mkdtempSync(path.join(tmpdir(), "ronda-cuentas-"));
let db: Db;
let biz: string;
let pay: typeof import("../lib/server/payments");
let checks: typeof import("../lib/server/checks");
let valentina: Staff, juanPablo: Staff, camila: Staff, andres: Staff;
const products = new Map<string, string>();

beforeAll(async () => {
  process.env.PGLITE_DIR = dir;
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.VERCEL;
  db = await (await import("../lib/server/db")).getDb();
  pay = await import("../lib/server/payments");
  checks = await import("../lib/server/checks");
  biz = (await db.one<{ id: string }>("select id from businesses order by created_at limit 1"))!.id;
  const person = async (name: string) => (await db.one<Staff>("select id, business_id, name, role, color from staff where business_id = $1 and name = $2", [biz, name]))!;
  [valentina, juanPablo, camila, andres] = await Promise.all([person("Valentina"), person("Juan Pablo"), person("Camila"), person("Andrés")]);
  for (const p of await db.query<{ id: string; name: string }>("select id, name from products where business_id = $1", [biz])) products.set(p.name, p.id);
  if (!(await pay.currentCashSession(biz))) await pay.openCash(valentina, 200_000);
}, 180_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Una mesa libre de la sede (la demo trae varias ocupadas). */
async function freeTable(skip: string[] = []) {
  const floor = await checks.floorState(biz);
  const t = floor.tables.find((x) => !x.check && !skip.includes(x.id));
  if (!t) throw new Error("No hay mesas libres en la demo");
  return t;
}

async function tableCheck(lines: [string, number][], by: Staff = juanPablo, skip: string[] = []) {
  const table = await freeTable(skip);
  const id = await checks.openCheck(by, { kind: "mesa", tableId: table.id, guests: 2 });
  await checks.addItems(
    by,
    id,
    lines.map(([name, qty]) => ({ productId: products.get(name)!, qty })),
  );
  return { id, table };
}

async function items(checkId: string) {
  return db.query<{ id: string; name: string; qty: number; status: string; round: number; held: boolean; allergy: boolean; seat: number | null }>(
    "select id, name, qty, status, round, held, allergy, seat from check_items where check_id = $1 order by created_at, id",
    [checkId],
  );
}

describe("barra y cuentas", () => {
  it("lo retenido no sale con la ronda: barra y cocina lo ven anunciado y sale después como su propia ronda", async () => {
    const { id } = await tableCheck([
      ["Solomito Cheese", 1],
      ["Cheese burger clásica", 2],
    ]);
    const burger = (await items(id)).find((i) => i.name === "Cheese burger clásica")!;
    await checks.changeDraft(juanPablo, burger.id, { held: true, seat: 2 });
    const first = await checks.sendRound(juanPablo, id);
    expect(first.count).toBe(1);
    let rows = await items(id);
    expect(rows.find((i) => i.name === "Solomito Cheese")!.status).toBe("sent");
    expect(rows.find((i) => i.name === "Cheese burger clásica")).toMatchObject({ status: "draft", held: true, seat: 2 });
    // Sin nada nuevo, enviar avisa; lo retenido se manda aparte
    await expect(checks.sendRound(juanPablo, id)).rejects.toThrow(/nada nuevo/);
    const board = await checks.kdsBoard(biz, "cocina");
    const ticket = board.active.find((t) => t.checkId === id)!;
    expect(ticket.held).toEqual([{ name: "Cheese burger clásica", qty: 2 }]);
    const second = await checks.sendRound(juanPablo, id, { held: true });
    expect(second.round).toBe(2);
    rows = await items(id);
    expect(rows.find((i) => i.name === "Cheese burger clásica")).toMatchObject({ status: "sent", held: false, round: 2 });
  });

  it("una alergia pide decir a qué, y barra y cocina la ven", async () => {
    const { id } = await tableCheck([["Solomito Cheese", 1]]);
    const line = (await items(id))[0]!;
    await expect(checks.changeDraft(juanPablo, line.id, { allergy: true })).rejects.toThrow(/a qué es la alergia/);
    await checks.changeDraft(juanPablo, line.id, { allergy: true, note: "Alergia al maní" });
    await checks.sendRound(juanPablo, id);
    const board = await checks.kdsBoard(biz, null);
    const item = board.active.find((t) => t.checkId === id)!.items[0]!;
    expect(item).toMatchObject({ allergy: true, note: "Alergia al maní" });
  });

  it("repetir una ronda la deja por enviar, igual y al precio de hoy", async () => {
    const { id } = await tableCheck([["Coca-Cola lata", 2]]);
    await checks.sendRound(juanPablo, id);
    const r = await checks.repeatRound(juanPablo, id, 1);
    expect(r.units).toBe(2);
    const drafts = (await items(id)).filter((i) => i.status === "draft");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ name: "Coca-Cola lata", qty: 2 });
  });

  it("separar parte de una línea crea una cuenta aparte en la misma mesa; al pagar la principal, la aparte toma la mesa", async () => {
    const { id, table } = await tableCheck([
      ["Coca-Cola lata", 3],
      ["Agua", 1],
    ]);
    await checks.sendRound(juanPablo, id);
    const coke = (await items(id)).find((i) => i.name === "Coca-Cola lata")!;
    const child = await checks.moveItems(juanPablo, id, { items: [{ id: coke.id, qty: 1 }], to: { split: true } });
    expect(child.closed).toBe(false);
    expect(child.name).toBe("Cuenta 2");
    expect((await items(id)).find((i) => i.name === "Coca-Cola lata")!.qty).toBe(2);
    expect(await items(child.id)).toEqual([expect.objectContaining({ name: "Coca-Cola lata", qty: 1, status: "sent", round: 1 })]);

    let floor = await checks.floorState(biz);
    let tile = floor.tables.find((t) => t.id === table.id)!;
    expect(tile.check?.id).toBe(id);
    expect(tile.splits.map((s) => s.label)).toEqual([`Mesa ${table.name} · Cuenta 2`]);

    // La principal se cobra; la mesa sigue ocupada con la cuenta aparte, ahora como principal
    const { total } = (await checks.loadCheck(biz, id))!.totals;
    await pay.registerPayment(valentina, id, { method: "efectivo", amount: total, tip: 0 });
    await pay.closeCheck(valentina, id, { tipAnswer: "no", invoice: { kind: "consumidor" } });
    floor = await checks.floorState(biz);
    tile = floor.tables.find((t) => t.id === table.id)!;
    expect(tile.check?.id).toBe(child.id);
    expect(tile.check?.label).toBe(`Mesa ${table.name}`);
    expect(tile.splits).toHaveLength(0);
  });

  it("mover todo a una mesa libre cierra la cuenta de origen", async () => {
    const { id } = await tableCheck([["Agua", 2]]);
    await checks.sendRound(juanPablo, id);
    const target = await freeTable();
    const all = (await items(id)).map((i) => ({ id: i.id, qty: i.qty }));
    const moved = await checks.moveItems(juanPablo, id, { items: all, to: { tableId: target.id } });
    expect(moved.closed).toBe(true);
    expect((await checks.loadCheck(biz, id))!.status).toBe("void");
    const there = (await checks.floorState(biz)).tables.find((t) => t.id === target.id)!;
    expect(there.check?.id).toBe(moved.id);
    expect(there.check?.total).toBeGreaterThan(0);
  });

  it("unir dos mesas: los productos llegan como rondas nuevas, se suman las personas y la otra mesa se libera", async () => {
    const a = await tableCheck([["Agua", 1]]);
    await checks.sendRound(juanPablo, a.id);
    const b = await tableCheck([["Coca-Cola lata", 1]], camila, [a.table.id]);
    await checks.sendRound(camila, b.id);
    const before = (await checks.loadCheck(biz, a.id))!.totals.total + (await checks.loadCheck(biz, b.id))!.totals.total;
    await checks.mergeChecks(juanPablo, a.id, b.id);
    const merged = (await checks.loadCheck(biz, a.id))!;
    expect(merged.totals.total).toBe(before);
    expect(merged.guests).toBe(4);
    expect(merged.items.map((i) => i.round).sort()).toEqual([1, 2]);
    const gone = (await checks.loadCheck(biz, b.id))!;
    expect(gone).toMatchObject({ status: "merged", merged_into: a.id });
    expect((await checks.floorState(biz)).tables.find((t) => t.id === b.table.id)!.check).toBeNull();
    // Una cuenta con pagos no se une
    const c = await tableCheck([["Agua", 1]]);
    await checks.sendRound(juanPablo, c.id);
    await pay.registerPayment(valentina, c.id, { method: "efectivo", amount: 1000, tip: 0 });
    await expect(checks.mergeChecks(juanPablo, a.id, c.id)).rejects.toThrow(/ya tiene pagos/);
  });

  it("pasar la cuenta a otro mesero: quien la lleva puede; otro mesero necesita al encargado", async () => {
    const { id } = await tableCheck([["Agua", 1]]);
    await expect(checks.changeWaiter(camila, id, { staffId: camila.id })).rejects.toMatchObject({ fields: { auth: "manage" } });
    await checks.changeWaiter(camila, id, { staffId: camila.id, auth: { id: andres.id, pin: "1234" } });
    expect((await checks.loadCheck(biz, id))!.opened_by).toBe(camila.id);
    await checks.changeWaiter(camila, id, { staffId: juanPablo.id });
    expect((await checks.loadCheck(biz, id))!.opened_by).toBe(juanPablo.id);
    const log = await db.one("select 1 from audit_log where business_id = $1 and action = 'waiter_changed' and detail->>'authorizedBy' = 'Andrés'", [biz]);
    expect(log).toBeTruthy();
  });

  it("una cortesía pide el motivo y queda en la auditoría", async () => {
    const { id } = await tableCheck([["Agua", 1]]);
    await checks.sendRound(juanPablo, id);
    const line = (await items(id))[0]!;
    await expect(checks.toggleCourtesy(andres, line.id)).rejects.toThrow(/motivo/);
    await checks.toggleCourtesy(andres, line.id, { reason: "Cumpleaños" });
    const log = await db.one<{ detail: { reason: string } }>("select detail from audit_log where business_id = $1 and action = 'courtesy' order by created_at desc limit 1", [biz]);
    expect(log!.detail.reason).toBe("Cumpleaños");
  });

  it("lo anulado que barra o cocina tenía se ve en rojo hasta marcarlo como visto, y queda en el historial", async () => {
    const { id } = await tableCheck([["Solomito Cheese", 1]]);
    await checks.sendRound(juanPablo, id);
    const line = (await items(id))[0]!;
    await checks.voidItem(valentina, line.id, { reason: "El cliente cambió de opinión", waste: false });
    let board = await checks.kdsBoard(biz, "cocina");
    const notice = board.voids.find((v) => v.id === line.id)!;
    expect(notice).toMatchObject({ name: "Solomito Cheese", reason: "El cliente cambió de opinión", by: "Valentina", wasReady: false });
    await checks.kdsAckVoids(valentina, [line.id]);
    board = await checks.kdsBoard(biz, "cocina");
    expect(board.voids.find((v) => v.id === line.id)).toBeUndefined();
    const detail = (await checks.kdsDetail(biz, id))!;
    expect(detail.events.map((e) => e.text)).toEqual(expect.arrayContaining([expect.stringMatching(/^Anulado 1 Solomito Cheese: El cliente cambió de opinión/)]));
  });
});
