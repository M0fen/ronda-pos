/**
 * Datos de ejemplo del café bar: carta, salón, equipo, insumos con recetas, clientes,
 * dos semanas de ventas y el servicio en curso. Ids estables (stableId) para que cualquier
 * instancia de la demo genere los mismos y los enlaces sirvan entre dispositivos.
 * Se importa desde scripts: no usa server-only.
 */
import { createHash } from "node:crypto";
import type { Db } from "./db-core";
import { checkTotals, splitTax, suggestedTip } from "./core/pricing";
import { bogotaParts } from "./core/time";
import { DEFAULT_SETTINGS } from "./settings";

export function stableId(key: string) {
  const h = createHash("sha1").update(`ronda:${key}`).digest("hex");
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function pinHash(staffId: string, pin: string) {
  return createHash("sha256").update(`ronda-pin:${staffId}:${pin}`).digest("hex");
}

export function token(key: string, length = 10) {
  return createHash("sha256").update(`ronda-token:${key}`).digest("base64url").replace(/[-_]/g, "").slice(0, length);
}

/** Generador pseudoaleatorio con semilla: la misma semilla da los mismos datos en cualquier instancia. */
function rng(seed: string) {
  let a = parseInt(createHash("md5").update(seed).digest("hex").slice(0, 8), 16);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Col = [name: string, type: string];

/** Inserta muchas filas en una sola consulta (rápido también en PGlite). */
export async function bulkInsert(db: Pick<Db, "query">, table: string, cols: Col[], rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 2000) {
    const chunk = rows.slice(i, i + 2000);
    if (!chunk.length) continue;
    const names = cols.map((c) => c[0]).join(", ");
    const defs = cols.map(([n, t]) => `${n} ${t}`).join(", ");
    await db.query(`insert into ${table} (${names}) select ${names} from jsonb_to_recordset($1::jsonb) as x(${defs})`, [JSON.stringify(chunk)]);
  }
}

export const DEMO_BUSINESS_ID = stableId("biz:villa-verde");

export const DEMO_STAFF = [
  { key: "andres", name: "Andrés", role: "owner", pin: "1234", color: "#1E4FB8" },
  { key: "valentina", name: "Valentina", role: "cashier", pin: "2222", color: "#0B7A55" },
  { key: "juanpablo", name: "Juan Pablo", role: "waiter", pin: "3333", color: "#D2232A" },
  { key: "camila", name: "Camila", role: "waiter", pin: "4444", color: "#B07800" },
  { key: "mateo", name: "Mateo", role: "bar", pin: "5555", color: "#7A4A2A" },
] as const;

const ZONES = [
  { key: "salon", name: "Salón" },
  { key: "terraza", name: "Terraza" },
  { key: "barra", name: "Barra" },
];

// x, y en porcentaje del plano de cada zona
const TABLES: { n: string; zone: string; seats: number; x: number; y: number; shape: "round" | "square" | "long" }[] = [
  { n: "1", zone: "salon", seats: 2, x: 6, y: 10, shape: "round" },
  { n: "2", zone: "salon", seats: 2, x: 6, y: 56, shape: "round" },
  { n: "3", zone: "salon", seats: 4, x: 30, y: 10, shape: "square" },
  { n: "4", zone: "salon", seats: 4, x: 30, y: 56, shape: "square" },
  { n: "5", zone: "salon", seats: 4, x: 54, y: 10, shape: "square" },
  { n: "6", zone: "salon", seats: 4, x: 54, y: 56, shape: "square" },
  { n: "7", zone: "salon", seats: 6, x: 78, y: 10, shape: "long" },
  { n: "8", zone: "salon", seats: 6, x: 78, y: 56, shape: "long" },
  { n: "9", zone: "terraza", seats: 6, x: 6, y: 10, shape: "long" },
  { n: "10", zone: "terraza", seats: 4, x: 32, y: 10, shape: "square" },
  { n: "11", zone: "terraza", seats: 4, x: 56, y: 10, shape: "square" },
  { n: "12", zone: "terraza", seats: 4, x: 80, y: 10, shape: "square" },
  { n: "13", zone: "terraza", seats: 2, x: 32, y: 58, shape: "round" },
  { n: "14", zone: "terraza", seats: 2, x: 56, y: 58, shape: "round" },
  { n: "B1", zone: "barra", seats: 1, x: 8, y: 30, shape: "round" },
  { n: "B2", zone: "barra", seats: 1, x: 30, y: 30, shape: "round" },
  { n: "B3", zone: "barra", seats: 1, x: 52, y: 30, shape: "round" },
  { n: "B4", zone: "barra", seats: 1, x: 74, y: 30, shape: "round" },
];

const CATEGORIES = [
  { key: "cafe", name: "Café", color: "#7A4A2A", station: "barra" },
  { key: "sin-alcohol", name: "Sin alcohol", color: "#0B7A55", station: "barra" },
  { key: "cervezas", name: "Cervezas", color: "#B07800", station: "barra" },
  { key: "cocteles", name: "Cócteles", color: "#D2232A", station: "barra" },
  { key: "licores", name: "Licores", color: "#1E4FB8", station: "barra" },
  { key: "picar", name: "Para picar", color: "#C2541B", station: "cocina" },
  { key: "postres", name: "Postres", color: "#9B3D8F", station: "cocina" },
];

const MOD_GROUPS = [
  { key: "leche", name: "Leche", min: 1, max: 1, options: [["Entera", 0, true], ["Deslactosada", 0], ["Almendras", 2500], ["Avena", 2500]] },
  { key: "tamano", name: "Tamaño", min: 0, max: 1, options: [["Grande", 2000]] },
  { key: "extras", name: "Extras", min: 0, max: 3, options: [["Shot extra", 2500], ["Crema batida", 1500], ["Canela", 0], ["Sin azúcar", 0]] },
  { key: "preparacion", name: "Preparación", min: 0, max: 1, options: [["Michelada", 2500], ["Michelada de maracuyá", 3500]] },
  { key: "sabor", name: "Sabor", min: 1, max: 1, options: [["Mora", 0, true], ["Lulo", 0], ["Maracuyá", 0], ["Mango", 0], ["Fresa", 0]] },
  { key: "salsa", name: "Salsa", min: 1, max: 1, options: [["BBQ", 0, true], ["Búfalo", 0], ["Miel mostaza", 0]] },
] as const;

const INGREDIENTS: { key: string; name: string; unit: "g" | "ml" | "und"; stock: number; min: number; cost: number; pack?: [number, string]; kind?: string }[] = [
  { key: "cafe", name: "Café en grano de la casa", unit: "g", stock: 4200, min: 1500, cost: 60, pack: [500, "bolsa"] },
  { key: "leche", name: "Leche entera", unit: "ml", stock: 16000, min: 6000, cost: 4.8, pack: [1000, "litro"] },
  { key: "chocolate", name: "Chocolate en polvo", unit: "g", stock: 1200, min: 400, cost: 30, pack: [1000, "kilo"] },
  { key: "helado", name: "Helado de vainilla", unit: "g", stock: 2400, min: 1000, cost: 22, pack: [1000, "kilo"] },
  { key: "coco", name: "Crema de coco", unit: "ml", stock: 1800, min: 1000, cost: 18, pack: [400, "lata"] },
  { key: "pulpa", name: "Pulpa de fruta", unit: "g", stock: 3000, min: 1500, cost: 12, pack: [1000, "kilo"] },
  { key: "limon", name: "Limón", unit: "und", stock: 70, min: 40, cost: 400 },
  { key: "hierbabuena", name: "Hierbabuena", unit: "g", stock: 250, min: 150, cost: 20 },
  { key: "tonica", name: "Agua tónica", unit: "und", stock: 30, min: 24, cost: 3200 },
  { key: "aguardiente", name: "Aguardiente Cristal", unit: "ml", stock: 6750, min: 3000, cost: 70, pack: [750, "botella"], kind: "licor" },
  { key: "ron-caldas", name: "Ron Viejo de Caldas", unit: "ml", stock: 4500, min: 2250, cost: 78, pack: [750, "botella"], kind: "licor" },
  { key: "ron-blanco", name: "Ron blanco", unit: "ml", stock: 2100, min: 1500, cost: 60, pack: [750, "botella"], kind: "licor" },
  { key: "ginebra", name: "Ginebra", unit: "ml", stock: 1300, min: 1400, cost: 120, pack: [700, "botella"], kind: "licor" },
  { key: "tequila", name: "Tequila", unit: "ml", stock: 1500, min: 1400, cost: 110, pack: [750, "botella"], kind: "licor" },
  { key: "vodka", name: "Vodka", unit: "ml", stock: 1400, min: 750, cost: 85, pack: [750, "botella"], kind: "licor" },
  { key: "licor-cafe", name: "Licor de café", unit: "ml", stock: 700, min: 350, cost: 95, pack: [700, "botella"], kind: "licor" },
  { key: "club", name: "Cerveza Club Colombia", unit: "und", stock: 64, min: 48, cost: 3300, kind: "cerveza" },
  { key: "poker", name: "Cerveza Poker", unit: "und", stock: 90, min: 72, cost: 2600, kind: "cerveza" },
  { key: "aguila", name: "Cerveza Águila", unit: "und", stock: 40, min: 48, cost: 2600, kind: "cerveza" },
  { key: "corona", name: "Cerveza Corona", unit: "und", stock: 22, min: 24, cost: 5200, kind: "cerveza" },
  { key: "empanadas", name: "Empanadas", unit: "und", stock: 54, min: 30, cost: 1100 },
  { key: "pandebono", name: "Pandebonos", unit: "und", stock: 36, min: 30, cost: 900 },
  { key: "alitas", name: "Alitas de pollo", unit: "g", stock: 6000, min: 3000, cost: 24, pack: [1000, "kilo"] },
  { key: "queso", name: "Queso campesino", unit: "g", stock: 1800, min: 1000, cost: 22, pack: [1000, "kilo"] },
  { key: "pan", name: "Pan artesanal", unit: "und", stock: 18, min: 12, cost: 1800 },
  { key: "torta", name: "Porción de torta de chocolate", unit: "und", stock: 10, min: 6, cost: 3500 },
  { key: "cheesecake", name: "Porción de cheesecake", unit: "und", stock: 5, min: 6, cost: 4200 },
];

type P = { key: string; cat: string; name: string; price: number; happy?: number; desc?: string; mods?: string[]; recipe?: [string, number][]; fav?: boolean; station?: string; tax?: number };

const PRODUCTS: P[] = [
  { key: "tinto", cat: "cafe", name: "Tinto campesino", price: 3500, desc: "Café de la casa, colado como en finca.", recipe: [["cafe", 10]], fav: true },
  { key: "espresso", cat: "cafe", name: "Espresso", price: 5000, mods: ["extras"], recipe: [["cafe", 18]] },
  { key: "americano", cat: "cafe", name: "Americano", price: 5500, mods: ["tamano", "extras"], recipe: [["cafe", 18]] },
  { key: "capuchino", cat: "cafe", name: "Capuchino", price: 8500, mods: ["leche", "tamano", "extras"], recipe: [["cafe", 18], ["leche", 150]], fav: true },
  { key: "latte", cat: "cafe", name: "Latte", price: 9000, mods: ["leche", "tamano", "extras"], recipe: [["cafe", 18], ["leche", 220]], fav: true },
  { key: "mocaccino", cat: "cafe", name: "Mocaccino", price: 10000, mods: ["leche", "tamano", "extras"], recipe: [["cafe", 18], ["leche", 180], ["chocolate", 15]] },
  { key: "v60", cat: "cafe", name: "Café de origen en V60", price: 12000, desc: "Finca de Santuario, Risaralda. Notas a panela y frutos rojos.", recipe: [["cafe", 20]] },
  { key: "cold-brew", cat: "cafe", name: "Cold brew", price: 10500, recipe: [["cafe", 25]] },
  { key: "affogato", cat: "cafe", name: "Affogato", price: 12000, recipe: [["cafe", 18], ["helado", 100]] },
  { key: "limonada-coco", cat: "sin-alcohol", name: "Limonada de coco", price: 11000, recipe: [["coco", 120], ["limon", 1]], fav: true },
  { key: "jugo", cat: "sin-alcohol", name: "Jugo natural", price: 8000, mods: ["sabor"], recipe: [["pulpa", 150]] },
  { key: "soda", cat: "sin-alcohol", name: "Soda italiana", price: 10000 },
  { key: "aromatica", cat: "sin-alcohol", name: "Aromática de frutas", price: 5000 },
  { key: "agua", cat: "sin-alcohol", name: "Agua", price: 4000 },
  { key: "club", cat: "cervezas", name: "Club Colombia", price: 7500, happy: 5900, mods: ["preparacion"], recipe: [["club", 1]], fav: true },
  { key: "poker", cat: "cervezas", name: "Poker", price: 6000, happy: 4500, mods: ["preparacion"], recipe: [["poker", 1]], fav: true },
  { key: "aguila", cat: "cervezas", name: "Águila", price: 6000, happy: 4500, mods: ["preparacion"], recipe: [["aguila", 1]] },
  { key: "corona", cat: "cervezas", name: "Corona", price: 12000, recipe: [["corona", 1]] },
  { key: "artesanal", cat: "cervezas", name: "Cerveza artesanal de la región", price: 14000, desc: "Pregunta cuál llegó esta semana." },
  { key: "cubetazo", cat: "cervezas", name: "Cubetazo Poker x6", price: 32000, recipe: [["poker", 6]] },
  { key: "mojito", cat: "cocteles", name: "Mojito", price: 26000, happy: 19900, recipe: [["ron-blanco", 60], ["limon", 1], ["hierbabuena", 8]], fav: true },
  { key: "margarita", cat: "cocteles", name: "Margarita", price: 27000, happy: 19900, recipe: [["tequila", 60], ["limon", 1]] },
  { key: "gin-tonic", cat: "cocteles", name: "Gin tonic", price: 30000, happy: 22900, recipe: [["ginebra", 60], ["tonica", 1], ["limon", 0.5]] },
  { key: "espresso-martini", cat: "cocteles", name: "Espresso martini", price: 29000, happy: 21900, recipe: [["cafe", 18], ["licor-cafe", 30], ["vodka", 45]] },
  { key: "carajillo", cat: "cocteles", name: "Carajillo", price: 22000, recipe: [["cafe", 18], ["licor-cafe", 45]] },
  { key: "canelazo", cat: "cocteles", name: "Canelazo de aguardiente", price: 18000, recipe: [["aguardiente", 45]] },
  { key: "trago-aguardiente", cat: "licores", name: "Trago de aguardiente Cristal", price: 8000, recipe: [["aguardiente", 30]] },
  { key: "media-aguardiente", cat: "licores", name: "Media de aguardiente Cristal", price: 65000, recipe: [["aguardiente", 375]] },
  { key: "botella-aguardiente", cat: "licores", name: "Botella de aguardiente Cristal", price: 115000, recipe: [["aguardiente", 750]] },
  { key: "trago-ron", cat: "licores", name: "Trago de ron Viejo de Caldas", price: 9000, recipe: [["ron-caldas", 30]] },
  { key: "media-ron", cat: "licores", name: "Media de ron Viejo de Caldas", price: 75000, recipe: [["ron-caldas", 375]] },
  { key: "botella-ron", cat: "licores", name: "Botella de ron Viejo de Caldas", price: 130000, recipe: [["ron-caldas", 750]] },
  { key: "empanadas", cat: "picar", name: "Empanadas x3", price: 10500, desc: "Con ají de la casa.", recipe: [["empanadas", 3]], fav: true },
  { key: "pandebonos", cat: "picar", name: "Pandebonos x3", price: 9000, recipe: [["pandebono", 3]] },
  { key: "arepa", cat: "picar", name: "Arepa de chócolo con quesito", price: 14000, recipe: [["queso", 60]] },
  { key: "nachos", cat: "picar", name: "Nachos con guacamole", price: 24000, recipe: [["queso", 80]] },
  { key: "alitas", cat: "picar", name: "Alitas (8)", price: 28000, mods: ["salsa"], recipe: [["alitas", 350]] },
  { key: "tabla", cat: "picar", name: "Tabla de quesos y carnes frías", price: 38000, desc: "Para compartir entre 3 o 4.", recipe: [["queso", 200]] },
  { key: "patacones", cat: "picar", name: "Patacones con hogao", price: 16000 },
  { key: "cubano", cat: "picar", name: "Sándwich cubano", price: 23000, recipe: [["pan", 1], ["queso", 50]] },
  { key: "torta", cat: "postres", name: "Torta de chocolate", price: 11000, recipe: [["torta", 1]] },
  { key: "cheesecake", cat: "postres", name: "Cheesecake de maracuyá", price: 13000, recipe: [["cheesecake", 1]] },
  { key: "brownie", cat: "postres", name: "Brownie con helado", price: 14000, recipe: [["helado", 80]] },
];

const FIRST = ["Laura", "Sebastián", "Valeria", "Santiago", "Mariana", "Felipe", "Daniela", "Andrés", "Juliana", "Camilo", "Paula", "Mateo", "Natalia", "Simón", "Sara", "Tomás", "Isabela", "Nicolás", "Manuela", "Esteban", "Luisa", "David", "Carolina", "Julián", "Ana María", "Alejandro", "Gabriela", "Miguel", "Catalina", "Samuel"];
const LAST = ["Restrepo", "Gómez", "Arango", "Londoño", "Mejía", "Ospina", "Cardona", "Henao", "Giraldo", "Valencia", "Botero", "Rendón", "Marín", "Zapata", "Correa"];

const id = (kind: string, key: string) => stableId(`${kind}:${key}`);

/** Catálogo, salón, equipo, insumos y clientes. No depende de la hora. */
export async function seedBusiness(db: Db) {
  const biz = DEMO_BUSINESS_ID;
  await db.query("insert into businesses (id, name, slug, settings) values ($1, $2, 'villa-verde', $3::jsonb) on conflict (id) do nothing", [
    biz,
    DEFAULT_SETTINGS.business.name,
    JSON.stringify(DEFAULT_SETTINGS),
  ]);
  await db.query("insert into pulse (business_id, version) values ($1, 1) on conflict do nothing", [biz]);

  await bulkInsert(
    db,
    "staff",
    [["id", "uuid"], ["business_id", "uuid"], ["name", "text"], ["role", "text"], ["pin_hash", "text"], ["color", "text"]],
    DEMO_STAFF.map((s) => ({ id: id("staff", s.key), business_id: biz, name: s.name, role: s.role, pin_hash: pinHash(id("staff", s.key), s.pin), color: s.color })),
  );

  await bulkInsert(
    db,
    "zones",
    [["id", "uuid"], ["business_id", "uuid"], ["name", "text"], ["sort", "int"]],
    ZONES.map((z, i) => ({ id: id("zone", z.key), business_id: biz, name: z.name, sort: i })),
  );
  await bulkInsert(
    db,
    "floor_tables",
    [["id", "uuid"], ["business_id", "uuid"], ["zone_id", "uuid"], ["name", "text"], ["seats", "int"], ["x", "int"], ["y", "int"], ["shape", "text"], ["qr_token", "text"]],
    TABLES.map((t) => ({ id: id("table", t.n), business_id: biz, zone_id: id("zone", t.zone), name: t.n, seats: t.seats, x: t.x, y: t.y, shape: t.shape, qr_token: `vv${t.n.toLowerCase()}${token(`table:${t.n}`, 6)}` })),
  );

  await bulkInsert(
    db,
    "categories",
    [["id", "uuid"], ["business_id", "uuid"], ["name", "text"], ["color", "text"], ["station", "text"], ["sort", "int"]],
    CATEGORIES.map((c, i) => ({ id: id("cat", c.key), business_id: biz, name: c.name, color: c.color, station: c.station, sort: i })),
  );

  await bulkInsert(
    db,
    "modifier_groups",
    [["id", "uuid"], ["business_id", "uuid"], ["name", "text"], ["min_select", "int"], ["max_select", "int"], ["sort", "int"]],
    MOD_GROUPS.map((g, i) => ({ id: id("mg", g.key), business_id: biz, name: g.name, min_select: g.min, max_select: g.max, sort: i })),
  );
  await bulkInsert(
    db,
    "modifiers",
    [["id", "uuid"], ["business_id", "uuid"], ["group_id", "uuid"], ["name", "text"], ["price", "int"], ["is_default", "boolean"], ["sort", "int"]],
    MOD_GROUPS.flatMap((g) =>
      g.options.map((o, i) => ({ id: id("mod", `${g.key}:${o[0]}`), business_id: biz, group_id: id("mg", g.key), name: o[0], price: o[1], is_default: o.length > 2 && !!o[2], sort: i })),
    ),
  );

  const cats = new Map(CATEGORIES.map((c) => [c.key, c]));
  await bulkInsert(
    db,
    "products",
    [["id", "uuid"], ["business_id", "uuid"], ["category_id", "uuid"], ["name", "text"], ["description", "text"], ["price", "int"], ["happy_price", "int"], ["tax_rate", "numeric"], ["station", "text"], ["favorite", "boolean"], ["sort", "int"]],
    PRODUCTS.map((p, i) => ({
      id: id("prod", p.key),
      business_id: biz,
      category_id: id("cat", p.cat),
      name: p.name,
      description: p.desc ?? "",
      price: p.price,
      happy_price: p.happy ?? null,
      tax_rate: p.tax ?? 8,
      station: p.station ?? cats.get(p.cat)!.station,
      favorite: !!p.fav,
      sort: i,
    })),
  );
  await bulkInsert(
    db,
    "product_modifier_groups",
    [["product_id", "uuid"], ["group_id", "uuid"], ["sort", "int"]],
    PRODUCTS.flatMap((p) => (p.mods ?? []).map((m, i) => ({ product_id: id("prod", p.key), group_id: id("mg", m), sort: i }))),
  );

  await bulkInsert(
    db,
    "ingredients",
    [["id", "uuid"], ["business_id", "uuid"], ["name", "text"], ["unit", "text"], ["stock", "numeric"], ["min_stock", "numeric"], ["cost", "numeric"], ["pack_size", "numeric"], ["pack_label", "text"], ["kind", "text"]],
    INGREDIENTS.map((g) => ({
      id: id("ing", g.key),
      business_id: biz,
      name: g.name,
      unit: g.unit,
      stock: g.stock,
      min_stock: g.min,
      cost: g.cost,
      pack_size: g.pack?.[0] ?? null,
      pack_label: g.pack?.[1] ?? null,
      kind: g.kind ?? "insumo",
    })),
  );
  await bulkInsert(
    db,
    "recipe_items",
    [["business_id", "uuid"], ["product_id", "uuid"], ["ingredient_id", "uuid"], ["qty", "numeric"]],
    PRODUCTS.flatMap((p) => (p.recipe ?? []).map(([ing, qty]) => ({ business_id: biz, product_id: id("prod", p.key), ingredient_id: id("ing", ing), qty }))),
  );
}

type Line = { prod: P; qty: number; mods: { name: string; price: number }[] };

function pick<T>(r: () => number, list: readonly T[]) {
  return list[Math.floor(r() * list.length)]!;
}

/** Productos que se piden según la hora: café en la mañana, cerveza y cócteles en la noche. */
function orderFor(r: () => number, hour: number): Line[] {
  const byKey = new Map(PRODUCTS.map((p) => [p.key, p]));
  const morning = ["tinto", "capuchino", "latte", "americano", "mocaccino", "pandebonos", "empanadas", "arepa", "jugo", "v60", "cold-brew", "torta"];
  const afternoon = ["capuchino", "latte", "limonada-coco", "affogato", "cheesecake", "brownie", "empanadas", "soda", "club", "cold-brew", "cubano"];
  const night = ["club", "poker", "poker", "aguila", "corona", "mojito", "gin-tonic", "margarita", "espresso-martini", "nachos", "alitas", "tabla", "trago-aguardiente", "media-aguardiente", "cubetazo", "patacones", "carajillo", "canelazo", "trago-ron"];
  const pool = hour < 12 ? morning : hour < 18 ? afternoon : night;
  const lines: Line[] = [];
  const count = 1 + Math.floor(r() * (hour >= 18 ? 4 : 3));
  for (let i = 0; i < count; i++) {
    const prod = byKey.get(pick(r, pool))!;
    const mods: Line["mods"] = [];
    if (prod.mods?.includes("leche") && r() < 0.25) mods.push(r() < 0.5 ? { name: "Almendras", price: 2500 } : { name: "Avena", price: 2500 });
    if (prod.mods?.includes("tamano") && r() < 0.3) mods.push({ name: "Grande", price: 2000 });
    if (prod.mods?.includes("preparacion") && r() < 0.35) mods.push({ name: "Michelada", price: 2500 });
    if (prod.mods?.includes("sabor")) mods.push({ name: pick(r, ["Mora", "Lulo", "Maracuyá", "Mango"]), price: 0 });
    if (prod.mods?.includes("salsa")) mods.push({ name: pick(r, ["BBQ", "Búfalo", "Miel mostaza"]), price: 0 });
    const qty = prod.key.startsWith("media") || prod.key.startsWith("botella") || prod.key === "tabla" ? 1 : 1 + Math.floor(r() * (hour >= 18 ? 3 : 2));
    const existing = lines.find((l) => l.prod.key === prod.key && JSON.stringify(l.mods) === JSON.stringify(mods));
    if (existing) existing.qty += qty;
    else lines.push({ prod, qty, mods });
  }
  return lines;
}

const CHECK_COLS: Col[] = [
  ["id", "uuid"], ["business_id", "uuid"], ["number", "int"], ["table_id", "uuid"], ["kind", "text"], ["name", "text"], ["guests", "int"], ["status", "text"],
  ["opened_by", "uuid"], ["opened_at", "timestamptz"], ["closed_by", "uuid"], ["closed_at", "timestamptz"], ["customer_id", "uuid"], ["discount_pct", "int"], ["tip_answer", "text"], ["updated_at", "timestamptz"],
];
const ITEM_COLS: Col[] = [
  ["id", "uuid"], ["business_id", "uuid"], ["check_id", "uuid"], ["product_id", "uuid"], ["name", "text"], ["unit_price", "int"], ["qty", "int"], ["modifiers", "jsonb"], ["note", "text"],
  ["station", "text"], ["tax_rate", "numeric"], ["status", "text"], ["round", "int"], ["source", "text"], ["added_by", "uuid"], ["sent_at", "timestamptz"], ["ready_at", "timestamptz"], ["delivered_at", "timestamptz"],
  ["void_reason", "text"], ["void_by", "uuid"], ["created_at", "timestamptz"],
];
const PAY_COLS: Col[] = [
  ["id", "uuid"], ["business_id", "uuid"], ["check_id", "uuid"], ["method", "text"], ["amount", "int"], ["tip", "int"], ["received", "int"], ["reference", "text"], ["part", "text"], ["status", "text"],
  ["created_by", "uuid"], ["cash_session_id", "uuid"], ["created_at", "timestamptz"],
];
const INV_COLS: Col[] = [
  ["id", "uuid"], ["business_id", "uuid"], ["check_id", "uuid"], ["number", "int"], ["prefix", "text"], ["cufe", "text"], ["public_token", "text"], ["kind", "text"], ["subtotal", "int"], ["tax", "int"], ["tip", "int"], ["total", "int"], ["created_at", "timestamptz"],
];

export function fakeCufe(parts: (string | number)[]) {
  return createHash("sha384").update(parts.join("|")).digest("hex");
}

/** Dos semanas de ventas, el servicio de hoy hasta el comienzo de esta hora y lo que está pasando ahora. */
export async function seedActivity(db: Db, now = new Date()) {
  const biz = DEMO_BUSINESS_ID;
  const staff = (k: string) => id("staff", k);
  const waiters = ["juanpablo", "camila"];
  const tables = TABLES.filter((t) => t.zone !== "barra");
  const ingByProduct = new Map(PRODUCTS.map((p) => [p.key, p.recipe ?? []]));

  // Clientes del programa de sellos
  const customers = Array.from({ length: 34 }, (_, i) => {
    const r = rng(`cust:${i}`);
    const phone = `3${String(10 + Math.floor(r() * 89))}${String(1000000 + Math.floor(r() * 8999999))}`.slice(0, 10);
    const visits = 1 + Math.floor(r() * 22);
    const lastDays = i < 6 ? 35 + Math.floor(r() * 40) : Math.floor(r() * 20);
    const month = bogotaParts(now).dayKey.slice(5, 7);
    return {
      id: id("cust", String(i)),
      business_id: biz,
      phone,
      name: `${FIRST[i % FIRST.length]} ${LAST[Math.floor(r() * LAST.length)]}`,
      birthday: i % 9 === 0 ? `${month}-${String(5 + (i % 20)).padStart(2, "0")}` : null,
      consent_at: new Date(now.getTime() - (60 + i) * 86_400_000).toISOString(),
      stamps: visits % 8,
      visits,
      total_spent: visits * (28000 + Math.floor(r() * 30000)),
      last_visit: new Date(now.getTime() - lastDays * 86_400_000).toISOString(),
    };
  });
  await bulkInsert(
    db,
    "customers",
    [["id", "uuid"], ["business_id", "uuid"], ["phone", "text"], ["name", "text"], ["birthday", "text"], ["consent_at", "timestamptz"], ["stamps", "int"], ["visits", "int"], ["total_spent", "int"], ["last_visit", "timestamptz"]],
    customers,
  );

  const checks: Record<string, unknown>[] = [];
  const items: Record<string, unknown>[] = [];
  const payments: Record<string, unknown>[] = [];
  const invoices: Record<string, unknown>[] = [];
  const audit: Record<string, unknown>[] = [];
  const usage = new Map<string, Map<string, number>>();
  let number = 101;
  let invoiceNumber = 1001;

  const today = bogotaParts(now);
  // Hoy: hasta el comienzo de la hora en curso, para que dos instancias de la misma hora coincidan
  const cutoff = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
  const methods: [string, number][] = [["efectivo", 0.3], ["tarjeta", 0.24], ["nequi", 0.2], ["breb", 0.22], ["daviplata", 0.04]];

  for (let d = 14; d >= 0; d--) {
    const dayStartUtc = Date.parse(`${bogotaParts(new Date(now.getTime() - d * 86_400_000)).dayKey}T08:00:00-05:00`);
    const dayKey = new Date(dayStartUtc - 5 * 3_600_000).toISOString().slice(0, 10);
    const r = rng(`day:${dayKey}`);
    const dow = bogotaParts(new Date(dayStartUtc)).dow;
    const busy = dow >= 4 && dow <= 6 ? 1.6 : dow === 7 ? 1.1 : 1;
    const count = Math.round((24 + r() * 10) * busy);
    for (let n = 0; n < count; n++) {
      // Horas del día: picos a media mañana, tarde y noche
      const slot = r();
      const hour = slot < 0.3 ? 8 + Math.floor(r() * 4) : slot < 0.55 ? 12 + Math.floor(r() * 6) : 18 + Math.floor(r() * 6);
      const opened = new Date(dayStartUtc + (hour - 8) * 3_600_000 + Math.floor(r() * 50) * 60_000);
      const minutes = 25 + Math.floor(r() * (hour >= 18 ? 90 : 45));
      const closed = new Date(opened.getTime() + minutes * 60_000);
      if (closed > cutoff) continue;
      const checkId = stableId(`hist:${dayKey}:${n}`);
      const waiter = pick(r, waiters);
      const table = pick(r, tables);
      const kind = r() < 0.12 ? "llevar" : "mesa";
      const lines = orderFor(r, hour);
      const customer = r() < 0.3 ? customers[Math.floor(r() * customers.length)]! : null;
      lines.forEach((l, i) => {
        const sentAt = new Date(opened.getTime() + (2 + i) * 60_000);
        items.push({
          id: stableId(`hist:${dayKey}:${n}:${i}`),
          business_id: biz,
          check_id: checkId,
          product_id: id("prod", l.prod.key),
          name: l.prod.name,
          unit_price: l.prod.price,
          qty: l.qty,
          modifiers: l.mods,
          note: "",
          station: l.prod.cat === "picar" || l.prod.cat === "postres" ? "cocina" : "barra",
          tax_rate: 8,
          status: "delivered",
          round: 1,
          source: r() < 0.15 ? "qr" : "staff",
          added_by: staff(waiter),
          sent_at: sentAt.toISOString(),
          ready_at: new Date(sentAt.getTime() + (3 + Math.floor(r() * 12)) * 60_000).toISOString(),
          delivered_at: new Date(sentAt.getTime() + (5 + Math.floor(r() * 12)) * 60_000).toISOString(),
          void_reason: null,
          void_by: null,
          created_at: sentAt.toISOString(),
        });
        for (const [ing, qty] of ingByProduct.get(l.prod.key) ?? []) {
          const day = usage.get(dayKey) ?? new Map<string, number>();
          day.set(ing, (day.get(ing) ?? 0) + qty * l.qty);
          usage.set(dayKey, day);
        }
      });
      // Una anulación de vez en cuando, para que el reporte tenga qué mostrar
      if (r() < 0.05) {
        const prod = pick(r, PRODUCTS);
        const reason = pick(r, ["El cliente cambió de opinión", "Se marcó dos veces", "Demoró mucho"]);
        items.push({
          id: stableId(`hist:${dayKey}:${n}:void`),
          business_id: biz,
          check_id: checkId,
          product_id: id("prod", prod.key),
          name: prod.name,
          unit_price: prod.price,
          qty: 1,
          modifiers: [],
          note: "",
          station: prod.cat === "picar" || prod.cat === "postres" ? "cocina" : "barra",
          tax_rate: 8,
          status: "void",
          round: 1,
          source: "staff",
          added_by: staff(waiter),
          sent_at: opened.toISOString(),
          ready_at: null,
          delivered_at: null,
          void_reason: reason,
          void_by: staff("valentina"),
          created_at: opened.toISOString(),
        });
        audit.push({ id: stableId(`hist:${dayKey}:${n}:audit`), business_id: biz, staff_id: staff("valentina"), action: "void", detail: { item: prod.name, check: number, reason }, amount: prod.price, created_at: opened.toISOString() });
      }
      const totals = checkTotals(lines.map((l) => ({ unitPrice: l.prod.price, qty: l.qty, modifiers: l.mods, taxRate: 8 })));
      const tipYes = r() < 0.62;
      const tip = tipYes ? suggestedTip(totals.total, 10) : 0;
      let roll = r();
      let method = "efectivo";
      for (const [m, w] of methods) {
        if (roll < w) {
          method = m;
          break;
        }
        roll -= w;
      }
      const received = method === "efectivo" ? Math.ceil((totals.total + tip) / 10000) * 10000 : null;
      checks.push({
        id: checkId,
        business_id: biz,
        number: number++,
        table_id: kind === "mesa" ? id("table", table.n) : null,
        kind,
        name: kind === "llevar" ? pick(r, FIRST) : "",
        guests: 1 + Math.floor(r() * 4),
        status: "paid",
        opened_by: staff(waiter),
        opened_at: opened.toISOString(),
        closed_by: staff("valentina"),
        closed_at: closed.toISOString(),
        customer_id: customer?.id ?? null,
        discount_pct: 0,
        tip_answer: tipYes ? "si" : "no",
        updated_at: closed.toISOString(),
      });
      payments.push({
        id: stableId(`hist:${dayKey}:${n}:pay`),
        business_id: biz,
        check_id: checkId,
        method,
        amount: totals.total,
        tip,
        received,
        reference: method === "efectivo" ? "" : String(100000 + Math.floor(r() * 899999)),
        part: "",
        status: "ok",
        created_by: staff("valentina"),
        cash_session_id: null,
        created_at: closed.toISOString(),
      });
      const num = invoiceNumber++;
      invoices.push({
        id: stableId(`hist:${dayKey}:${n}:inv`),
        business_id: biz,
        check_id: checkId,
        number: num,
        prefix: DEFAULT_SETTINGS.invoice.prefix,
        cufe: fakeCufe([DEFAULT_SETTINGS.invoice.prefix, num, closed.toISOString(), totals.total, totals.tax]),
        public_token: token(`inv:${checkId}`, 16),
        kind: "consumidor",
        subtotal: totals.base,
        tax: totals.tax,
        tip,
        total: totals.total + tip,
        created_at: closed.toISOString(),
      });
    }
  }

  await bulkInsert(db, "checks", CHECK_COLS, checks);
  await bulkInsert(db, "check_items", ITEM_COLS, items);
  await bulkInsert(db, "payments", PAY_COLS, payments);
  await bulkInsert(db, "invoices", INV_COLS, invoices);
  await bulkInsert(
    db,
    "audit_log",
    [["id", "uuid"], ["business_id", "uuid"], ["staff_id", "uuid"], ["action", "text"], ["detail", "jsonb"], ["amount", "int"], ["created_at", "timestamptz"]],
    audit,
  );
  // Consumo diario de insumos (un movimiento por insumo y día) para el inventario teórico
  const moves: Record<string, unknown>[] = [];
  for (const [dayKey, perIng] of usage) {
    for (const [ing, qty] of perIng) {
      moves.push({ id: stableId(`use:${dayKey}:${ing}`), business_id: biz, ingredient_id: id("ing", ing), delta: -qty, reason: "venta", ref: dayKey, created_at: `${dayKey}T23:59:00-05:00` });
    }
  }
  await bulkInsert(db, "stock_movements", [["id", "uuid"], ["business_id", "uuid"], ["ingredient_id", "uuid"], ["delta", "numeric"], ["reason", "text"], ["ref", "text"], ["created_at", "timestamptz"]], moves);

  // Compras, mermas y conteos de los últimos días, como los registraría el equipo
  const at = (daysAgo: number, hhmm: string) => new Date(Date.parse(`${bogotaParts(new Date(now.getTime() - daysAgo * 86_400_000)).dayKey}T${hhmm}:00-05:00`));
  const manual: [number, string, string, number, string, string, string][] = [
    [1, "09:10", "limon", 50, "compra", "Plaza de mercado", "valentina"],
    [1, "10:15", "poker", 72, "compra", "Distribuidora del Eje · factura 4471", "andres"],
    [1, "21:40", "club", -1, "merma", "Se cayó en la terraza", "mateo"],
    [2, "11:05", "cafe", 2000, "compra", "Tostadora de Santuario", "andres"],
    [3, "18:20", "leche", -1000, "merma", "Se cortó", "valentina"],
    [4, "09:30", "ginebra", -40, "conteo", "Conteo de la semana", "andres"],
  ];
  await bulkInsert(
    db,
    "stock_movements",
    [["id", "uuid"], ["business_id", "uuid"], ["ingredient_id", "uuid"], ["delta", "numeric"], ["reason", "text"], ["ref", "text"], ["staff_id", "uuid"], ["created_at", "timestamptz"]],
    manual
      .filter(([d, hhmm]) => at(d, hhmm) < now)
      .map(([d, hhmm, ing, delta, reason, ref, who]) => ({ id: stableId(`manual:${d}:${ing}`), business_id: biz, ingredient_id: id("ing", ing), delta, reason, ref, staff_id: staff(who), created_at: at(d, hhmm).toISOString() })),
  );

  // Caja de hoy abierta desde las 8:00 con base de $200.000
  const sessionId = stableId(`cash:${today.dayKey}`);
  const openedCash = new Date(Math.min(now.getTime() - 30 * 60_000, Date.parse(`${today.dayKey}T08:00:00-05:00`)));
  await db.query("insert into cash_sessions (id, business_id, opened_by, opened_at, opening) values ($1, $2, $3, $4, 200000)", [sessionId, biz, staff("valentina"), openedCash.toISOString()]);
  await db.query("insert into cash_movements (id, business_id, session_id, kind, amount, reason, staff_id, created_at) values ($1, $2, $3, 'out', 18000, 'Bolsa de hielo', $4, $5)", [
    stableId(`cashmove:${today.dayKey}`),
    biz,
    sessionId,
    staff("valentina"),
    new Date(openedCash.getTime() + 40 * 60_000).toISOString(),
  ]);
  await db.query("update payments set cash_session_id = $1 where business_id = $2 and created_at >= $3", [sessionId, biz, openedCash.toISOString()]);

  await seedLiveService(db, now, number);
  await db.query("select setval('check_number_seq', (select coalesce(max(number), 100) from checks))");
  await db.query("select setval('invoice_number_seq', (select coalesce(max(number), 1000) from invoices))");
}

/** Lo que está pasando ahora: mesas abiertas, tiquetes en barra y cocina y pedidos por QR. */
async function seedLiveService(db: Db, now: Date, firstNumber: number) {
  const biz = DEMO_BUSINESS_ID;
  const ago = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
  const byKey = new Map(PRODUCTS.map((p) => [p.key, p]));
  const staff = (k: string) => id("staff", k);
  let number = firstNumber;

  type LiveItem = { key: string; qty: number; status: string; sent?: number; ready?: number; mods?: { name: string; price: number }[]; note?: string; source?: string };
  const live: { key: string; table?: string; kind: string; name?: string; guests: number; opened: number; by: string; status?: string; items: LiveItem[] }[] = [
    {
      key: "mesa3",
      table: "3",
      kind: "mesa",
      guests: 4,
      opened: 46,
      by: "juanpablo",
      items: [
        { key: "capuchino", qty: 2, status: "delivered", sent: 44, ready: 38, mods: [{ name: "Entera", price: 0 }] },
        { key: "mocaccino", qty: 1, status: "delivered", sent: 44, ready: 37, mods: [{ name: "Avena", price: 2500 }] },
        { key: "pandebonos", qty: 2, status: "delivered", sent: 44, ready: 35 },
      ],
    },
    {
      key: "mesa5",
      table: "5",
      kind: "mesa",
      guests: 2,
      opened: 21,
      by: "camila",
      items: [
        { key: "club", qty: 2, status: "ready", sent: 18.3, ready: 2, mods: [{ name: "Michelada", price: 2500 }] },
        { key: "nachos", qty: 1, status: "sent", sent: 18.3, note: "Sin jalapeño" },
      ],
    },
    {
      key: "mesa9",
      table: "9",
      kind: "mesa",
      guests: 6,
      opened: 74,
      by: "juanpablo",
      status: "bill",
      items: [
        { key: "botella-aguardiente", qty: 1, status: "delivered", sent: 70, ready: 66 },
        { key: "poker", qty: 6, status: "delivered", sent: 70, ready: 66 },
        { key: "tabla", qty: 1, status: "delivered", sent: 62, ready: 49 },
        { key: "empanadas", qty: 2, status: "delivered", sent: 40, ready: 31 },
      ],
    },
    {
      key: "mesa12",
      table: "12",
      kind: "mesa",
      guests: 3,
      opened: 9,
      by: "camila",
      items: [{ key: "mojito", qty: 3, status: "sent", sent: 6.25 }],
    },
    {
      key: "mesa1",
      table: "1",
      kind: "mesa",
      guests: 2,
      opened: 14,
      by: "camila",
      items: [
        { key: "latte", qty: 1, status: "delivered", sent: 11.6, ready: 7, mods: [{ name: "Avena", price: 2500 }] },
        { key: "aromatica", qty: 1, status: "delivered", sent: 11.6, ready: 7 },
        { key: "arepa", qty: 1, status: "sent", sent: 11.6 },
      ],
    },
    {
      key: "mesa6",
      table: "6",
      kind: "mesa",
      guests: 4,
      opened: 58,
      by: "juanpablo",
      items: [
        { key: "cubetazo", qty: 1, status: "delivered", sent: 55, ready: 52 },
        { key: "patacones", qty: 2, status: "delivered", sent: 50, ready: 38 },
      ],
    },
    {
      key: "mesa8",
      table: "8",
      kind: "mesa",
      guests: 6,
      opened: 27,
      by: "camila",
      items: [
        { key: "club", qty: 4, status: "delivered", sent: 24, ready: 21 },
        { key: "margarita", qty: 2, status: "ready", sent: 12.9, ready: 1 },
        { key: "alitas", qty: 1, status: "sent", sent: 12.9, mods: [{ name: "BBQ", price: 0 }] },
      ],
    },
    {
      key: "barra-laura",
      kind: "barra",
      name: "Laura",
      guests: 1,
      opened: 33,
      by: "mateo",
      items: [
        { key: "gin-tonic", qty: 1, status: "delivered", sent: 31, ready: 27 },
        { key: "espresso-martini", qty: 1, status: "sent", sent: 3.7 },
      ],
    },
    {
      key: "llevar-sebastian",
      kind: "llevar",
      name: "Sebastián",
      guests: 1,
      opened: 3,
      by: "valentina",
      items: [{ key: "americano", qty: 2, status: "sent", sent: 2.1, mods: [{ name: "Grande", price: 2000 }] }],
    },
  ];

  const checks: Record<string, unknown>[] = [];
  const items: Record<string, unknown>[] = [];
  for (const c of live) {
    const checkId = id("live", c.key);
    checks.push({
      id: checkId,
      business_id: biz,
      number: number++,
      table_id: c.table ? id("table", c.table) : null,
      kind: c.kind,
      name: c.name ?? "",
      guests: c.guests,
      status: c.status ?? "open",
      opened_by: staff(c.by),
      opened_at: ago(c.opened),
      closed_by: null,
      closed_at: null,
      customer_id: null,
      discount_pct: 0,
      tip_answer: null,
      updated_at: ago(1),
    });
    // Cada envío a la barra es una ronda: se numeran por orden de envío
    const sends = [...new Set(c.items.map((it) => it.sent ?? 0))].sort((a, b) => b - a);
    c.items.forEach((it, i) => {
      const prod = byKey.get(it.key)!;
      items.push({
        id: id("live-item", `${c.key}:${i}`),
        business_id: biz,
        check_id: checkId,
        product_id: id("prod", prod.key),
        name: prod.name,
        unit_price: prod.price,
        qty: it.qty,
        modifiers: it.mods ?? [],
        note: it.note ?? "",
        station: prod.cat === "picar" || prod.cat === "postres" ? "cocina" : "barra",
        tax_rate: 8,
        status: it.status,
        round: sends.indexOf(it.sent ?? 0) + 1,
        source: it.source ?? "staff",
        added_by: staff(c.by),
        sent_at: it.sent !== undefined ? ago(it.sent) : null,
        ready_at: it.ready !== undefined ? ago(it.ready) : null,
        delivered_at: it.status === "delivered" && it.ready !== undefined ? ago(Math.max(0, it.ready - 2)) : null,
        void_reason: null,
        void_by: null,
        created_at: ago(it.sent ?? c.opened),
      });
    });
  }
  await bulkInsert(db, "checks", CHECK_COLS, checks);
  await bulkInsert(db, "check_items", ITEM_COLS, items);

  // Pedidos y llamados desde la carta QR
  await db.query(
    `insert into requests (id, business_id, table_id, kind, payload, status, created_at) values
       ($1, $2, $3, 'order', $4::jsonb, 'pending', $5),
       ($6, $2, $7, 'waiter', '{}'::jsonb, 'pending', $8)`,
    [
      id("req", "mesa7-order"),
      biz,
      id("table", "7"),
      JSON.stringify({
        items: [
          { productId: id("prod", "limonada-coco"), name: "Limonada de coco", qty: 2, modifiers: [], note: "" },
          { productId: id("prod", "empanadas"), name: "Empanadas x3", qty: 1, modifiers: [], note: "Con ají aparte" },
        ],
        guestName: "Mesa de Paula",
      }),
      ago(2),
      id("req", "mesa3-waiter"),
      id("table", "3"),
      ago(1),
    ],
  );
}
