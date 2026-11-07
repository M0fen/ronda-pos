/**
 * Datos de la demo: Sr. Patata, Pereira. Carta tomada de su menú público (precios redondeados),
 * salón, equipo con su pago y sus turnos, insumos con recetas, clientes, dos semanas de ventas
 * y el servicio en curso. Ids estables (stableId) para que cualquier instancia de la demo genere
 * los mismos y los enlaces sirvan entre dispositivos. Se importa desde scripts: no usa server-only.
 */
import { createHash } from "node:crypto";
import type { Db } from "./db-core";
import { holidayName } from "./core/labor";
import { checkTotals, suggestedTip } from "./core/pricing";
import { addDays, bogotaParts, weekdayOf } from "./core/time";
import { DEFAULT_SETTINGS, type Settings } from "./settings";

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

/** Ajustes del local de la demo. Nombre, Instagram y punto de la Circunvalar, de su perfil público. */
export const DEMO_SETTINGS: Settings = {
  ...DEFAULT_SETTINGS,
  business: { name: "Sr. Patata", legalName: "Sr. Patata (demo)", nit: "000.000.000-0", address: "Cra. 13 #8-25, Circunvalar", city: "Pereira, Risaralda", phone: "", instagram: "@senorpatata_" },
  theme: { primary: "#171310", accent: "#FFC20E", whiteLabel: true },
  payments: { ...DEFAULT_SETTINGS.payments, nequiPhone: "300 000 0000", brebKey: "@demo-srpatata" },
  loyalty: { enabled: true, minPurchase: 30000, goal: 8, reward: "Una bebida de la casa", rewardMax: 7000 },
  invoice: { prefix: "FESP", resolution: "Resolución DIAN de prueba (demo)", provider: "Factus", mode: "demo" },
  receipt: { footer: "Maestría patatera. La propina es voluntaria. ¡Gracias por venir!" },
  labor: { exonerated: true, arlClass: 1, alertPct: 35, turnos: [{ name: "Almuerzo", from: "11:00" }, { name: "Noche", from: "17:00" }] },
};

const MIN_WAGE = 1_750_905;

export const DEMO_STAFF = [
  { key: "andres", name: "Andrés", role: "owner", pin: "1234", color: "#1E4FB8", pay: ["salario", 0] },
  { key: "valentina", name: "Valentina", role: "cashier", pin: "2222", color: "#0B7A55", pay: ["salario", 1_900_000] },
  { key: "juanpablo", name: "Juan Pablo", role: "waiter", pin: "3333", color: "#D2232A", pay: ["salario", MIN_WAGE] },
  { key: "camila", name: "Camila", role: "waiter", pin: "4444", color: "#B07800", pay: ["salario", MIN_WAGE] },
  { key: "mateo", name: "Mateo", role: "bar", pin: "5555", color: "#7A4A2A", pay: ["salario", 2_000_000] },
  { key: "luisa", name: "Luisa", role: "bar", pin: "6666", color: "#9B3D8F", pay: ["salario", MIN_WAGE] },
  { key: "sofia", name: "Sofía", role: "bar", pin: "7777", color: "#0E7490", pay: ["hora", 13_000] },
] as const;

/** Horario de cada persona (1 = lunes … 7 = domingo). El viernes más reciente Luisa faltó y Mateo dobló (ver seedShifts). */
const SCHEDULE: Record<string, { days: number[]; from: string; to: string }[]> = {
  valentina: [{ days: [2, 3, 4, 5, 6, 7], from: "11:00", to: "18:00" }],
  camila: [
    { days: [1, 3, 4, 5, 6], from: "11:00", to: "18:00" },
    { days: [2], from: "16:00", to: "23:00" },
  ],
  juanpablo: [{ days: [1, 3, 4, 5, 6, 7], from: "16:00", to: "23:30" }],
  mateo: [{ days: [2, 3, 4, 5, 6, 7], from: "10:30", to: "18:30" }],
  luisa: [{ days: [1, 2, 3, 4, 5, 6], from: "16:00", to: "23:00" }],
  sofia: [
    { days: [1], from: "10:30", to: "18:30" },
    { days: [7], from: "17:00", to: "23:00" },
  ],
};

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
  { key: "patatas", name: "Patatas", color: "#E0A100", station: "cocina" },
  { key: "compartir", name: "Para compartir", color: "#C2541B", station: "cocina" },
  { key: "burgers", name: "Burgers", color: "#7A4A2A", station: "cocina" },
  { key: "combos", name: "Combos", color: "#D2232A", station: "cocina" },
  { key: "bebidas", name: "Bebidas", color: "#0B7A55", station: "barra" },
  { key: "cervezas", name: "Cervezas", color: "#B07800", station: "barra" },
];

const MOD_GROUPS = [
  { key: "salsa", name: "Salsa", min: 1, max: 1, options: [["De la casa", 0, true], ["Queso", 0], ["BBQ", 0], ["Ahumada", 0], ["Rosada", 0]] },
  { key: "barbacoa", name: "Barbacoa", min: 1, max: 1, options: [["Clásica", 0, true], ["Dulce picante", 0]] },
  { key: "bebida", name: "Bebida del combo", min: 1, max: 1, options: [["Coca-Cola", 0, true], ["Coca-Cola sin azúcar", 0]] },
  { key: "adiciones", name: "Adiciones", min: 0, max: 3, options: [["Tocineta", 5000], ["Queso cheddar", 4000], ["Carne smash", 7000], ["Salsa de queso", 3000]] },
  { key: "preparacion", name: "Preparación", min: 0, max: 1, options: [["Michelada", 2500]] },
] as const;

const INGREDIENTS: { key: string; name: string; unit: "g" | "ml" | "und"; stock: number; min: number; cost: number; pack?: [number, string]; kind?: string }[] = [
  { key: "papa", name: "Papa a la francesa", unit: "g", stock: 26000, min: 10000, cost: 9, pack: [2500, "bolsa"] },
  { key: "carne", name: "Carne de res 150 g", unit: "und", stock: 64, min: 40, cost: 3900 },
  { key: "smash", name: "Carne smash 80 g", unit: "und", stock: 130, min: 80, cost: 2100 },
  { key: "pan", name: "Pan brioche", unit: "und", stock: 70, min: 48, cost: 1300 },
  { key: "cheddar", name: "Queso cheddar en tajada", unit: "und", stock: 180, min: 100, cost: 550 },
  { key: "mozzarella", name: "Queso mozzarella", unit: "g", stock: 7000, min: 3000, cost: 28, pack: [1000, "kilo"] },
  { key: "salsa-queso", name: "Salsa de queso", unit: "g", stock: 6000, min: 3000, cost: 16, pack: [1000, "kilo"] },
  { key: "tocineta", name: "Tocineta ahumada", unit: "g", stock: 2600, min: 2000, cost: 46, pack: [1000, "kilo"] },
  { key: "solomito", name: "Solomito", unit: "g", stock: 4200, min: 2500, cost: 48, pack: [1000, "kilo"] },
  { key: "cerdo", name: "Cerdo caramelizado", unit: "g", stock: 3800, min: 2000, cost: 27, pack: [1000, "kilo"] },
  { key: "costilla", name: "Costilla de res desmechada", unit: "g", stock: 2600, min: 2000, cost: 36, pack: [1000, "kilo"] },
  { key: "nuggets", name: "Nuggets de pollo", unit: "und", stock: 240, min: 120, cost: 480 },
  { key: "pollo", name: "Pollo crunchy", unit: "g", stock: 4000, min: 2000, cost: 25, pack: [1000, "kilo"] },
  { key: "salsas", name: "Salsas de la casa", unit: "g", stock: 7000, min: 3000, cost: 9, pack: [1000, "kilo"] },
  { key: "cebolla", name: "Cebolla morada", unit: "g", stock: 3000, min: 1500, cost: 5 },
  { key: "verduras", name: "Lechuga y tomate", unit: "g", stock: 2500, min: 1500, cost: 7 },
  { key: "coca", name: "Coca-Cola lata 235 ml", unit: "und", stock: 110, min: 48, cost: 1900 },
  { key: "coca-zero", name: "Coca-Cola sin azúcar lata", unit: "und", stock: 40, min: 24, cost: 1900 },
  { key: "hatsu", name: "Té Hatsu 250 ml", unit: "und", stock: 20, min: 24, cost: 3300 },
  { key: "limon", name: "Limón", unit: "und", stock: 70, min: 40, cost: 400 },
  { key: "club", name: "Cerveza Club Colombia", unit: "und", stock: 60, min: 36, cost: 3300, kind: "cerveza" },
  { key: "poker", name: "Cerveza Poker", unit: "und", stock: 72, min: 48, cost: 2600, kind: "cerveza" },
  { key: "corona", name: "Cerveza Corona", unit: "und", stock: 20, min: 24, cost: 5200, kind: "cerveza" },
];

type P = { key: string; cat: string; name: string; price: number; happy?: number; desc?: string; mods?: string[]; recipe?: [string, number][]; fav?: boolean; station?: string; tax?: number };

// Papas: 300 g por cono, 600 g por bandeja, 200 g de acompañamiento
const burger: [string, number][] = [["carne", 1], ["pan", 1], ["mozzarella", 40], ["verduras", 40], ["salsas", 20]];
const smash2: [string, number][] = [["smash", 2], ["pan", 1], ["cheddar", 2], ["tocineta", 30], ["salsas", 20]];

const PRODUCTS: P[] = [
  { key: "solomito-cheese", cat: "patatas", name: "Solomito Cheese", price: 39900, desc: "Papas con solomito, tocineta, cebolla morada a la parrilla, cheddar, barbacoa y salsa de queso.", recipe: [["papa", 300], ["solomito", 120], ["tocineta", 30], ["cebolla", 30], ["cheddar", 2], ["salsa-queso", 60], ["salsas", 30]], fav: true },
  { key: "express-cerdo", cat: "patatas", name: "Patata Express cerdo caramelizado", price: 39900, desc: "Cono de papas con cerdo caramelizado, mozzarella, barbacoa y salsa de queso.", recipe: [["papa", 300], ["cerdo", 120], ["mozzarella", 50], ["salsa-queso", 60], ["salsas", 30]], fav: true },
  { key: "express-costilla", cat: "patatas", name: "Patata Express costilla de res", price: 42000, desc: "Cono de papas con costilla desmechada, mozzarella, salsa ahumada y salsa de queso.", recipe: [["papa", 300], ["costilla", 130], ["mozzarella", 50], ["salsa-queso", 60], ["salsas", 30]] },
  { key: "express-nuggets", cat: "patatas", name: "Patata Express nuggets", price: 41500, desc: "Cono de papas con 10 nuggets de pollo, mozzarella, salsa rosada y salsa de queso.", recipe: [["papa", 300], ["nuggets", 10], ["mozzarella", 50], ["salsa-queso", 60], ["salsas", 30]] },
  { key: "antojo", cat: "patatas", name: "Antojo de patatas", price: 17000, desc: "Papas a la francesa crocantes con la salsa que elijas.", mods: ["salsa"], recipe: [["papa", 250], ["salsas", 40]], fav: true },
  { key: "trilogia", cat: "compartir", name: "Bandeja trilogía", price: 70500, desc: "Papas con cerdo caramelizado, costilla de res, tocineta, queso y salsa ahumada.", recipe: [["papa", 600], ["cerdo", 120], ["costilla", 120], ["tocineta", 50], ["mozzarella", 80], ["salsas", 60]], fav: true },
  { key: "cuatro-carnes", cat: "compartir", name: "Bandeja 4 carnes smash", price: 79000, desc: "Papas con cuatro carnes smash, cheddar, barbacoa, salsa ahumada y tocineta.", recipe: [["papa", 600], ["smash", 4], ["cheddar", 4], ["tocineta", 50], ["salsas", 80]] },
  { key: "bandeja-crunchy", cat: "compartir", name: "Bandeja pollo crunchy", price: 63500, desc: "Papas con pollo crunchy, salsa de queso, mozzarella y barbacoa.", mods: ["barbacoa"], recipe: [["papa", 600], ["pollo", 250], ["salsa-queso", 100], ["mozzarella", 80], ["salsas", 60]] },
  { key: "bandeja-solomito", cat: "compartir", name: "Bandeja solomito", price: 71500, desc: "Papas con solomito sellado, salsa de queso, tocineta, cebolla a la parrilla y barbacoa.", recipe: [["papa", 600], ["solomito", 250], ["salsa-queso", 100], ["tocineta", 60], ["cebolla", 60], ["salsas", 60]] },
  { key: "compartir-nuggets", cat: "compartir", name: "Para compartir nuggets y tocineta", price: 70500, desc: "Papas con nuggets, tocineta, salsa de queso, mozzarella y salsa ahumada.", recipe: [["papa", 600], ["nuggets", 16], ["tocineta", 60], ["salsa-queso", 100], ["mozzarella", 80], ["salsas", 50]] },
  { key: "cheese-clasica", cat: "burgers", name: "Cheese burger clásica", price: 30500, desc: "Carne de 150 g, pan con mantequilla, mozzarella, salsa de la casa, tomate y lechuga.", mods: ["adiciones"], recipe: burger, fav: true },
  { key: "smash-doble", cat: "burgers", name: "Burger smash doble", price: 38000, desc: "Doble carne aplastada, doble cheddar, tocineta y salsa de la casa.", mods: ["adiciones"], recipe: smash2, fav: true },
  { key: "mega-smash", cat: "burgers", name: "Mega smash (4 carnes)", price: 44000, desc: "Cuatro carnes smash, doble cheddar, tocineta y salsa de la casa.", mods: ["adiciones"], recipe: [["smash", 4], ["pan", 1], ["cheddar", 2], ["tocineta", 40], ["salsas", 25]] },
  { key: "mega-burger", cat: "burgers", name: "Mega burger doble carne", price: 43500, desc: "Doble carne artesanal, doble queso americano, tomate, lechuga y salsa de la casa.", mods: ["adiciones"], recipe: [["carne", 2], ["pan", 1], ["cheddar", 2], ["verduras", 40], ["salsas", 25]] },
  { key: "umami", cat: "burgers", name: "Umami burger", price: 45500, desc: "Doble smash, queso glaseado en mermelada de rocoto ahumado, tocineta, doble cheddar y papa fosforito.", mods: ["adiciones"], recipe: [...smash2, ["papa", 40]] },
  { key: "clasica-papas", cat: "burgers", name: "Burger clásica con papas", price: 38000, desc: "Con mozzarella, tomate, lechuga y la salsa que elijas.", mods: ["salsa"], recipe: [...burger, ["papa", 200]] },
  { key: "combo-burger", cat: "combos", name: "Combo burger + papas + Coca-Cola", price: 50500, mods: ["bebida"], recipe: [...burger, ["papa", 200], ["coca", 1]], fav: true },
  { key: "combo-smash", cat: "combos", name: "Combo smash doble + papas + bebida", price: 52000, mods: ["bebida"], recipe: [...smash2, ["papa", 200], ["coca", 1]] },
  { key: "combo-pareja", cat: "combos", name: "2 burgers, 2 papas y 2 bebidas", price: 77000, desc: "Para dos.", recipe: [["carne", 2], ["pan", 2], ["mozzarella", 80], ["verduras", 80], ["salsas", 40], ["papa", 400], ["coca", 2]] },
  { key: "coca", cat: "bebidas", name: "Coca-Cola lata", price: 5000, recipe: [["coca", 1]], fav: true },
  { key: "coca-zero", cat: "bebidas", name: "Coca-Cola sin azúcar lata", price: 5000, recipe: [["coca-zero", 1]] },
  { key: "hatsu", cat: "bebidas", name: "Té Hatsu", price: 6500, recipe: [["hatsu", 1]] },
  { key: "limonada", cat: "bebidas", name: "Limonada natural", price: 7000, recipe: [["limon", 2]] },
  { key: "agua", cat: "bebidas", name: "Agua", price: 4000 },
  { key: "club", cat: "cervezas", name: "Club Colombia", price: 7500, happy: 5900, mods: ["preparacion"], recipe: [["club", 1]], fav: true },
  { key: "poker", cat: "cervezas", name: "Poker", price: 6000, happy: 4500, mods: ["preparacion"], recipe: [["poker", 1]] },
  { key: "corona", cat: "cervezas", name: "Corona", price: 12000, recipe: [["corona", 1]] },
];

const FIRST = ["Laura", "Sebastián", "Valeria", "Santiago", "Mariana", "Felipe", "Daniela", "Andrés", "Juliana", "Camilo", "Paula", "Mateo", "Natalia", "Simón", "Sara", "Tomás", "Isabela", "Nicolás", "Manuela", "Esteban", "Luisa", "David", "Carolina", "Julián", "Ana María", "Alejandro", "Gabriela", "Miguel", "Catalina", "Samuel"];
const LAST = ["Restrepo", "Gómez", "Arango", "Londoño", "Mejía", "Ospina", "Cardona", "Henao", "Giraldo", "Valencia", "Botero", "Rendón", "Marín", "Zapata", "Correa"];

const id = (kind: string, key: string) => stableId(`${kind}:${key}`);

/** Catálogo, salón, equipo, insumos y clientes. No depende de la hora. */
export async function seedBusiness(db: Db) {
  const biz = DEMO_BUSINESS_ID;
  await db.query("insert into businesses (id, name, slug, settings) values ($1, $2, 'sr-patata', $3::jsonb) on conflict (id) do nothing", [
    biz,
    DEMO_SETTINGS.business.name,
    JSON.stringify(DEMO_SETTINGS),
  ]);
  await db.query("insert into pulse (business_id, version) values ($1, 1) on conflict do nothing", [biz]);

  await bulkInsert(
    db,
    "staff",
    [["id", "uuid"], ["business_id", "uuid"], ["name", "text"], ["role", "text"], ["pin_hash", "text"], ["color", "text"], ["pay_kind", "text"], ["pay_amount", "int"]],
    DEMO_STAFF.map((s) => ({ id: id("staff", s.key), business_id: biz, name: s.name, role: s.role, pin_hash: pinHash(id("staff", s.key), s.pin), color: s.color, pay_kind: s.pay[0], pay_amount: s.pay[1] })),
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
    TABLES.map((t) => ({ id: id("table", t.n), business_id: biz, zone_id: id("zone", t.zone), name: t.n, seats: t.seats, x: t.x, y: t.y, shape: t.shape, qr_token: `sp${t.n.toLowerCase()}${token(`table:${t.n}`, 6)}` })),
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

/** Lo que se pide según la hora: combos y burgers al almuerzo, bandejas para compartir y cerveza en la noche. */
function orderFor(r: () => number, hour: number): Line[] {
  const byKey = new Map(PRODUCTS.map((p) => [p.key, p]));
  const lunch = ["combo-burger", "combo-burger", "combo-smash", "cheese-clasica", "smash-doble", "clasica-papas", "solomito-cheese", "express-cerdo", "express-nuggets", "antojo", "coca", "coca", "coca-zero", "limonada", "hatsu", "agua"];
  const night = ["trilogia", "cuatro-carnes", "bandeja-crunchy", "bandeja-solomito", "compartir-nuggets", "combo-pareja", "smash-doble", "mega-smash", "umami", "mega-burger", "solomito-cheese", "express-costilla", "express-cerdo", "antojo", "coca", "coca", "club", "club", "poker", "corona", "limonada"];
  const pool = hour < 17 ? lunch : night;
  const lines: Line[] = [];
  const count = 1 + Math.floor(r() * (hour >= 17 ? 4 : 3));
  for (let i = 0; i < count; i++) {
    const prod = byKey.get(pick(r, pool))!;
    const mods: Line["mods"] = [];
    if (prod.mods?.includes("salsa")) mods.push({ name: pick(r, ["De la casa", "Queso", "BBQ", "Ahumada", "Rosada"]), price: 0 });
    if (prod.mods?.includes("barbacoa")) mods.push({ name: pick(r, ["Clásica", "Dulce picante"]), price: 0 });
    if (prod.mods?.includes("bebida")) mods.push({ name: r() < 0.7 ? "Coca-Cola" : "Coca-Cola sin azúcar", price: 0 });
    if (prod.mods?.includes("adiciones") && r() < 0.2) mods.push({ name: "Tocineta", price: 5000 });
    if (prod.mods?.includes("preparacion") && r() < 0.3) mods.push({ name: "Michelada", price: 2500 });
    const qty = prod.cat === "compartir" || prod.cat === "combos" ? 1 : 1 + Math.floor(r() * 2);
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
  const tables = TABLES.filter((t) => t.zone !== "barra");
  const ingByProduct = new Map(PRODUCTS.map((p) => [p.key, p.recipe ?? []]));
  const stationOf = (p: P) => p.station ?? CATEGORIES.find((c) => c.key === p.cat)!.station;

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

  // Movimiento por día de la semana (lunes … domingo); los festivos se llenan como un sábado flojo
  const BUSY = [0, 0.75, 0.75, 0.9, 1, 1.45, 1.65, 1.35];
  for (let d = 14; d >= 0; d--) {
    const dayKey = bogotaParts(new Date(now.getTime() - d * 86_400_000)).dayKey;
    const r = rng(`day:${dayKey}`);
    const dow = weekdayOf(dayKey);
    const busy = BUSY[dow]! * (holidayName(dayKey) ? 1.3 : 1);
    const count = Math.round((20 + r() * 8) * busy);
    for (let n = 0; n < count; n++) {
      // Abre de 12:00 m. a 10:00 p. m.: pico al almuerzo y en la noche
      const slot = r();
      const hour = slot < 0.42 ? 12 + Math.floor(r() * 4) : slot < 0.52 ? 16 : 17 + Math.floor(r() * 5);
      const opened = new Date(Date.parse(`${dayKey}T${String(hour).padStart(2, "0")}:00:00-05:00`) + Math.floor(r() * 50) * 60_000);
      const minutes = 20 + Math.floor(r() * (hour >= 17 ? 70 : 40));
      const closed = new Date(opened.getTime() + minutes * 60_000);
      if (closed > cutoff) continue;
      const checkId = stableId(`hist:${dayKey}:${n}`);
      // Quién atiende según el horario: Camila y Valentina al almuerzo; Juan Pablo en la noche (Camila los martes)
      const lunch = hour < 17;
      const waiter = lunch ? (dow === 7 || dow === 2 ? "valentina" : dow === 1 || r() < 0.7 ? "camila" : "valentina") : dow === 2 ? "camila" : "juanpablo";
      const cashier = lunch && dow !== 1 ? "valentina" : waiter;
      const table = pick(r, tables);
      const kind = r() < 0.2 ? "llevar" : "mesa";
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
          station: stationOf(l.prod),
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
        const reason = pick(r, ["El cliente cambió de opinión", "Se marcó dos veces", "Demoró mucho", "Salió sin la salsa pedida"]);
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
          station: stationOf(prod),
          tax_rate: 8,
          status: "void",
          round: 1,
          source: "staff",
          added_by: staff(waiter),
          sent_at: opened.toISOString(),
          ready_at: null,
          delivered_at: null,
          void_reason: reason,
          void_by: staff(cashier),
          created_at: opened.toISOString(),
        });
        audit.push({ id: stableId(`hist:${dayKey}:${n}:audit`), business_id: biz, staff_id: staff(cashier), action: "void", detail: { item: prod.name, check: number, reason }, amount: prod.price, created_at: opened.toISOString() });
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
        closed_by: staff(cashier),
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
        created_by: staff(cashier),
        cash_session_id: null,
        created_at: closed.toISOString(),
      });
      const num = invoiceNumber++;
      invoices.push({
        id: stableId(`hist:${dayKey}:${n}:inv`),
        business_id: biz,
        check_id: checkId,
        number: num,
        prefix: DEMO_SETTINGS.invoice.prefix,
        cufe: fakeCufe([DEMO_SETTINGS.invoice.prefix, num, closed.toISOString(), totals.total, totals.tax]),
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
    [1, "10:40", "papa", 10000, "compra", "Distribuidora de papa del Eje · factura 2207", "andres"],
    [1, "11:15", "coca", 48, "compra", "Proveedor de gaseosas · factura 8812", "valentina"],
    [1, "21:40", "club", -1, "merma", "Se cayó en la terraza", "luisa"],
    [2, "10:50", "carne", 40, "compra", "Carnes del Eje", "andres"],
    [3, "18:20", "salsa-queso", -500, "merma", "Se cortó", "mateo"],
    [4, "10:35", "tocineta", -200, "conteo", "Conteo de la semana", "andres"],
  ];
  await bulkInsert(
    db,
    "stock_movements",
    [["id", "uuid"], ["business_id", "uuid"], ["ingredient_id", "uuid"], ["delta", "numeric"], ["reason", "text"], ["ref", "text"], ["staff_id", "uuid"], ["created_at", "timestamptz"]],
    manual
      .filter(([d, hhmm]) => at(d, hhmm) < now)
      .map(([d, hhmm, ing, delta, reason, ref, who]) => ({ id: stableId(`manual:${d}:${ing}`), business_id: biz, ingredient_id: id("ing", ing), delta, reason, ref, staff_id: staff(who), created_at: at(d, hhmm).toISOString() })),
  );

  // Caja de hoy abierta desde las 11:30 con base de $200.000
  const sessionId = stableId(`cash:${today.dayKey}`);
  const openedCash = new Date(Math.min(now.getTime() - 30 * 60_000, Date.parse(`${today.dayKey}T11:30:00-05:00`)));
  await db.query("insert into cash_sessions (id, business_id, opened_by, opened_at, opening) values ($1, $2, $3, $4, 200000)", [sessionId, biz, staff("valentina"), openedCash.toISOString()]);
  await db.query("insert into cash_movements (id, business_id, session_id, kind, amount, reason, staff_id, created_at) values ($1, $2, $3, 'out', 18000, 'Hielo y limones', $4, $5)", [
    stableId(`cashmove:${today.dayKey}`),
    biz,
    sessionId,
    staff("valentina"),
    new Date(openedCash.getTime() + 40 * 60_000).toISOString(),
  ]);
  await db.query("update payments set cash_session_id = $1 where business_id = $2 and created_at >= $3", [sessionId, biz, openedCash.toISOString()]);

  await bulkInsert(
    db,
    "shifts",
    [["id", "uuid"], ["business_id", "uuid"], ["staff_id", "uuid"], ["clock_in", "timestamptz"], ["clock_out", "timestamptz"], ["pay_kind", "text"], ["pay_amount", "int"]],
    seedShifts(now),
  );

  await seedLiveService(db, now, number);
  await db.query("select setval('check_number_seq', (select coalesce(max(number), 100) from checks))");
  await db.query("select setval('invoice_number_seq', (select coalesce(max(number), 1000) from invoices))");
}

/**
 * Entradas y salidas de las dos últimas semanas según el horario, con llegadas tarde de vez en cuando,
 * y las de hoy hasta el comienzo de esta hora (quien no ha salido sigue en turno).
 * El viernes más reciente Luisa faltó y Mateo cubrió la noche: 12 horas en un día.
 */
function seedShifts(now: Date) {
  const cutoff = Math.floor(now.getTime() / 3_600_000) * 3_600_000;
  const today = bogotaParts(now).dayKey;
  let friday = addDays(today, -1);
  while (weekdayOf(friday) !== 5) friday = addDays(friday, -1);
  const rows: Record<string, unknown>[] = [];
  for (let d = 14; d >= 0; d--) {
    const day = addDays(today, -d);
    const dow = weekdayOf(day);
    for (const s of DEMO_STAFF) {
      for (const block of SCHEDULE[s.key] ?? []) {
        if (!block.days.includes(dow) || (day === friday && s.key === "luisa")) continue;
        const to = day === friday && s.key === "mateo" ? "22:30" : block.to;
        const r = rng(`shift:${day}:${s.key}:${block.from}`);
        const late = r() < 0.15;
        const start = Date.parse(`${day}T${block.from}:00-05:00`) + (late ? 1 + Math.floor(r() * 14) : -Math.floor(r() * 9)) * 60_000;
        const end = Date.parse(`${day}T${to}:00-05:00`) + Math.floor(r() * 26) * 60_000;
        if (start >= cutoff) continue;
        rows.push({
          id: stableId(`shift:${day}:${s.key}:${block.from}`),
          business_id: DEMO_BUSINESS_ID,
          staff_id: id("staff", s.key),
          clock_in: new Date(start).toISOString(),
          clock_out: end <= cutoff ? new Date(end).toISOString() : null,
          pay_kind: s.pay[0],
          pay_amount: s.pay[1],
        });
      }
    }
  }
  return rows;
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
        { key: "combo-burger", qty: 2, status: "delivered", sent: 44, ready: 33, mods: [{ name: "Coca-Cola", price: 0 }] },
        { key: "solomito-cheese", qty: 1, status: "delivered", sent: 44, ready: 31 },
        { key: "coca-zero", qty: 1, status: "delivered", sent: 44, ready: 42 },
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
        { key: "antojo", qty: 1, status: "sent", sent: 18.3, mods: [{ name: "Ahumada", price: 0 }], note: "Bien crocantes" },
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
        { key: "trilogia", qty: 1, status: "delivered", sent: 70, ready: 52 },
        { key: "cuatro-carnes", qty: 1, status: "delivered", sent: 70, ready: 50 },
        { key: "poker", qty: 6, status: "delivered", sent: 70, ready: 67 },
        { key: "coca", qty: 2, status: "delivered", sent: 40, ready: 38 },
      ],
    },
    {
      key: "mesa12",
      table: "12",
      kind: "mesa",
      guests: 3,
      opened: 9,
      by: "camila",
      items: [{ key: "smash-doble", qty: 3, status: "sent", sent: 6.25 }],
    },
    {
      key: "mesa1",
      table: "1",
      kind: "mesa",
      guests: 2,
      opened: 14,
      by: "camila",
      items: [
        { key: "clasica-papas", qty: 1, status: "delivered", sent: 11.6, ready: 3, mods: [{ name: "Queso", price: 0 }] },
        { key: "limonada", qty: 1, status: "delivered", sent: 11.6, ready: 8 },
        { key: "express-nuggets", qty: 1, status: "sent", sent: 11.6 },
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
        { key: "bandeja-crunchy", qty: 1, status: "delivered", sent: 55, ready: 40, mods: [{ name: "Dulce picante", price: 0 }] },
        { key: "club", qty: 4, status: "delivered", sent: 55, ready: 52 },
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
        { key: "combo-pareja", qty: 1, status: "delivered", sent: 24, ready: 10 },
        { key: "umami", qty: 2, status: "ready", sent: 12.9, ready: 1 },
        { key: "express-costilla", qty: 1, status: "sent", sent: 12.9 },
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
        { key: "corona", qty: 1, status: "delivered", sent: 31, ready: 30 },
        { key: "antojo", qty: 1, status: "sent", sent: 3.7, mods: [{ name: "Queso", price: 0 }] },
      ],
    },
    {
      key: "llevar-sebastian",
      kind: "llevar",
      name: "Sebastián",
      guests: 1,
      opened: 3,
      by: "valentina",
      items: [{ key: "combo-smash", qty: 2, status: "sent", sent: 2.1, mods: [{ name: "Coca-Cola", price: 0 }] }],
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
        station: prod.station ?? CATEGORIES.find((c) => c.key === prod.cat)!.station,
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
          { productId: id("prod", "solomito-cheese"), name: "Solomito Cheese", qty: 1, modifiers: [], note: "La cebolla aparte" },
          { productId: id("prod", "coca"), name: "Coca-Cola lata", qty: 2, modifiers: [], note: "" },
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
