import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Facturación ante la DIAN contra una base real: tiquete POS o factura según el cliente, contenido congelado con
 * códigos y totales exactos, notas al anular, y envío al proveedor con reintentos y rechazos (el proveedor es falso).
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
type DianDocument = import("../lib/core/dian").DianDocument;

const dir = mkdtempSync(path.join(tmpdir(), "ronda-dian-"));
let db: Db;
let biz: string;
let pay: typeof import("../lib/server/payments");
let checks: typeof import("../lib/server/checks");
let dian: typeof import("../lib/server/dian");
let business: typeof import("../lib/server/business");
let valentina: Staff, juanPablo: Staff, andres: Staff;
const products = new Map<string, string>();

beforeAll(async () => {
  process.env.PGLITE_DIR = dir;
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.VERCEL;
  delete process.env.DIAN_PROVIDER_URL;
  db = await (await import("../lib/server/db")).getDb();
  pay = await import("../lib/server/payments");
  checks = await import("../lib/server/checks");
  dian = await import("../lib/server/dian");
  business = await import("../lib/server/business");
  biz = (await db.one<{ id: string }>("select id from businesses order by created_at limit 1"))!.id;
  const person = async (name: string) => (await db.one<Staff>("select id, business_id, name, role, color from staff where business_id = $1 and name = $2", [biz, name]))!;
  [valentina, juanPablo, andres] = await Promise.all([person("Valentina"), person("Juan Pablo"), person("Andrés")]);
  for (const p of await db.query<{ id: string; name: string }>("select id, name from products where business_id = $1", [biz])) products.set(p.name, p.id);
  if (!(await pay.currentCashSession(biz))) await pay.openCash(valentina, 200_000);
  const zone = (await db.one<{ id: string }>("select id from zones where business_id = $1 order by sort limit 1", [biz]))!.id;
  for (let n = 1; n <= 12; n++) await db.query("insert into floor_tables (business_id, zone_id, name, seats, qr_token) values ($1, $2, $3, 4, $4)", [biz, zone, `D${n}`, `prueba-dian-${n}`]);
}, 180_000);

afterAll(() => {
  vi.unstubAllGlobals();
  delete process.env.DIAN_PROVIDER_URL;
  rmSync(dir, { recursive: true, force: true });
});

/** Una venta cobrada en efectivo, con descuento opcional, cerrada con o sin NIT. */
async function sale(lines: [string, number][], opts: { nit?: boolean; discount?: number; tip?: number } = {}) {
  const floor = await checks.floorState(biz);
  const table = floor.tables.find((t) => !t.check)!;
  const id = await checks.openCheck(juanPablo, { kind: "mesa", tableId: table.id, guests: 2 });
  await checks.addItems(
    juanPablo,
    id,
    lines.map(([name, qty]) => ({ productId: products.get(name)!, qty })),
  );
  await checks.sendRound(juanPablo, id);
  if (opts.discount) await checks.setDiscount(andres, id, { pct: opts.discount, reason: "Cliente frecuente" });
  const view = (await checks.loadCheck(biz, id))!;
  await pay.registerPayment(valentina, id, { method: "efectivo", amount: view.totals.total, tip: opts.tip ?? 0, received: view.totals.total + (opts.tip ?? 0) });
  const invoice = opts.nit ? { kind: "nit" as const, doc: "900555444-1", name: "Empresa Cliente S.A.S.", email: "compras@cliente.co" } : { kind: "consumidor" as const };
  const { invoiceId } = await pay.closeCheck(valentina, id, { tipAnswer: opts.tip ? "si" : "no", invoice });
  return { checkId: id, invoiceId: invoiceId!, total: view.totals.total };
}

const invoice = async (id: string) =>
  (await db.one<{
    doc_type: string;
    dian_status: string;
    prefix: string;
    number: number;
    cufe: string;
    payload: DianDocument;
    issued_at: string | null;
    note_status: string | null;
    note_code: string | null;
    dian_attempts: number;
    dian_next_at: string | null;
    dian_message: string | null;
  }>("select doc_type, dian_status, prefix, number, cufe, payload, issued_at, note_status, note_code, dian_attempts, dian_next_at, dian_message from invoices where id = $1", [id]))!;

async function setInvoice(patch: Record<string, unknown>) {
  const b = await business.getBusiness(biz);
  const { saveSettings } = await import("../lib/server/panel");
  await saveSettings(andres, { ...b.settings, invoice: { ...b.settings.invoice, ...patch } });
}

describe("documento de cada venta (simulado)", () => {
  it("al consumidor final sale tiquete POS electrónico con los códigos y totales exactos", async () => {
    const { invoiceId, total } = await sale([
      ["Antojo de patatas", 2],
      ["Club Colombia", 3],
    ], { discount: 10, tip: 3000 });
    const inv = await invoice(invoiceId);
    expect(inv.doc_type).toBe("pos");
    expect(inv.dian_status).toBe("simulado");
    expect(inv.issued_at).toBeTruthy();
    expect(inv.cufe).toMatch(/^[0-9a-f]{96}$/);
    const doc = inv.payload;
    expect(doc.buyer.doc).toBe("222222222222");
    expect(doc.lines.every((l) => /^SP-\d{3}$/.test(l.code))).toBe(true);
    // Con el descuento repartido, las líneas suman exacto lo que pagó el cliente, y base más impuesto también
    expect(doc.lines.reduce((s, l) => s + l.total, 0)).toBe(total);
    expect(doc.totals.base + doc.totals.tax).toBe(total);
    expect(doc.totals.tip).toBe(3000);
    expect(doc.software).toEqual({ maker: "PuntoNeutro", name: "Ronda" });
  });

  it("con NIT y resolución de factura sale factura electrónica con su numeración", async () => {
    await setInvoice({ fePrefix: "SPFE", feRangeFrom: 501, feRangeTo: 600, feResolution: "18764000000002", feValidTo: "2030-12-31" });
    const a = await invoice((await sale([["Antojo de patatas", 1]], { nit: true })).invoiceId);
    const b = await invoice((await sale([["Antojo de patatas", 1]], { nit: true })).invoiceId);
    expect([a.doc_type, a.prefix, a.number]).toEqual(["fe", "SPFE", 501]);
    expect(b.number).toBe(502);
    expect(a.payload.buyer).toMatchObject({ identified: true, doc: "900555444-1", name: "Empresa Cliente S.A.S." });
    // El tiquete POS sigue con su propio contador
    expect((await invoice((await sale([["Antojo de patatas", 1]])).invoiceId)).doc_type).toBe("pos");
  });

  it("sin resolución de factura, quien da su NIT recibe el tiquete POS con sus datos", async () => {
    await setInvoice({ fePrefix: "", feRangeTo: 0 });
    const inv = await invoice((await sale([["Antojo de patatas", 1]], { nit: true })).invoiceId);
    expect(inv.doc_type).toBe("pos");
    expect(inv.payload.buyer.identified).toBe(true);
  });

  it("fuera del rango de la factura no deja cerrar", async () => {
    await setInvoice({ fePrefix: "SPFE", feRangeFrom: 1, feRangeTo: 1, feValidTo: "2030-12-31" });
    await db.query("update counters set last = 1 where business_id = $1 and kind = 'fe'", [biz]);
    await expect(sale([["Antojo de patatas", 1]], { nit: true })).rejects.toThrow(/rango autorizado de factura electrónica/);
    await setInvoice({ fePrefix: "", feRangeTo: 0 });
  });

  it("anular la venta saca la nota de ajuste del tiquete con su propio código", async () => {
    const { checkId, invoiceId } = await sale([["Antojo de patatas", 1]]);
    await pay.voidSale(andres, checkId, { reason: "Se cobró a la mesa equivocada" });
    const inv = await invoice(invoiceId);
    expect(inv.note_status).toBe("simulado");
    expect(inv.note_code).toMatch(/^[0-9a-f]{96}$/);
    expect(inv.note_code).not.toBe(inv.cufe);
  });
});

describe("envío al proveedor tecnológico", () => {
  const replies: (() => Response | Promise<Response>)[] = [];
  const sent: { kind: string; document: DianDocument; note?: { type: string } }[] = [];

  beforeAll(async () => {
    process.env.DIAN_PROVIDER_URL = "https://proveedor.prueba/dian";
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      const next = replies.shift();
      if (!next) throw new Error("sin respuesta preparada");
      return next();
    });
    await setInvoice({ mode: "pruebas" });
  });

  const ok = (code: string) => () => new Response(JSON.stringify({ status: "validado", code }), { status: 200 });

  it("cobrar no espera al proveedor: queda pendiente y luego se valida con el código oficial", async () => {
    const { invoiceId } = await sale([["Antojo de patatas", 1]]);
    expect((await invoice(invoiceId)).dian_status).toBe("pendiente");
    expect((await dian.dianSummary(biz)).pending).toBeGreaterThanOrEqual(1);
    replies.push(ok("cude-oficial-1"));
    const r = await dian.sendPendingDocuments(biz);
    expect(r.sent).toBe(1);
    const inv = await invoice(invoiceId);
    expect(inv.dian_status).toBe("validado");
    expect(inv.cufe).toBe("cude-oficial-1");
    expect(inv.issued_at).toBeTruthy();
    expect(sent.at(-1)!.kind).toBe("document");
    expect(sent.at(-1)!.document.environment).toBe("pruebas");
  });

  it("si el proveedor no contesta, sigue pendiente y se reintenta más tarde", async () => {
    const { invoiceId } = await sale([["Antojo de patatas", 1]]);
    replies.push(() => new Response("caído", { status: 503 }));
    const r = await dian.sendPendingDocuments(biz);
    expect(r.failed).toBe(1);
    const inv = await invoice(invoiceId);
    expect(inv.dian_status).toBe("pendiente");
    expect(inv.dian_attempts).toBe(1);
    expect(Date.parse(inv.dian_next_at!)).toBeGreaterThan(Date.now());
    expect(inv.dian_message).toMatch(/503/);
    // Antes de su hora no se vuelve a mandar
    expect((await dian.sendPendingDocuments(biz)).sent + (await dian.sendPendingDocuments(biz)).failed).toBe(0);
    await db.query("update invoices set dian_next_at = now() - interval '1 minute' where id = $1", [invoiceId]);
    replies.push(ok("cude-oficial-2"));
    expect((await dian.sendPendingDocuments(biz)).sent).toBe(1);
    expect((await invoice(invoiceId)).dian_status).toBe("validado");
  });

  it("un rechazo queda a la vista con su motivo y no se reintenta solo", async () => {
    const { invoiceId } = await sale([["Antojo de patatas", 1]]);
    replies.push(() => new Response(JSON.stringify({ status: "rechazado", message: "NIT del adquirente inválido" }), { status: 200 }));
    await dian.sendPendingDocuments(biz);
    const inv = await invoice(invoiceId);
    expect(inv.dian_status).toBe("rechazado");
    expect(inv.dian_message).toBe("NIT del adquirente inválido");
    const summary = await dian.dianSummary(biz);
    expect(summary.rejected).toBeGreaterThanOrEqual(1);
  });

  it("la nota de una venta validada se manda después, con su tipo", async () => {
    const { checkId, invoiceId } = await sale([["Antojo de patatas", 1]]);
    replies.push(ok("cude-oficial-3"));
    await dian.sendPendingDocuments(biz);
    await pay.voidSale(andres, checkId, { reason: "Devolución" });
    expect((await invoice(invoiceId)).note_status).toBe("pendiente");
    replies.push(ok("cude-nota-1"));
    await dian.sendPendingDocuments(biz);
    const inv = await invoice(invoiceId);
    expect(inv.note_status).toBe("validado");
    expect(inv.note_code).toBe("cude-nota-1");
    expect(sent.at(-1)).toMatchObject({ kind: "note", note: { type: "ajuste" } });
  });
});

describe("lo que falta para facturar", () => {
  it("lista los productos sin código y lo que no está cargado", async () => {
    await db.query("update products set code = null where id = $1", [products.get("Poker")]);
    const { problems } = await dian.dianReadiness(biz);
    expect(problems.some((p) => p.includes("Poker"))).toBe(true);
  });
});
