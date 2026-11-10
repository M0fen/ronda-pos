import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Flujos de plata contra una base real (PGlite en una carpeta temporal, con la demo sembrada):
 * cobro y factura, caja a ciegas, pagos quitados con autorización, cuentas en $0, ventas anuladas con nota crédito.
 * Las funciones del servidor se llaman directo; solo se simulan las cookies y los encabezados de Next.
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

const dir = mkdtempSync(path.join(tmpdir(), "ronda-it-"));
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
  // Siempre con caja abierta para empezar (la demo puede traerla abierta o no)
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

async function due(id: string) {
  const view = await checks.loadCheck(biz, id);
  return { total: view!.totals.total, due: view!.due, paid: view!.paid, status: view!.status };
}

describe("flujos de plata", () => {
  it("cobra en efectivo con propina, factura lo justo y el cajón lo espera", async () => {
    const session = (await pay.currentCashSession(biz))!;
    const before = (await pay.cashSummary(biz, session.id))!;
    const id = await newCheck([
      ["Coca-Cola lata", 2],
      ["Agua", 1],
    ]);
    const { total } = await due(id);
    expect(total).toBeGreaterThan(0);
    const r = await pay.registerPayment(valentina, id, { method: "efectivo", amount: total, tip: 1000, received: total + 1000 + 5000 });
    expect(r.change).toBe(5000);
    const { invoiceId } = await pay.closeCheck(valentina, id, { tipAnswer: "si", invoice: { kind: "consumidor" } });
    expect(invoiceId).toBeTruthy();
    const inv = (await db.one<{ subtotal: number; tax: number; tip: number; total: number }>("select subtotal, tax, tip, total from invoices where id = $1", [invoiceId]))!;
    // Precio con impuesto incluido: base + impuesto = lo consumido; la propina va aparte
    expect(inv.subtotal + inv.tax).toBe(total);
    expect(inv.tip).toBe(1000);
    expect(inv.total).toBe(total + 1000);
    const after = (await pay.cashSummary(biz, session.id))!;
    expect(after.expected - before.expected).toBe(total + 1000);
    expect((await due(id)).status).toBe("paid");
  });

  it("no deja pagar de más ni cerrar con saldo pendiente", async () => {
    const id = await newCheck([["Agua", 1]]);
    const { total } = await due(id);
    await expect(pay.registerPayment(valentina, id, { method: "efectivo", amount: total + 1, tip: 0 })).rejects.toThrow(/Solo falta pagar/);
    await pay.registerPayment(valentina, id, { method: "efectivo", amount: total - 1000, tip: 0 });
    await expect(pay.closeCheck(valentina, id, { tipAnswer: "no", invoice: { kind: "consumidor" } })).rejects.toThrow(/Faltan/);
    await pay.registerPayment(valentina, id, { method: "tarjeta", amount: 1000, tip: 0, reference: "123456" });
    const { invoiceId } = await pay.closeCheck(valentina, id, { tipAnswer: "no", invoice: { kind: "consumidor" } });
    expect(invoiceId).toBeTruthy();
  });

  it("una tarjeta sin número de aprobación no entra", async () => {
    const id = await newCheck([["Agua", 1]]);
    const { total } = await due(id);
    await expect(pay.registerPayment(valentina, id, { method: "tarjeta", amount: total, tip: 0, reference: "" })).rejects.toThrow(/aprobación/);
  });

  it("quitar un pago lo autoriza otra persona con su PIN, nunca quien lo pide", async () => {
    const id = await newCheck([["Agua", 2]]);
    const { total } = await due(id);
    await pay.registerPayment(juanPablo, id, { method: "efectivo", amount: total, tip: 0 });
    const payment = (await db.one<{ id: string }>("select id from payments where check_id = $1 and status = 'ok'", [id]))!;
    // El mesero no puede solo: la pantalla abre la hoja de autorización
    await expect(pay.removePayment(juanPablo, payment.id, { reason: "Se cobró dos veces" })).rejects.toMatchObject({ fields: { auth: "void" } });
    // Su propio PIN no sirve como autorización
    await expect(pay.removePayment(juanPablo, payment.id, { reason: "Se cobró dos veces", auth: { id: juanPablo.id, pin: "3333" } })).rejects.toThrow(/otra persona/);
    // Un PIN equivocado no pasa
    await expect(pay.removePayment(juanPablo, payment.id, { reason: "Se cobró dos veces", auth: { id: valentina.id, pin: "0000" } })).rejects.toThrow();
    await pay.removePayment(juanPablo, payment.id, { reason: "Se cobró dos veces", auth: { id: valentina.id, pin: "2222" } });
    const row = (await db.one<{ status: string; removed_reason: string }>("select status, removed_reason from payments where id = $1", [payment.id]))!;
    expect(row.status).toBe("removed");
    expect(row.removed_reason).toMatch(/dos veces/);
    expect((await due(id)).due).toBe(total);
    const log = await db.one("select 1 from audit_log where business_id = $1 and action = 'payment_removed' and detail->>'authorizedBy' = 'Valentina'", [biz]);
    expect(log).toBeTruthy();
  });

  it("una cuenta que quedó en $0 (todo cortesía) se cierra sin factura", async () => {
    const id = await newCheck([["Agua", 1]], valentina);
    const item = (await db.one<{ id: string }>("select id from check_items where check_id = $1", [id]))!;
    // La cortesía la marca el dueño (o la autoriza)
    await checks.toggleCourtesy(andres, item.id, { reason: "Cortesía de la casa" });
    expect((await due(id)).total).toBe(0);
    const { invoiceId } = await pay.closeCheck(valentina, id, { tipAnswer: "no", invoice: { kind: "consumidor" } });
    expect(invoiceId).toBeNull();
    expect((await due(id)).status).toBe("paid");
  });

  it("anular una venta saca nota crédito, quita los pagos y lo deja en la auditoría", async () => {
    const id = await newCheck([["Coca-Cola lata", 1]]);
    const { total } = await due(id);
    await pay.registerPayment(valentina, id, { method: "nequi", amount: total, tip: 0, reference: "M12345" });
    const { invoiceId } = await pay.closeCheck(valentina, id, { tipAnswer: "no", invoice: { kind: "consumidor" } });
    // Caja no anula ventas sin el dueño o la administración
    await expect(pay.voidSale(valentina, id, { reason: "Error de digitación" })).rejects.toMatchObject({ fields: { auth: "manage" } });
    await pay.voidSale(valentina, id, { reason: "Error de digitación", auth: { id: andres.id, pin: "1234" } });
    const inv = (await db.one<{ voided_at: string | null; credit_note: number | null }>("select voided_at, credit_note from invoices where id = $1", [invoiceId]))!;
    expect(inv.voided_at).toBeTruthy();
    expect(inv.credit_note).toBeGreaterThan(0);
    const okPayments = await db.query("select 1 from payments where check_id = $1 and status = 'ok'", [id]);
    expect(okPayments).toHaveLength(0);
    expect((await due(id)).status).toBe("void");
  });

  it("sin caja abierta no se cobra, y el cierre es a ciegas para caja", async () => {
    const id = await newCheck([["Agua", 1]]);
    const { total } = await due(id);
    const session = (await pay.currentCashSession(biz))!;
    const summary = (await pay.cashSummary(biz, session.id))!;
    // Sin confirmar, no cierra
    await expect(pay.closeCash(valentina, { counted: summary.expected, note: "", confirm: false })).rejects.toThrow(/Confirma/);
    const closed = await pay.closeCash(valentina, { counted: summary.expected - 2000, note: "Faltan 2.000", confirm: true });
    // Caja no ve la diferencia (arqueo a ciegas); el dueño sí la ve en el cierre guardado
    expect(closed.difference).toBeNull();
    const row = (await db.one<{ difference: number }>("select difference from cash_sessions where id = $1", [closed.sessionId]))!;
    expect(row.difference).toBe(-2000);
    await expect(pay.registerPayment(valentina, id, { method: "efectivo", amount: total, tip: 0 })).rejects.toThrow(/Abre la caja/);
    await pay.openCash(valentina, 100_000);
    await expect(pay.registerPayment(valentina, id, { method: "efectivo", amount: total, tip: 0 })).resolves.toBeTruthy();
  });

  it("domicilio de Rappi: no sale sin empacar la lista completa y se despacha con pago y factura en un paso", async () => {
    const deliv = await import("../lib/server/delivery");
    const { packingList } = await import("../lib/core/delivery");
    const mateo = (await db.one<Staff>("select id, business_id, name, role, color from staff where business_id = $1 and name = 'Mateo'", [biz]))!;
    const id = await deliv.createDelivery(valentina, { channel: "rappi", customer: "Laura", code: "R-998", rider: "15" });
    await checks.addItems(valentina, id, [{ productId: products.get("Coca-Cola lata")!, qty: 2 }]);
    await checks.sendRound(valentina, id);
    await expect(deliv.dispatchDelivery(valentina, id)).rejects.toThrow(/Empaca/);
    for (const it of await db.query<{ id: string }>("select id from check_items where check_id = $1", [id])) await checks.kdsSetItem(mateo, it.id, "ready");
    const list = packingList((await checks.loadCheck(biz, id))!.items);
    await expect(deliv.packDelivery(valentina, id, list.slice(1))).rejects.toThrow(/Falta revisar/);
    await deliv.packDelivery(valentina, id, list);
    const { total } = await due(id);
    const { invoiceId } = await deliv.dispatchDelivery(valentina, id);
    expect(invoiceId).toBeTruthy();
    const p = (await db.one<{ method: string; amount: number }>("select method, amount from payments where check_id = $1 and status = 'ok'", [id]))!;
    expect(p).toEqual({ method: "plataforma", amount: total });
    expect((await due(id)).status).toBe("paid");
  });

  it("cancelar un domicilio con algo enviado lo autoriza caja y devuelve los insumos", async () => {
    const deliv = await import("../lib/server/delivery");
    const id = await deliv.createDelivery(juanPablo, { channel: "rappi", customer: "Pedro", code: "R-999" });
    await checks.addItems(juanPablo, id, [{ productId: products.get("Coca-Cola lata")!, qty: 1 }]);
    await checks.sendRound(juanPablo, id);
    await expect(deliv.cancelDelivery(juanPablo, id, { reason: "El cliente canceló" })).rejects.toMatchObject({ fields: { auth: "void" } });
    await deliv.cancelDelivery(juanPablo, id, { reason: "El cliente canceló", auth: { id: valentina.id, pin: "2222" } });
    expect((await due(id)).status).toBe("void");
    const back = await db.one("select 1 from stock_movements where business_id = $1 and reason = 'anulacion' and ref = (select 'Cuenta ' || number from checks where id = $2)", [biz, id]);
    expect(back).toBeTruthy();
  });

  it("pedido por QR: con aprobación espera al mesero; sin aprobación entra solo a la mesa", async () => {
    const qr = await import("../lib/server/qr");
    const free = await db.query<{ id: string; qr_token: string }>(
      "select t.id, t.qr_token from floor_tables t where t.business_id = $1 and t.active and t.seats > 1 and not exists (select 1 from checks c where c.table_id = t.id and c.status in ('open','bill')) limit 2",
      [biz],
    );
    expect(free.length).toBe(2);
    const agua = products.get("Agua")!;
    expect(await qr.submitQrOrder(free[0]!.qr_token, [{ productId: agua, qty: 1 }], "Ana")).toEqual({ needsApproval: true });
    expect(await db.one("select 1 from requests where table_id = $1 and kind = 'order' and status = 'pending'", [free[0]!.id])).toBeTruthy();
    await db.query("update businesses set settings = jsonb_set(settings, '{qr,requireApproval}', 'false') where id = $1", [biz]);
    try {
      expect(await qr.submitQrOrder(free[1]!.qr_token, [{ productId: agua, qty: 2 }], "Beto")).toEqual({ needsApproval: false });
      const items = await db.query<{ qty: number; source: string }>(
        "select i.qty, i.source from check_items i join checks c on c.id = i.check_id where c.table_id = $1 and c.status in ('open','bill')",
        [free[1]!.id],
      );
      expect(items).toEqual([{ qty: 2, source: "qr" }]);
    } finally {
      await db.query("update businesses set settings = jsonb_set(settings, '{qr,requireApproval}', 'true') where id = $1", [biz]);
    }
  });

  it("una tablet se enrola con el código de 6 números y al quitarla se cierran sus sesiones", async () => {
    const dev = await import("../lib/server/devices");
    const auth = await import("../lib/server/auth");
    await expect(dev.createEnrollCode(juanPablo, { name: "Caja 2" })).rejects.toThrow(/dueño o el administrador/);
    const code = await dev.createEnrollCode(andres, { name: "Caja 2" });
    expect(code).toMatch(/^\d{6}$/);
    const d = await dev.enrollDevice(code);
    expect(jar.get("ronda_device")).toBeTruthy();
    await expect(dev.enrollDevice(code)).rejects.toThrow(/no sirve/);
    await auth.loginWithPin(valentina.id, "2222", { id: d.id, business_id: d.business_id, all_sedes: false });
    const open = () => db.one<{ n: number }>("select count(*)::int as n from sessions where device_id = $1 and revoked_at is null", [d.id]);
    expect(await open()).toEqual({ n: 1 });
    await dev.revokeDevice(andres, d.id);
    expect(await open()).toEqual({ n: 0 });
  });

  it("cinco PIN errados bloquean a esa persona 15 minutos", async () => {
    const auth = await import("../lib/server/auth");
    const camila = (await db.one<{ id: string }>("select id from staff where business_id = $1 and name = 'Camila'", [biz]))!;
    for (let i = 0; i < 5; i++) await expect(auth.verifyPin(camila.id, "9999", { bizId: biz })).rejects.toThrow(/PIN incorrecto/);
    // Ya bloqueada, ni el PIN correcto entra
    await expect(auth.verifyPin(camila.id, "4444", { bizId: biz })).rejects.toThrow(/bloqueado/);
    expect((await db.one<{ locked_until: string | null }>("select locked_until from staff where id = $1", [camila.id]))!.locked_until).toBeTruthy();
  });

  it("los números de cuenta y de factura no se repiten", async () => {
    const dupChecks = await db.query("select number from checks where business_id = $1 group by number having count(*) > 1", [biz]);
    const dupInvoices = await db.query("select number from invoices where business_id = $1 group by prefix, number having count(*) > 1", [biz]);
    expect(dupChecks).toHaveLength(0);
    expect(dupInvoices).toHaveLength(0);
  });
});
