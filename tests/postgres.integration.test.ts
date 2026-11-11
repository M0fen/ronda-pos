import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lo que solo se ve con Postgres real, donde hay varias conexiones a la vez (PGlite tiene una sola): dos copias que
 * arrancan al tiempo contra una base vacía, la carrera entre cerrar la caja y cobrar, y la llave de intento con dos
 * peticiones simultáneas. No corre con `npm test` a secas: necesita una base desechable.
 *
 *   RONDA_PG_TEST_URL=postgres://usuario@localhost:5432/ronda_test npx vitest run tests/postgres.integration.test.ts
 *
 * Borra todo el esquema `public` de esa base antes de empezar: por eso el nombre de la base debe contener "ronda_test".
 */
const url = process.env.RONDA_PG_TEST_URL;

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
  redirect: (target: string) => {
    throw new Error(`redirect ${target}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));

type Staff = import("../lib/server/auth").Staff;
type Db = import("../lib/db-core").Db;

let admin: import("pg").Client;
let copies: PromiseSettledResult<Db>[] = [];
let db: Db;
let biz: string;
let pay: typeof import("../lib/server/payments");
let checks: typeof import("../lib/server/checks");
let valentina: Staff, juanPablo: Staff;
const products = new Map<string, string>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function newCheck(lines: [string, number][]) {
  const id = await checks.openCheck(juanPablo, { kind: "barra", name: "Prueba" });
  await checks.addItems(
    juanPablo,
    id,
    lines.map(([name, qty]) => ({ productId: products.get(name)!, qty })),
  );
  await checks.sendRound(juanPablo, id);
  const view = (await checks.loadCheck(biz, id))!;
  return { id, total: view.totals.total };
}

const okPayments = async (checkId: string) => (await db.query("select 1 from payments where check_id = $1 and status = 'ok'", [checkId])).length;

describe.skipIf(!url)("con Postgres real", () => {
  beforeAll(async () => {
    if (!/ronda_test/.test(new URL(url!).pathname)) throw new Error('Para no tocar una base real, el nombre de la base de pruebas debe contener "ronda_test"');
    process.env.DATABASE_URL = url;
    process.env.DEMO_MODE = "true";
    delete process.env.POSTGRES_URL;
    delete process.env.PGLITE_DIR;
    delete process.env.VERCEL;
    const pg = (await import("pg")).default;
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query("drop schema if exists public cascade");
    await admin.query("create schema public");

    // Dos copias de la función arrancan a la vez contra la base vacía, cada una con su conexión
    const core = await import("../lib/db-core");
    const { seedIfEmpty, getDb } = await import("../lib/server/db");
    const first = core.connect(seedIfEmpty);
    globalThis.__dzdb = undefined;
    const second = core.connect(seedIfEmpty);
    copies = await Promise.allSettled([first, second]);

    db = await getDb();
    pay = await import("../lib/server/payments");
    checks = await import("../lib/server/checks");
    biz = (await db.one<{ id: string }>("select id from businesses order by created_at limit 1"))!.id;
    const person = async (name: string) => (await db.one<Staff>("select id, business_id, name, role, color from staff where business_id = $1 and name = $2", [biz, name]))!;
    [valentina, juanPablo] = await Promise.all([person("Valentina"), person("Juan Pablo")]);
    for (const p of await db.query<{ id: string; name: string }>("select id, name from products where business_id = $1", [biz])) products.set(p.name, p.id);
  }, 180_000);

  // Cada prueba arranca con la caja abierta, aunque la anterior haya fallado a mitad de camino
  beforeEach(async () => {
    if (!(await pay.currentCashSession(biz))) await pay.openCash(valentina, 200_000);
  });

  // Y la conexión de apoyo no se queda con una transacción abierta
  afterEach(async () => {
    await admin?.query("rollback").catch(() => {});
  });

  afterAll(async () => {
    await admin?.end().catch(() => {});
  });

  it("dos copias que arrancan a la vez contra una base vacía migran y siembran una sola vez, sin chocar", async () => {
    expect(copies.map((c) => c.status)).toEqual(["fulfilled", "fulfilled"]);
    const [a, b] = copies.map((c) => (c as PromiseFulfilledResult<Db>).value);
    expect(a).not.toBe(b);
    expect(a!.kind).toBe("pg");
    expect((await a!.one<{ n: number }>("select count(*)::int as n from businesses"))!.n).toBe(4);
    expect((await b!.one<{ v: number }>("select max(version) as v from schema_version"))!.v).toBeGreaterThanOrEqual(6);
  });

  it("la guardia de db.tx también avisa con Postgres", async () => {
    await expect(db.tx(async () => db.query("select 1"))).rejects.toThrow(/dentro de db\.tx/);
    await expect(db.tx(async () => db.tx(async () => 1))).rejects.toThrow(/db\.tx anidado/);
    expect(await db.one("select 1 as n")).toEqual({ n: 1 });
  });

  it("dos cobros a la vez en cuentas distintas no se estorban", async () => {
    const [one, two] = await Promise.all([newCheck([["Agua", 1]]), newCheck([["Agua", 2]])]);
    await Promise.all([
      pay.registerPayment(valentina, one.id, { method: "efectivo", amount: one.total, tip: 0 }),
      pay.registerPayment(juanPablo, two.id, { method: "efectivo", amount: two.total, tip: 0 }),
    ]);
    expect(await okPayments(one.id)).toBe(1);
    expect(await okPayments(two.id)).toBe(1);
  });

  it("la misma llave de intento en dos peticiones simultáneas deja un solo pago", async () => {
    const { id } = await newCheck([["Agua", 2]]);
    const input = { method: "efectivo", amount: 4000, tip: 0, attemptKey: `intento-${randomUUID()}` };
    const results = await Promise.all([pay.registerPayment(valentina, id, input), pay.registerPayment(juanPablo, id, input), pay.registerPayment(valentina, id, input)]);
    expect(results.filter((r) => !r.repeated)).toHaveLength(1);
    expect(await okPayments(id)).toBe(1);
  });

  it("si la caja se está cerrando, el cobro espera y no entra a la caja cerrada", async () => {
    const { id, total } = await newCheck([["Agua", 1]]);
    const session = (await pay.currentCashSession(biz))!;
    // Otra conexión hace de «cerrar caja»: toma la caja con candado, como closeCash, y se queda a mitad de camino
    await admin.query("begin");
    await admin.query("select id from cash_sessions where id = $1 for update", [session.id]);
    let settled = false;
    const payment = pay
      .registerPayment(valentina, id, { method: "efectivo", amount: total, tip: 0 })
      .then(
        () => "cobrado",
        (error: Error) => error.message,
      )
      .finally(() => (settled = true));
    await sleep(500);
    expect(settled).toBe(false);
    // El cierre termina: calculó el esperado sin ese pago y cerró
    await admin.query("update cash_sessions set closed_at = now(), counted = 0, expected = 0, difference = 0 where id = $1", [session.id]);
    await admin.query("commit");
    // El cobro, que esperaba, ya no encuentra la caja abierta: no queda un pago por fuera del cierre
    expect(await payment).toMatch(/Abre la caja para cobrar/);
    expect(await okPayments(id)).toBe(0);
    expect((await db.query("select 1 from payments where cash_session_id = $1 and check_id = $2", [session.id, id])).length).toBe(0);
    // Con la caja abierta otra vez, se cobra normal
    await pay.openCash(valentina, 100_000);
    await pay.registerPayment(valentina, id, { method: "efectivo", amount: total, tip: 0 });
    expect(await okPayments(id)).toBe(1);
  }, 30_000);

  it("cerrar la caja espera al cobro que va en camino y lo cuenta en el esperado", async () => {
    const session = (await pay.currentCashSession(biz))!;
    const before = (await pay.cashSummary(biz, session.id))!;
    const { id, total } = await newCheck([["Agua", 1]]);
    // Otra conexión retiene la fila de la sede. El cobro alcanza a leer la caja (con su candado compartido) y se queda
    // esperando justo antes de guardar el pago: esa era la ventana por la que se colaba un cierre
    await admin.query("begin");
    await admin.query("select id from businesses where id = $1 for update", [biz]);
    let paid = false;
    const payment = pay.registerPayment(valentina, id, { method: "efectivo", amount: total, tip: 0 }).finally(() => (paid = true));
    await sleep(400);
    expect(paid).toBe(false);
    let closedNow = false;
    const closing = pay.closeCash(valentina, { counted: before.expected + total, note: "", confirm: true }).finally(() => (closedNow = true));
    await sleep(500);
    expect(closedNow).toBe(false);
    await admin.query("commit");
    await payment;
    const closed = await closing;
    // El cierre esperó al cobro: el pago quedó en esa caja y dentro de su esperado
    const row = (await db.one<{ expected: number; difference: number }>("select expected, difference from cash_sessions where id = $1", [closed.sessionId]))!;
    expect(row).toEqual({ expected: before.expected + total, difference: 0 });
    expect((await db.one<{ cash_session_id: string }>("select cash_session_id from payments where check_id = $1 and status = 'ok'", [id]))!.cash_session_id).toBe(closed.sessionId);
  }, 30_000);

  it("«efectivo exacto y cerrar» no se cruza con otro cierre que va en camino", async () => {
    const { id, total } = await newCheck([["Agua", 1]]);
    // Otra conexión hace de «otro cierre en camino»: ya tomó el consecutivo de facturas y le falta avisar el cambio (el pulso)
    await admin.query("begin");
    await admin.query("select last from counters where business_id = $1 and kind = 'invoice' for update", [biz]);
    const closing = pay.payAndClose(valentina, id, { payment: { method: "efectivo", amount: total, tip: 0 }, close: { tipAnswer: "no", invoice: { kind: "consumidor" } } }).then(
      (r) => r,
      (error: Error) => error,
    );
    await sleep(400);
    // payAndClose ya guardó el pago y espera el consecutivo. Si además tuviera tomado el pulso de la sede, este aviso
    // se quedaría esperándolo y Postgres tendría que tumbar a uno de los dos (deadlock)
    const bumped = await Promise.race([admin.query("update pulse set version = version + 1 where business_id = $1", [biz]).then(() => "avisó"), sleep(3000).then(() => "bloqueado")]);
    expect(bumped).toBe("avisó");
    await admin.query("commit");
    expect(await closing).toMatchObject({ closed: true, repeated: false });
    expect(await okPayments(id)).toBe(1);
  }, 30_000);

  it("una llave que ya la tiene un pago de otra cuenta, aún sin confirmar, no deja entrar el segundo", async () => {
    const [a, b] = [await newCheck([["Agua", 1]]), await newCheck([["Agua", 1]])];
    const attemptKey = `intento-${randomUUID()}`;
    const session = (await pay.currentCashSession(biz))!;
    // Otra conexión está guardando un pago de la cuenta B con esa llave y todavía no confirma: la búsqueda del intento
    // no lo ve, y es el índice único el que frena el segundo
    await admin.query("begin");
    await admin.query("insert into payments (business_id, check_id, method, amount, tip, cash_session_id, attempt_key) values ($1, $2, 'efectivo', 4000, 0, $3, $4)", [biz, b.id, session.id, attemptKey]);
    const second = pay.registerPayment(valentina, a.id, { method: "efectivo", amount: a.total, tip: 0, attemptKey }).then(
      () => "cobrado",
      (error: Error) => error.message,
    );
    await sleep(400);
    await admin.query("commit");
    expect(await second).toMatch(/otra cuenta/);
    expect(await okPayments(a.id)).toBe(0);
  }, 30_000);
});
