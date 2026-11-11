import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Carta en capas contra una base real (PGlite con la demo sembrada): opciones con receta que descuentan insumos,
 * opciones agotadas, grupos de opciones desde el panel, códigos y precio y visibilidad por canal.
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

const dir = mkdtempSync(path.join(tmpdir(), "ronda-carta-"));
let db: Db;
let biz: string;
let checks: typeof import("../lib/server/checks");
let catalog: typeof import("../lib/server/catalog");
let panel: typeof import("../lib/server/panel");
let delivery: typeof import("../lib/server/delivery");
let menus: typeof import("../lib/server/menu");
let valentina: Staff, juanPablo: Staff, andres: Staff;
const products = new Map<string, string>();

beforeAll(async () => {
  process.env.PGLITE_DIR = dir;
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.VERCEL;
  db = await (await import("../lib/server/db")).getDb();
  checks = await import("../lib/server/checks");
  catalog = await import("../lib/server/catalog");
  panel = await import("../lib/server/panel");
  delivery = await import("../lib/server/delivery");
  menus = await import("../lib/server/menu");
  biz = (await db.one<{ id: string }>("select id from businesses order by created_at limit 1"))!.id;
  const person = async (name: string) => (await db.one<Staff>("select id, business_id, name, role, color from staff where business_id = $1 and name = $2", [biz, name]))!;
  [valentina, juanPablo, andres] = await Promise.all([person("Valentina"), person("Juan Pablo"), person("Andrés")]);
  for (const p of await db.query<{ id: string; name: string }>("select id, name from products where business_id = $1", [biz])) products.set(p.name, p.id);
  const zone = (await db.one<{ id: string }>("select id from zones where business_id = $1 order by sort limit 1", [biz]))!.id;
  for (let n = 1; n <= 12; n++) await db.query("insert into floor_tables (business_id, zone_id, name, seats, qr_token) values ($1, $2, $3, 4, $4)", [biz, zone, `C${n}`, `prueba-carta-${n}`]);
}, 180_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function freeTable() {
  const floor = await checks.floorState(biz);
  const t = floor.tables.find((x) => !x.check);
  if (!t) throw new Error("No hay mesas libres en la demo");
  return t;
}
const option = async (name: string) => (await db.one<{ id: string }>("select id from modifiers where business_id = $1 and name = $2", [biz, name]))!.id;
const stock = async (name: string) => Number((await db.one<{ stock: number }>("select stock from ingredients where business_id = $1 and name = $2", [biz, name]))!.stock);

describe("opciones con receta", () => {
  it("una adición descuenta su insumo además de la receta del plato", async () => {
    const before = await stock("Tocineta ahumada");
    const id = await checks.openCheck(juanPablo, { kind: "mesa", tableId: (await freeTable()).id, guests: 1 });
    await checks.addItems(juanPablo, id, [{ productId: products.get("Burger smash doble")!, qty: 2, modifierIds: [await option("Tocineta")] }]);
    await checks.sendRound(juanPablo, id);
    // 30 g de la receta del plato + 30 g de la adición, por dos
    expect(before - (await stock("Tocineta ahumada"))).toBe(120);
  });

  it("la bebida del combo descuenta la lata que se eligió", async () => {
    const [coca, zero] = [await stock("Coca-Cola lata 235 ml"), await stock("Coca-Cola sin azúcar lata")];
    const id = await checks.openCheck(juanPablo, { kind: "mesa", tableId: (await freeTable()).id, guests: 1 });
    await checks.addItems(juanPablo, id, [{ productId: products.get("Combo burger + papas + Coca-Cola")!, qty: 1, modifierIds: [await option("Coca-Cola sin azúcar")] }]);
    await checks.sendRound(juanPablo, id);
    expect(coca - (await stock("Coca-Cola lata 235 ml"))).toBe(0);
    expect(zero - (await stock("Coca-Cola sin azúcar lata"))).toBe(1);
  });

  it("anular sin merma devuelve también lo de la opción", async () => {
    const id = await checks.openCheck(juanPablo, { kind: "mesa", tableId: (await freeTable()).id, guests: 1 });
    await checks.addItems(juanPablo, id, [{ productId: products.get("Burger smash doble")!, qty: 1, modifierIds: [await option("Tocineta")] }]);
    await checks.sendRound(juanPablo, id);
    const after = await stock("Tocineta ahumada");
    const line = (await db.one<{ id: string }>("select id from check_items where check_id = $1", [id]))!.id;
    await checks.voidItem(valentina, line, { reason: "Se equivocó de plato", waste: false });
    expect((await stock("Tocineta ahumada")) - after).toBe(60);
  });
});

describe("opciones agotadas", () => {
  it("una opción agotada no se puede pedir y no se elige sola por defecto", async () => {
    const groups = await catalog.optionGroups(biz);
    const bebida = groups.find((g) => g.name === "Bebida del combo")!;
    await catalog.saveOptionGroup(andres, {
      ...bebida,
      options: bebida.options.map((o) => ({ ...o, soldOut: o.name === "Coca-Cola" })),
    });
    const id = await checks.openCheck(juanPablo, { kind: "mesa", tableId: (await freeTable()).id, guests: 1 });
    await expect(checks.addItems(juanPablo, id, [{ productId: products.get("Combo burger + papas + Coca-Cola")!, qty: 1, modifierIds: [await option("Coca-Cola")] }])).rejects.toThrow(/agotado/);
    // Sin elegir nada, la opción por defecto está agotada: no se pone sola
    await checks.addItems(juanPablo, id, [{ productId: products.get("Combo burger + papas + Coca-Cola")!, qty: 1 }]);
    const line = (await db.one<{ modifiers: { name: string }[] }>("select modifiers from check_items where check_id = $1", [id]))!;
    expect(line.modifiers.map((m) => m.name)).not.toContain("Coca-Cola");
    await catalog.saveOptionGroup(andres, { ...bebida, options: bebida.options.map((o) => ({ ...o, soldOut: false })) });
  });
});

describe("grupos de opciones desde el panel", () => {
  it("crea un grupo, lo asigna a un producto y la carta lo trae en ese orden", async () => {
    const termino = await catalog.saveOptionGroup(andres, {
      name: "Término de la carne",
      min: 1,
      max: 1,
      options: [
        { name: "Medio", price: 0, isDefault: true, code: "ter-1" },
        { name: "Tres cuartos", price: 0, code: "TER-2" },
        { name: "Bien asado", price: 0 },
      ],
    });
    const salsa = (await catalog.optionGroups(biz)).find((g) => g.name === "Salsa")!.id;
    const burger = products.get("Burger clásica con papas")!;
    await catalog.setProductOptionGroups(andres, burger, [termino, salsa]);
    const menu = await menus.loadMenu(biz);
    const p = menu.products.find((x) => x.id === burger)!;
    expect(p.groups).toEqual([termino, salsa]);
    expect(menu.groups[termino]!.options.map((o) => o.code)).toEqual(["TER-1", "TER-2", null]);
  });

  it("revisa las reglas antes de guardar", async () => {
    const base = { name: "Prueba reglas", options: [{ name: "Una", price: 0 }] };
    await expect(catalog.saveOptionGroup(andres, { ...base, min: 2, max: 1 })).rejects.toThrow(/mínimo no puede pasar del máximo/);
    await expect(catalog.saveOptionGroup(andres, { ...base, min: 0, max: 1, options: [] })).rejects.toThrow(/al menos una opción/);
    await expect(
      catalog.saveOptionGroup(andres, { ...base, min: 0, max: 1, options: [{ name: "Una", price: 0, isDefault: true }, { name: "Dos", price: 0, isDefault: true }] }),
    ).rejects.toThrow(/por defecto/);
    await expect(catalog.saveOptionGroup(andres, { ...base, min: 0, max: 2, options: [{ name: "Una", price: 0 }, { name: "una", price: 0 }] })).rejects.toThrow(/repetida/);
    // El código ya lo usa una opción sembrada de otro grupo
    await expect(catalog.saveOptionGroup(andres, { ...base, min: 0, max: 1, options: [{ name: "Una", price: 0, code: "SAL-1" }] })).rejects.toThrow(/ya lo tiene/);
    await expect(catalog.saveOptionGroup(juanPablo, { ...base, min: 0, max: 1 })).rejects.toThrow(/dueño o el administrador/);
  });

  it("guardar de nuevo conserva los ids de las opciones que siguen y borra las que se quitan", async () => {
    const id = await catalog.saveOptionGroup(andres, { name: "Cubiertos", min: 0, max: 1, options: [{ name: "Con cubiertos", price: 0 }, { name: "Sin cubiertos", price: 0 }] });
    const g = (await catalog.optionGroups(biz)).find((x) => x.id === id)!;
    await catalog.saveOptionGroup(andres, { ...g, options: [g.options[0]!, { name: "Con pitillo", price: 0 }] });
    const again = (await catalog.optionGroups(biz)).find((x) => x.id === id)!;
    expect(again.options[0]!.id).toBe(g.options[0]!.id);
    expect(again.options.map((o) => o.name)).toEqual(["Con cubiertos", "Con pitillo"]);
    await catalog.deleteOptionGroup(andres, id);
    expect((await catalog.optionGroups(biz)).some((x) => x.id === id)).toBe(false);
  });
});

describe("códigos de producto", () => {
  it("el código queda en mayúsculas y no se repite en la sede", async () => {
    await panel.updateProduct(andres, products.get("Poker")!, { code: " cer 02 " });
    expect((await db.one<{ code: string }>("select code from products where id = $1", [products.get("Poker")]))!.code).toBe("CER-02");
    await expect(panel.updateProduct(andres, products.get("Club Colombia")!, { code: "cer-02" })).rejects.toThrow(/ya lo tiene Poker/);
    await expect(panel.updateProduct(andres, products.get("Club Colombia")!, { code: "ñ" })).rejects.toThrow(/solo lleva letras/);
  });
});

describe("precio y visibilidad por canal", () => {
  it("un domicilio de Rappi cobra el precio de Rappi y no deja pedir lo que Rappi no ofrece", async () => {
    const id = await delivery.createDelivery(valentina, { channel: "rappi", customer: "Prueba Rappi", code: "R-1" });
    await checks.addItems(valentina, id, [{ productId: products.get("Antojo de patatas")!, qty: 1 }]);
    const line = (await db.one<{ unit_price: number }>("select unit_price from check_items where check_id = $1", [id]))!;
    expect(line.unit_price).toBe(19500); // 17.000 + 15 %, redondeado a $500
    await expect(checks.addItems(valentina, id, [{ productId: products.get("Club Colombia")!, qty: 1 }])).rejects.toThrow(/ya no está en la carta/);
  });

  it("para llevar sin precio propio cobra lo del local; con precio propio, el suyo", async () => {
    const antojo = products.get("Antojo de patatas")!;
    const id = await checks.openCheck(valentina, { kind: "llevar", name: "Prueba llevar" });
    await checks.addItems(valentina, id, [{ productId: antojo, qty: 1 }]);
    expect((await db.one<{ unit_price: number }>("select unit_price from check_items where check_id = $1", [id]))!.unit_price).toBe(17000);
    await panel.updateProduct(andres, antojo, { channelPrices: { llevar: 16000, rappi: 19500 } });
    const id2 = await checks.openCheck(valentina, { kind: "llevar", name: "Prueba llevar 2" });
    await checks.addItems(valentina, id2, [{ productId: antojo, qty: 1 }]);
    expect((await db.one<{ unit_price: number }>("select unit_price from check_items where check_id = $1", [id2]))!.unit_price).toBe(16000);
  });

  it("lo que se oculta en el local tampoco entra en una mesa", async () => {
    const poker = products.get("Poker")!;
    await panel.updateProduct(andres, poker, { hiddenChannels: ["local", "inventado"] });
    expect((await db.one<{ hidden_channels: string[] }>("select hidden_channels from products where id = $1", [poker]))!.hidden_channels).toEqual(["local"]);
    const id = await checks.openCheck(juanPablo, { kind: "mesa", tableId: (await freeTable()).id, guests: 1 });
    await expect(checks.addItems(juanPablo, id, [{ productId: poker, qty: 1 }])).rejects.toThrow(/ya no está en la carta/);
    await panel.updateProduct(andres, poker, { hiddenChannels: [] });
  });
});
