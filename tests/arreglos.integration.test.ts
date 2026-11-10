import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Arreglos de plata, concurrencia y operación contra una base real (PGlite en una carpeta temporal, con la demo sembrada):
 * la llave de intento del cobro, «efectivo exacto y cerrar» en una sola transacción, rentabilidad con cuentas refacturadas,
 * el premio de sellos con adiciones, opciones sin precio negativo, el arqueo a ciegas y la guardia de db.tx.
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

const dir = mkdtempSync(path.join(tmpdir(), "ronda-arreglos-"));
let db: Db;
let biz: string;
let pay: typeof import("../lib/server/payments");
let checks: typeof import("../lib/server/checks");
let valentina: Staff, juanPablo: Staff, andres: Staff;
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
  [valentina, juanPablo, andres] = await Promise.all([person("Valentina"), person("Juan Pablo"), person("Andrés")]);
  for (const p of await db.query<{ id: string; name: string }>("select id, name from products where business_id = $1", [biz])) products.set(p.name, p.id);
  if (!(await pay.currentCashSession(biz))) await pay.openCash(valentina, 200_000);
}, 180_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function newCheck(lines: [string, number][], by: Staff = juanPablo) {
  const id = await checks.openCheck(by, { kind: "barra", name: "Prueba" });
  await checks.addItems(
    by,
    id,
    lines.map(([name, qty]) => ({ productId: products.get(name)!, qty })),
  );
  await checks.sendRound(by, id);
  return id;
}

async function state(id: string) {
  const view = (await checks.loadCheck(biz, id))!;
  const rows = await db.query<{ status: string; attempt_key: string | null }>("select status, attempt_key from payments where check_id = $1 order by created_at", [id]);
  const invoices = await db.query<{ id: string }>("select id from invoices where check_id = $1", [id]);
  return { total: view.totals.total, due: view.due, paid: view.paid, status: view.status, ok: rows.filter((r) => r.status === "ok").length, invoices: invoices.length };
}

const key = () => `intento-${randomUUID()}`;
const consumer = { tipAnswer: "no" as const, invoice: { kind: "consumidor" as const } };

describe("llave de intento del cobro", () => {
  it("el mismo intento dos veces deja un solo pago y responde lo mismo", async () => {
    const id = await newCheck([["Coca-Cola lata", 3]]);
    const { total } = await state(id);
    const attemptKey = key();
    const input = { method: "efectivo", amount: 5000, tip: 0, received: 10_000, part: "Parte 1 de 3", attemptKey };
    const first = await pay.registerPayment(valentina, id, input);
    expect(first).toEqual({ change: 5000, due: total - 5000, repeated: false });
    // Se cayó la red, la respuesta no llegó y la pantalla lo vuelve a mandar con la misma llave
    const again = await pay.registerPayment(valentina, id, input);
    expect(again).toEqual({ change: 5000, due: total - 5000, repeated: true });
    expect(await state(id)).toMatchObject({ ok: 1, paid: 5000 });
    // Otra llave es otro pago (la parte 2), y sin llave se cobra como siempre
    await pay.registerPayment(valentina, id, { ...input, part: "Parte 2 de 3", attemptKey: key() });
    await pay.registerPayment(valentina, id, { method: "efectivo", amount: 5000, tip: 0, part: "Parte 3 de 3" });
    expect(await state(id)).toMatchObject({ ok: 3, paid: 15_000, due: total - 15_000 });
  });

  it("dos toques a la vez con la misma llave: un solo pago", async () => {
    const id = await newCheck([["Agua", 2]]);
    const input = { method: "tarjeta", amount: 4000, tip: 0, reference: "481516", attemptKey: key() };
    const results = await Promise.all([pay.registerPayment(valentina, id, input), pay.registerPayment(juanPablo, id, input)]);
    expect(results.map((r) => r.repeated).sort()).toEqual([false, true]);
    expect(await state(id)).toMatchObject({ ok: 1, paid: 4000 });
  });

  it("el reintento de un pago que completó la cuenta no falla con «solo falta pagar»", async () => {
    const id = await newCheck([["Agua", 1]]);
    const { total } = await state(id);
    const input = { method: "efectivo", amount: total, tip: 0, attemptKey: key() };
    await pay.registerPayment(valentina, id, input);
    expect(await pay.registerPayment(valentina, id, input)).toEqual({ change: 0, due: 0, repeated: true });
    expect(await state(id)).toMatchObject({ ok: 1, due: 0 });
  });

  it("un pago quitado no revive con su llave, y una llave no sirve en otra cuenta", async () => {
    const id = await newCheck([["Agua", 2]]);
    const input = { method: "efectivo", amount: 4000, tip: 0, attemptKey: key() };
    await pay.registerPayment(valentina, id, input);
    const other = await newCheck([["Agua", 1]]);
    await expect(pay.registerPayment(valentina, other, input)).rejects.toThrow(/otra cuenta/);
    expect(await state(other)).toMatchObject({ ok: 0 });
    const payment = (await db.one<{ id: string }>("select id from payments where check_id = $1 and status = 'ok'", [id]))!;
    await pay.removePayment(valentina, payment.id, { reason: "Se registró dos veces" });
    await expect(pay.registerPayment(valentina, id, input)).rejects.toThrow(/después se quitó/);
    expect(await state(id)).toMatchObject({ ok: 0, paid: 0 });
  });

  it("una llave mal formada se rechaza sin cobrar", async () => {
    const id = await newCheck([["Agua", 1]]);
    await expect(pay.registerPayment(valentina, id, { method: "efectivo", amount: 4000, tip: 0, attemptKey: "x" })).rejects.toThrow(/identificar/);
    await expect(pay.registerPayment(valentina, id, { method: "efectivo", amount: 4000, tip: 0, attemptKey: "'; drop table payments; --" })).rejects.toThrow(/identificar/);
    expect(await state(id)).toMatchObject({ ok: 0 });
  });
});

describe("efectivo exacto y cerrar en un solo paso", () => {
  it("el pago y la factura quedan juntos, y el reintento devuelve la misma factura", async () => {
    const id = await newCheck([["Agua", 2]]);
    const { total } = await state(id);
    const input = { payment: { method: "efectivo", amount: total, tip: 1000, received: total + 1000, attemptKey: key() }, close: { tipAnswer: "si" as const, invoice: { kind: "consumidor" as const } } };
    const done = await pay.payAndClose(valentina, id, input);
    expect(done).toMatchObject({ change: 0, due: 0, repeated: false, closed: true });
    expect(done.invoiceId).toBeTruthy();
    expect(await state(id)).toMatchObject({ status: "paid", ok: 1, invoices: 1 });
    const inv = (await db.one<{ tip: number; total: number }>("select tip, total from invoices where id = $1", [done.invoiceId]))!;
    expect(inv).toEqual({ tip: 1000, total: total + 1000 });
    // La respuesta se perdió y la pantalla reintenta: ni otro pago ni otra factura
    const again = await pay.payAndClose(valentina, id, input);
    expect(again).toMatchObject({ change: 0, due: 0, repeated: true, closed: true, invoiceId: done.invoiceId });
    expect(await state(id)).toMatchObject({ status: "paid", ok: 1, invoices: 1 });
  });

  it("si el cierre falla, tampoco queda el pago", async () => {
    const id = await newCheck([["Agua", 2]]);
    const { total } = await state(id);
    const payment = { method: "efectivo", amount: total, tip: 0, attemptKey: key() };
    // Factura con NIT sin el número: el cierre no pasa y el pago no queda suelto en una cuenta abierta
    await expect(pay.payAndClose(valentina, id, { payment, close: { tipAnswer: "no", invoice: { kind: "nit", doc: "", name: "" } } })).rejects.toThrow(/NIT/);
    expect(await state(id)).toMatchObject({ status: "open", ok: 0, paid: 0, invoices: 0 });
    // Un pago que no completa la cuenta tampoco se queda a medias
    await expect(pay.payAndClose(valentina, id, { payment: { ...payment, amount: total - 1000, attemptKey: key() }, close: consumer })).rejects.toThrow(/Faltan/);
    expect(await state(id)).toMatchObject({ status: "open", ok: 0, paid: 0, invoices: 0 });
    // Con los datos bien, la misma llave del primer intento sirve: aquel no dejó nada
    const done = await pay.payAndClose(valentina, id, { payment, close: consumer });
    expect(done).toMatchObject({ repeated: false, closed: true });
    expect(await state(id)).toMatchObject({ status: "paid", ok: 1, invoices: 1 });
  });

  it("con la llave de un pago que ya quedó (sin cerrar) no cobra otra vez ni cierra", async () => {
    const id = await newCheck([["Agua", 2]]);
    const { total } = await state(id);
    const attemptKey = key();
    await pay.registerPayment(valentina, id, { method: "efectivo", amount: 4000, tip: 0, attemptKey });
    const r = await pay.payAndClose(valentina, id, { payment: { method: "efectivo", amount: total - 4000, tip: 0, attemptKey }, close: consumer });
    expect(r).toMatchObject({ repeated: true, closed: false, invoiceId: null, due: total - 4000 });
    expect(await state(id)).toMatchObject({ status: "bill", ok: 1, paid: 4000, invoices: 0 });
  });
});

describe("rentabilidad", () => {
  it("una cuenta refacturada no duplica la venta: rentabilidad y el resumen del día dan lo mismo", async () => {
    const { profitReport } = await import("../lib/server/labor");
    const { dayReport } = await import("../lib/server/reports");
    const { jornadaKey } = await import("../lib/core/time");
    const id = await newCheck([["Solomito Cheese", 1]]);
    const { total } = await state(id);
    await pay.registerPayment(valentina, id, { method: "efectivo", amount: total, tip: 0 });
    await pay.closeCheck(valentina, id, consumer);
    const today = jornadaKey();
    const before = { profit: (await profitReport(biz, { from: today, to: today })).totals.net, day: (await dayReport(biz, today)).net };
    expect(before.profit).toBe(before.day);
    // Refacturar con NIT anula la factura (nota crédito) y emite otra por el mismo valor
    await pay.reissueInvoice(andres, id, { invoice: { kind: "nit", doc: "900123456", name: "Empresa de Prueba SAS" } });
    const invoices = await db.query<{ voided_at: string | null; subtotal: number }>("select voided_at, subtotal from invoices where check_id = $1", [id]);
    expect(invoices).toHaveLength(2);
    expect(invoices.filter((i) => i.voided_at).length).toBe(1);
    const profit = await profitReport(biz, { from: today, to: today });
    const day = await dayReport(biz, today);
    expect(profit.totals.net).toBe(day.net);
    expect(profit.totals.net).toBe(before.profit);
    // Y lo que heredan de ahí: la persona que abrió la cuenta y el canal
    expect(profit.people.reduce((s, p) => s + p.net, 0)).toBe(day.net);
    expect(profit.channels.reduce((s, c) => s + c.net, 0)).toBe(day.net);
  });
});

describe("premio de sellos", () => {
  it("el tope se compara con lo que vale la bebida con sus adiciones", async () => {
    const michelada = (await db.one<{ id: string }>("select id from modifiers where business_id = $1 and name = 'Michelada'", [biz]))!.id;
    const max = (await (await import("../lib/server/business")).getBusiness(biz)).settings.loyalty.rewardMax;
    const goal = (await (await import("../lib/server/business")).getBusiness(biz)).settings.loyalty.goal;
    const id = await checks.openCheck(valentina, { kind: "barra", name: "Sellos" });
    await checks.addItems(valentina, id, [
      { productId: products.get("Poker")!, qty: 1, modifierIds: [michelada] },
      { productId: products.get("Agua")!, qty: 1 },
    ]);
    await checks.sendRound(valentina, id);
    // Precios fijos para la prueba (sin depender del happy hour): Poker de $6.000 con michelada de $2.500 vale $8.500
    await db.query("update check_items set unit_price = 6000 where check_id = $1 and name = 'Poker'", [id]);
    await db.query("update check_items set unit_price = 4000 where check_id = $1 and name = 'Agua'", [id]);
    expect(max).toBe(7000);
    const customer = await pay.attachCustomer(valentina, id, { phone: "3001112233", name: "Cliente de sellos", consent: true });
    await db.query("update customers set stamps = $2 where id = $1", [customer, goal]);
    await pay.redeemReward(valentina, id);
    const lines = await db.query<{ name: string; courtesy: boolean }>("select name, courtesy from check_items where check_id = $1 order by name", [id]);
    // Antes regalaba la Poker michelada ($8.500, por encima del tope de $7.000). Ahora regala lo que sí entra
    expect(lines).toEqual([
      { name: "Agua", courtesy: true },
      { name: "Poker", courtesy: false },
    ]);
    const log = (await db.one<{ amount: number; detail: { item: string } }>("select amount, detail from audit_log where business_id = $1 and action = 'reward' order by created_at desc limit 1", [biz]))!;
    expect(log.amount).toBe(4000);
    expect(log.detail.item).toBe("Agua");
    // Si lo único que hay se pasa del tope con sus adiciones, no hay premio que dar
    const only = await checks.openCheck(valentina, { kind: "barra", name: "Sellos 2" });
    await checks.addItems(valentina, only, [{ productId: products.get("Poker")!, qty: 1, modifierIds: [michelada] }]);
    await checks.sendRound(valentina, only);
    await db.query("update check_items set unit_price = 6000 where check_id = $1", [only]);
    await pay.attachCustomer(valentina, only, { phone: "3001112233", consent: true });
    await db.query("update customers set stamps = $2 where id = $1", [customer, goal]);
    await expect(pay.redeemReward(valentina, only)).rejects.toThrow(/No hay una bebida/);
  });
});

describe("opciones de la carta sin precio negativo", () => {
  it("la base no guarda una opción con precio negativo", async () => {
    const group = (await db.one<{ id: string }>("select id from modifier_groups where business_id = $1 limit 1", [biz]))!.id;
    await expect(db.query("insert into modifiers (business_id, group_id, name, price) values ($1, $2, 'Sin tocineta', -5000)", [biz, group])).rejects.toThrow(/modifiers_price_check/);
    await expect(db.query("update modifiers set price = -1 where business_id = $1 and name = 'Michelada'", [biz])).rejects.toThrow(/modifiers_price_check/);
  });

  it("una opción con precio negativo no entra a una cuenta", async () => {
    const { priceItem } = await import("../lib/server/menu");
    const menu = {
      categories: [],
      happy: false,
      happyLabel: "",
      groups: { g1: { id: "g1", name: "Adiciones", min: 0, max: 3, options: [{ id: "o1", name: "Tocineta", price: 5000, isDefault: false }, { id: "o2", name: "Sin tocineta", price: -5000, isDefault: false }] } },
      products: [{ id: "p1", categoryId: "c1", name: "Burger", description: "", price: 30_000, basePrice: 30_000, happyPrice: null, onHappy: false, taxRate: 8, station: "cocina", image: null, soldOut: false, active: true, favorite: false, groups: ["g1"] }],
    };
    expect(priceItem(menu, { productId: "p1", qty: 1, modifierIds: ["o1"] }).modifiers).toEqual([{ name: "Tocineta", price: 5000, id: "o1", group: "Adiciones" }]);
    expect(() => priceItem(menu, { productId: "p1", qty: 1, modifierIds: ["o2"] })).toThrow(/precio que no es válido/);
  });

  it("la migración deja en $0 las opciones que ya tuvieran precio negativo antes de prohibirlas", async () => {
    const { MIGRATIONS } = await import("../lib/schema");
    const v6 = MIGRATIONS.find((m) => m.version === 6)!;
    const group = (await db.one<{ id: string }>("select id from modifier_groups where business_id = $1 limit 1", [biz]))!.id;
    // Una base de antes de la v6: sin la restricción y con una opción en negativo
    await db.query("alter table modifiers drop constraint modifiers_price_check");
    const bad = (await db.one<{ id: string }>("insert into modifiers (business_id, group_id, name, price) values ($1, $2, 'Descuento raro', -700) returning id", [biz, group]))!.id;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await db.tx((tx) => v6.run!(tx));
    } finally {
      warn.mockRestore();
    }
    expect((await db.one<{ price: number }>("select price from modifiers where id = $1", [bad]))!.price).toBe(0);
    await expect(db.query("update modifiers set price = -1 where id = $1", [bad])).rejects.toThrow(/modifiers_price_check/);
    await db.query("delete from modifiers where id = $1", [bad]);
  });
});

describe("arqueo a ciegas", () => {
  it("a la caja no le llega el esperado; al dueño sí", async () => {
    const { cashView, closedCashView } = await import("../lib/core/cash");
    const { can } = await import("../lib/server/auth");
    // Algo de efectivo en la caja para que haya qué esconder
    const id = await newCheck([["Agua", 1]]);
    await pay.registerPayment(valentina, id, { method: "efectivo", amount: 4000, tip: 500, received: 5000 });
    const session = (await pay.currentCashSession(biz))!;
    const summary = (await pay.cashSummary(biz, session.id))!;
    expect(summary.expected).toBeGreaterThan(0);
    expect(can.seeExpected(valentina)).toBe(false);
    expect(can.seeExpected(andres)).toBe(true);
    const blind = cashView(summary, can.seeExpected(valentina));
    expect(blind.expected).toBeNull();
    expect(blind.session.opening).toBeNull();
    expect(blind.sales).toBeNull();
    expect(blind.byMethod.find((m) => m.method === "efectivo")).toMatchObject({ amount: null, tip: null });
    expect(JSON.stringify(blind)).not.toContain(String(summary.expected));
    expect(cashView(summary, can.seeExpected(andres)).expected).toBe(summary.expected);
    // Cierra con un faltante: a la caja no se le devuelve la diferencia ni le llega en los cierres anteriores
    const closed = await pay.closeCash(valentina, { counted: summary.expected - 3000, note: "", confirm: true });
    expect(closed.difference).toBeNull();
    const history = await pay.lastClosedSessions(biz);
    expect(history[0]).toMatchObject({ id: closed.sessionId, expected: summary.expected, counted: summary.expected - 3000, difference: -3000 });
    expect(closedCashView(history, can.seeExpected(valentina))[0]).toEqual({ id: closed.sessionId, closed_at: history[0]!.closed_at, closer: "Valentina", expected: null, counted: null, difference: null });
    expect(closedCashView(history, can.seeExpected(andres))[0]).toMatchObject({ expected: summary.expected, difference: -3000 });
    // La caja queda abierta otra vez para lo que sigue
    await pay.openCash(valentina, 200_000);
  });
});

describe("caja y cobro", () => {
  it("dentro de la transacción del cobro la caja abierta se lee con candado (y trae quién la abrió)", async () => {
    const outside = (await pay.currentCashSession(biz))!;
    const inside = await db.tx((tx) => pay.currentCashSession(biz, tx));
    expect(inside).toEqual(outside);
    expect(inside!.opener).toBeTruthy();
  });
});

describe("guardia de db.tx", () => {
  it("usar la base de afuera dentro de una transacción lanza un error claro en vez de colgar la base", async () => {
    await expect(db.tx(async () => db.query("select 1"))).rejects.toThrow(/dentro de db\.tx/);
    await expect(db.tx(async () => db.one("select 1"))).rejects.toThrow(/dentro de db\.tx/);
    await expect(db.tx(async () => db.exec("select 1"))).rejects.toThrow(/dentro de db\.tx/);
    // Lo mismo con un ayudante que llama getDb() por dentro (getBusiness, loadMenu, loadCheck sin tx…)
    const { getBusiness } = await import("../lib/server/business");
    await expect(db.tx(async () => getBusiness(biz))).rejects.toThrow(/dentro de db\.tx/);
    await expect(db.tx(async () => checks.loadCheck(biz, randomUUID()))).rejects.toThrow(/dentro de db\.tx/);
    // La base sigue viva y la transacción fallida no dejó nada
    expect(await db.one("select 1 as n")).toEqual({ n: 1 });
  });

  it("una transacción dentro de otra también avisa", async () => {
    await expect(db.tx(async () => db.tx(async () => 1))).rejects.toThrow(/db\.tx anidado/);
    expect(await db.tx(async (tx) => (await tx.one<{ n: number }>("select 2 as n"))!.n)).toBe(2);
  });

  it("no confunde a otro flujo: una consulta de afuera mientras alguien más tiene una transacción abierta espera su turno", async () => {
    let started!: () => void;
    let release!: () => void;
    const began = new Promise<void>((resolve) => (started = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow = db.tx(async (tx) => {
      await tx.query("select 1");
      started();
      await gate;
      return "transacción";
    });
    await began;
    // La transacción sigue abierta. Otro flujo (el pulso de otra tablet mientras alguien cobra) no está dentro de ella
    const other = db.one<{ n: number }>("select 3 as n");
    release();
    expect(await slow).toBe("transacción");
    expect(await other).toEqual({ n: 3 });
  });

  it("lo que queda corriendo cuando la transacción ya terminó no cuenta como adentro", async () => {
    let finished!: () => void;
    const after = new Promise<void>((resolve) => (finished = resolve));
    let later!: Promise<{ n: number } | null>;
    await db.tx(async (tx) => {
      await tx.query("select 1");
      // Queda programado desde adentro, pero corre después de cerrar la transacción
      later = after.then(() => db.one<{ n: number }>("select 4 as n"));
    });
    finished();
    expect(await later).toEqual({ n: 4 });
  });
});
