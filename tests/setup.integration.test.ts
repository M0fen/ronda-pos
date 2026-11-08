import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Editores del local (categorías, recetas, insumos, mesas) y el alta de un local nuevo, contra una base real. */

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

const dir = mkdtempSync(path.join(tmpdir(), "ronda-setup-"));
let db: Db;
let biz: string;
let andres: Staff, valentina: Staff;
let cat: typeof import("../lib/server/catalog");
let checks: typeof import("../lib/server/checks");

beforeAll(async () => {
  process.env.PGLITE_DIR = dir;
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.VERCEL;
  db = await (await import("../lib/server/db")).getDb();
  cat = await import("../lib/server/catalog");
  checks = await import("../lib/server/checks");
  biz = (await db.one<{ id: string }>("select id from businesses order by created_at limit 1"))!.id;
  const person = async (name: string) => (await db.one<Staff>("select id, business_id, name, role, color from staff where business_id = $1 and name = $2", [biz, name]))!;
  [andres, valentina] = await Promise.all([person("Andrés"), person("Valentina")]);
}, 180_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("editores del local", () => {
  it("categorías: crear, no repetir, ordenar y no borrar si tiene productos", async () => {
    await expect(cat.saveCategory(valentina, { name: "Postres", color: "#D2232A", station: "barra" })).rejects.toThrow(/dueño o el administrador/);
    const id = await cat.saveCategory(andres, { name: "Postres", color: "#D2232A", station: "barra" });
    await expect(cat.saveCategory(andres, { name: "postres", color: "#D2232A", station: "barra" })).rejects.toThrow(/Ya hay/);
    await cat.moveCategory(andres, id, -1);
    const order = await db.query<{ id: string }>("select id from categories where business_id = $1 order by sort", [biz]);
    expect(order.at(-2)!.id).toBe(id);
    const busy = (await db.one<{ category_id: string }>("select category_id from products where business_id = $1 limit 1", [biz]))!;
    await expect(cat.deleteCategory(andres, busy.category_id)).rejects.toThrow(/productos/);
    await cat.deleteCategory(andres, id);
    expect(await db.one("select 1 from categories where id = $1", [id])).toBeNull();
  });

  it("si la categoría cambia a cocina, sus productos también", async () => {
    const row = (await db.one<{ id: string; name: string; color: string }>("select id, name, color from categories where business_id = $1 and station = 'barra' limit 1", [biz]))!;
    await cat.saveCategory(andres, { id: row.id, name: row.name, color: row.color, station: "cocina" });
    const stations = await db.query<{ station: string }>("select distinct station from products where category_id = $1", [row.id]);
    expect(stations.map((s) => s.station)).toEqual(["cocina"]);
  });

  it("insumo nuevo con conteo inicial y receta que descuenta con la venta", async () => {
    const ing = await cat.saveIngredient(andres, { name: "Hielo", unit: "g", price: 5000, perQty: 5000, minStock: 2000, packSize: 5000, packLabel: "bolsa", initialStock: 10000 });
    const row = (await db.one<{ stock: number; cost: number }>("select stock, cost from ingredients where id = $1", [ing]))!;
    expect(Number(row.stock)).toBe(10000);
    expect(Number(row.cost)).toBe(1);
    expect(await db.one("select 1 from stock_movements where ingredient_id = $1 and reason = 'conteo'", [ing])).toBeTruthy();
    const agua = (await db.one<{ id: string }>("select id from products where business_id = $1 and name = 'Agua'", [biz]))!.id;
    await cat.setRecipe(andres, agua, [{ ingredientId: ing, qty: 150 }]);
    // Ya tiene receta y movimientos: la unidad no se cambia
    await expect(cat.saveIngredient(andres, { id: ing, name: "Hielo", unit: "und", price: 5000, perQty: 5000, minStock: 0, packSize: null, packLabel: "" })).rejects.toThrow(/unidad/);
    const check = await checks.openCheck(valentina, { kind: "barra", name: "Hielo" });
    await checks.addItems(valentina, check, [{ productId: agua, qty: 2 }]);
    await checks.sendRound(valentina, check);
    const after = (await db.one<{ stock: number }>("select stock from ingredients where id = $1", [ing]))!;
    expect(Number(after.stock)).toBe(10000 - 300);
  });

  it("mesas: crear con QR propio, mover y quitar (apagada si tuvo cuentas)", async () => {
    const zone = await cat.saveZone(andres, { name: "Patio de prueba" });
    const t1 = await cat.saveTable(andres, { zoneId: zone, name: "T1", seats: 4, shape: "round" });
    const t2 = await cat.saveTable(andres, { zoneId: zone, name: "T2", seats: 2, shape: "square" });
    await expect(cat.saveTable(andres, { zoneId: zone, name: "t1", seats: 2, shape: "square" })).rejects.toThrow(/Ya hay/);
    const rows = await db.query<{ x: number; y: number; qr_token: string }>("select x, y, qr_token from floor_tables where id in ($1, $2)", [t1, t2]);
    expect(rows[0]!.qr_token).not.toBe(rows[1]!.qr_token);
    expect(rows[0]!.x === rows[1]!.x && rows[0]!.y === rows[1]!.y).toBe(false);
    await cat.placeTable(andres, t1, { x: 500, y: -4 });
    expect(await db.one("select x, y from floor_tables where id = $1", [t1])).toEqual({ x: 83, y: 0 });
    await expect(cat.deleteZone(andres, zone)).rejects.toThrow(/mesas/);
    // T1 tuvo una cuenta: se apaga; T2 nunca se usó: se borra
    const c = await checks.openCheck(valentina, { kind: "mesa", tableId: t1 });
    await expect(cat.removeTable(andres, t1)).rejects.toThrow(/cuenta abierta/);
    await checks.discardCheck(valentina, c);
    await cat.removeTable(andres, t1);
    await cat.removeTable(andres, t2);
    expect(await db.one("select active from floor_tables where id = $1", [t1])).toEqual({ active: false });
    expect(await db.one("select 1 from floor_tables where id = $1", [t2])).toBeNull();
    await cat.deleteZone(andres, zone);
  });
});

describe("alta de un local nuevo", () => {
  it("solo con el código del servidor, una sola vez, y deja al dueño adentro", async () => {
    // Base vacía, como una instalación nueva
    await db.query("delete from businesses");
    const { setupBusiness } = await import("../lib/server/setup");
    const input = {
      token: "",
      kind: "bar" as const,
      name: "La Esquina",
      legalName: "La Esquina SAS",
      nit: "900123456-7",
      city: "Manizales, Caldas",
      address: "Cra 23 # 45-10",
      phone: "3001234567",
      sede: "",
      tax: "consumo" as const,
      tables: 5,
      barSeats: 3,
      owner: "Laura",
      pin: "482915",
    };
    process.env.SETUP_TOKEN = "codigo-de-prueba-123";
    await expect(setupBusiness({ ...input, token: "otro-codigo-cualquiera" })).rejects.toThrow(/código/);
    await expect(setupBusiness({ ...input, token: "codigo-de-prueba-123", pin: "123456" })).rejects.toThrow(/fácil/);
    const id = await setupBusiness({ ...input, token: "codigo-de-prueba-123" });
    const owner = (await db.one<{ role: string; pin_len: number }>("select role, pin_len from staff where business_id = $1", [id]))!;
    expect(owner).toEqual({ role: "owner", pin_len: 6 });
    expect(await db.one("select count(*)::int as n from floor_tables where business_id = $1", [id])).toEqual({ n: 8 });
    expect(await db.one("select count(*)::int as n from categories where business_id = $1", [id])).toEqual({ n: 5 });
    expect(await db.one("select count(*)::int as n from devices where business_id = $1 and all_sedes", [id])).toEqual({ n: 1 });
    expect(jar.get("ronda_device")).toBeTruthy();
    expect(jar.get("ronda_session")).toBeTruthy();
    await expect(setupBusiness({ ...input, token: "codigo-de-prueba-123" })).rejects.toThrow(/ya tiene un local/);
  });
});
