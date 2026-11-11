/**
 * Datos de la demo: Sr. Patata, cadena de Pereira y Dosquebradas con cuatro sedes. Carta tomada de su
 * menú público (precios redondeados); por sede: salón, equipo con su pago y sus turnos, insumos con
 * recetas, clientes, dos semanas de ventas en mesa, para llevar y a domicilio (Rappi y propio) y el
 * servicio en curso. Ids estables (stableId) para que cualquier instancia de la demo genere los mismos
 * y los enlaces sirvan entre dispositivos. Se importa desde scripts: no usa server-only.
 */
import { createHash } from "node:crypto";
import type { Db, Tx } from "./db-core";
import { packingList } from "./core/delivery";
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
export const DEMO_CHAIN_ID = stableId("chain:sr-patata");

/** Ajustes de la sede principal (Circunvalar). Nombre, Instagram y direcciones de las sedes, de su perfil público. */
export const DEMO_SETTINGS: Settings = {
  ...DEFAULT_SETTINGS,
  business: { name: "Sr. Patata", legalName: "Sr. Patata (demo)", nit: "000.000.000-0", address: "Cra. 13 #8-25, local 1, Ed. Portal de Los Alpes", city: "Pereira, Risaralda", phone: "", instagram: "@senorpatata_" },
  theme: { primary: "#171310", accent: "#FFC20E", whiteLabel: true },
  payments: { ...DEFAULT_SETTINGS.payments, nequiPhone: "300 000 0000", brebKey: "@demo-srpatata" },
  loyalty: { enabled: true, minPurchase: 30000, goal: 8, reward: "Una bebida de la casa", rewardMax: 7000 },
  invoice: { prefix: "SPCI", resolution: "Resolución DIAN de prueba (demo)", provider: "Factus", mode: "demo", rangeFrom: 1001, rangeTo: 200000, validFrom: "2026-01-01", validTo: "2028-12-31" },
  receipt: { footer: "Maestría patatera. La propina es voluntaria. ¡Gracias por venir!" },
  channels: { rappi: true, rappiPct: 25, didi: false, didiPct: 20, propio: true },
  labor: { exonerated: true, arlClass: 1, alertPct: 35, turnos: [{ name: "Almuerzo", from: "11:00" }, { name: "Noche", from: "17:00" }] },
  // La demo se bloquea tarde: no interrumpe una presentación, pero se ve que existe
  security: { lockMinutes: 20 },
};

const MIN_WAGE = 1_750_905;

type Role = "owner" | "admin" | "cashier" | "waiter" | "bar";
export interface DemoStaff {
  key: string;
  name: string;
  role: Role;
  pin: string;
  color: string;
  pay: readonly ["salario" | "hora", number];
}
type Block = { days: number[]; from: string; to: string };
type TableDef = { n: string; zone: string; seats: number; x: number; y: number; shape: "round" | "square" | "long" };
type Mods = { name: string; price: number; id?: string; group?: string }[];
type LiveItem = {
  key: string;
  qty: number;
  status: string;
  sent?: number;
  ready?: number;
  mods?: Mods;
  note?: string;
  source?: string;
  /** Alergia (la nota dice a qué), puesto en la mesa y retenido para después */
  allergy?: boolean;
  seat?: number;
  held?: boolean;
  /** Anulado hace estos minutos, con su motivo y quién lo anuló: barra y cocina lo ven en rojo */
  voided?: number;
  reason?: string;
  voidBy?: string;
};
type LiveCheck = {
  key: string;
  kind: "mesa" | "barra" | "llevar" | "domicilio";
  table?: string;
  name?: string;
  guests?: number;
  /** Minutos desde que se abrió */
  opened: number;
  by: string;
  status?: string;
  items: LiveItem[];
  /** Cuenta aparte: la clave de la cuenta principal de la mesa */
  split?: string;
  channel?: "rappi" | "propio";
  /** Domicilio: código de la plataforma, datos de entrega, hace cuántos minutos se empacó y en cuántos llega el domiciliario */
  delivery?: { code?: string; phone?: string; address?: string; notes?: string; packed?: number; packedBy?: string; rider?: number };
};

/** Una sede de la cadena: dónde queda, su equipo y su horario, su salón, cuánto vende y por qué canal. */
interface Sede {
  key: string;
  sede: string;
  slug: string;
  address: string;
  city: string;
  prefix: string;
  turnos: { name: string; from: string }[];
  channels: Settings["channels"];
  staff: DemoStaff[];
  /** Horario de cada persona (1 = lunes … 7 = domingo) */
  schedule: Record<string, Block[]>;
  /** El viernes más reciente: quién faltó y quién cubrió, hasta qué hora */
  swap?: { absent: string; cover: string; to: string };
  zones: { key: string; name: string }[];
  /** x, y en porcentaje del plano de cada zona; las sillas de barra tienen un puesto */
  tables: TableDef[];
  /** Cuentas de un jueves normal; el resto de la semana se escala con BUSY */
  volume: number;
  /** Horas en que entran pedidos, repetidas según el movimiento */
  hours: number[];
  /** Parte de los pedidos por Rappi, domicilio propio y para llevar; el resto, en mesa */
  mix: { rappi: number; propio: number; llevar: number };
  pools: { day: string[]; night: string[] };
  /** Direcciones de entrega del domicilio propio */
  addresses: string[];
  customers: number;
  /** Tamaño de la bodega frente a la sede principal */
  stock: number;
  /** Insumos que hoy están por debajo del mínimo */
  low: string[];
  cash: { opening: number; from: string; out: [number, string] };
  /** Lo que está pasando ahora: mesas, barra, mostrador y domicilios */
  live: LiveCheck[];
}

const ANDRES: DemoStaff = { key: "andres", name: "Andrés", role: "owner", pin: "1234", color: "#1E4FB8", pay: ["salario", 0] };

const CATEGORIES = [
  { key: "patatas", name: "Patatas", color: "#E0A100", station: "cocina" },
  { key: "compartir", name: "Para compartir", color: "#C2541B", station: "cocina" },
  { key: "burgers", name: "Burgers", color: "#7A4A2A", station: "cocina" },
  { key: "combos", name: "Combos", color: "#D2232A", station: "cocina" },
  { key: "bebidas", name: "Bebidas", color: "#0B7A55", station: "barra" },
  { key: "cervezas", name: "Cervezas", color: "#B07800", station: "barra" },
];

/** Lo que gasta cada opción: así "Tocineta" descuenta su tocineta y suma a lo que cuesta el plato */
const MOD_RECIPES: Record<string, [string, number][]> = {
  "bebida:Coca-Cola": [["coca", 1]],
  "bebida:Coca-Cola sin azúcar": [["coca-zero", 1]],
  "adiciones:Tocineta": [["tocineta", 30]],
  "adiciones:Queso cheddar": [["cheddar", 1]],
  "adiciones:Carne smash": [["smash", 1]],
  "adiciones:Salsa de queso": [["salsa-queso", 40]],
  "preparacion:Michelada": [["limon", 1]],
};
const MOD_CODE: Record<string, string> = { salsa: "SAL", barbacoa: "BBQ", bebida: "BEB", adiciones: "ADI", preparacion: "PRE" };

/** Las opciones sembradas llevan su id y su grupo, como las que guarda la caja: así descuentan su receta y se editan */
function withOptionIds(mods: Mods | undefined, id: (kind: string, key: string) => string): Mods {
  return (mods ?? []).map((m) => {
    const g = MOD_GROUPS.find((x) => x.options.some((o) => o[0] === m.name));
    return g ? { ...m, id: m.id ?? id("mod", `${g.key}:${m.name}`), group: m.group ?? g.name } : m;
  });
}

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
  // La lata la descuenta la bebida elegida (con o sin azúcar), no el combo
  { key: "combo-burger", cat: "combos", name: "Combo burger + papas + Coca-Cola", price: 50500, mods: ["bebida"], recipe: [...burger, ["papa", 200]], fav: true },
  { key: "combo-smash", cat: "combos", name: "Combo smash doble + papas + bebida", price: 52000, mods: ["bebida"], recipe: [...smash2, ["papa", 200]] },
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

/** Lo que se pide según la hora: combos y burgers al almuerzo, bandejas para compartir y cerveza en la noche. */
const LUNCH = ["combo-burger", "combo-burger", "combo-smash", "cheese-clasica", "smash-doble", "clasica-papas", "solomito-cheese", "express-cerdo", "express-nuggets", "antojo", "coca", "coca", "coca-zero", "limonada", "hatsu", "agua"];
const NIGHT = ["trilogia", "cuatro-carnes", "bandeja-crunchy", "bandeja-solomito", "compartir-nuggets", "combo-pareja", "smash-doble", "mega-smash", "umami", "mega-burger", "solomito-cheese", "express-costilla", "express-cerdo", "antojo", "coca", "coca", "club", "club", "poker", "corona", "limonada"];
/** Mostrador del centro comercial: conos Patata Express, antojos y combos. Sin cerveza. */
const EXPRESS = ["express-cerdo", "express-cerdo", "express-costilla", "express-nuggets", "solomito-cheese", "antojo", "antojo", "combo-burger", "combo-smash", "coca", "coca", "coca-zero", "limonada", "hatsu", "agua"];
/** Lo que más sale a domicilio: combos y bandejas para compartir. Sin cerveza. */
const DELIVERY = ["combo-burger", "combo-burger", "combo-smash", "combo-pareja", "combo-pareja", "trilogia", "bandeja-crunchy", "cuatro-carnes", "bandeja-solomito", "compartir-nuggets", "smash-doble", "mega-smash", "cheese-clasica", "solomito-cheese", "express-cerdo", "express-costilla", "antojo", "coca", "coca-zero"];
/** Restaurante de 12:00 m. a 10:00 p. m.: pico al almuerzo y en la noche */
const DINNER_HOURS = [12, 12, 13, 13, 14, 14, 15, 15, 16, 17, 17, 18, 18, 19, 19, 20, 20, 21, 21];
/** Plazoleta del centro comercial, de 11:00 a. m. a 9:00 p. m. */
const MALL_HOURS = [11, 12, 12, 13, 13, 14, 15, 16, 17, 17, 18, 18, 19, 19, 20];

const salon8 = (): TableDef[] => [
  { n: "1", zone: "salon", seats: 2, x: 6, y: 10, shape: "round" },
  { n: "2", zone: "salon", seats: 4, x: 30, y: 10, shape: "square" },
  { n: "3", zone: "salon", seats: 4, x: 54, y: 10, shape: "square" },
  { n: "4", zone: "salon", seats: 6, x: 78, y: 10, shape: "long" },
  { n: "5", zone: "salon", seats: 4, x: 6, y: 56, shape: "square" },
  { n: "6", zone: "salon", seats: 4, x: 30, y: 56, shape: "square" },
  { n: "7", zone: "salon", seats: 2, x: 54, y: 56, shape: "round" },
  { n: "8", zone: "salon", seats: 6, x: 78, y: 56, shape: "long" },
];

const coke = [{ name: "Coca-Cola", price: 0 }];

/**
 * La cadena: Circunvalar (la principal), Belmonte (la que más vende por Rappi), Dosquebradas y el mostrador
 * de Galicia Mall Plaza. Direcciones de su perfil público; equipo, horarios y cifras son de ejemplo.
 */
export const DEMO_SEDES: Sede[] = [
  {
    key: "circunvalar",
    sede: "Circunvalar",
    slug: "sr-patata",
    address: DEMO_SETTINGS.business.address,
    city: "Pereira, Risaralda",
    prefix: "SPCI",
    turnos: DEMO_SETTINGS.labor.turnos,
    channels: DEMO_SETTINGS.channels,
    staff: [
      ANDRES,
      { key: "valentina", name: "Valentina", role: "cashier", pin: "2222", color: "#0B7A55", pay: ["salario", 1_900_000] },
      { key: "juanpablo", name: "Juan Pablo", role: "waiter", pin: "3333", color: "#D2232A", pay: ["salario", MIN_WAGE] },
      { key: "camila", name: "Camila", role: "waiter", pin: "4444", color: "#B07800", pay: ["salario", MIN_WAGE] },
      { key: "mateo", name: "Mateo", role: "bar", pin: "5555", color: "#7A4A2A", pay: ["salario", 2_000_000] },
      { key: "luisa", name: "Luisa", role: "bar", pin: "6666", color: "#9B3D8F", pay: ["salario", MIN_WAGE] },
      { key: "sofia", name: "Sofía", role: "bar", pin: "7777", color: "#0E7490", pay: ["hora", 13_000] },
    ],
    schedule: {
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
    },
    // Luisa faltó y Mateo cubrió la noche: 12 horas en un día
    swap: { absent: "luisa", cover: "mateo", to: "22:30" },
    zones: [
      { key: "salon", name: "Salón" },
      { key: "terraza", name: "Terraza" },
      { key: "barra", name: "Barra" },
    ],
    tables: [
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
    ],
    volume: 20,
    hours: DINNER_HOURS,
    mix: { rappi: 0.12, propio: 0.06, llevar: 0.14 },
    pools: { day: LUNCH, night: NIGHT },
    addresses: ["Calle 12 #16-45, Álamos", "Cra. 14 #9-30, apto 402, Los Alpes", "Av. Circunvalar #4-20, torre 2, apto 801", "Calle 5 #18-12, Pinares", "Mz 7 casa 3, Villa Verde"],
    customers: 34,
    stock: 1,
    low: ["hatsu", "corona"],
    cash: { opening: 200_000, from: "11:30", out: [18_000, "Hielo y limones"] },
    live: [
      {
        key: "mesa3",
        kind: "mesa",
        table: "3",
        guests: 4,
        opened: 46,
        by: "juanpablo",
        items: [
          { key: "combo-burger", qty: 2, status: "delivered", sent: 44, ready: 33, mods: coke },
          { key: "solomito-cheese", qty: 1, status: "delivered", sent: 44, ready: 31 },
          { key: "coca-zero", qty: 1, status: "delivered", sent: 44, ready: 42 },
        ],
      },
      {
        key: "mesa5",
        kind: "mesa",
        table: "5",
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
        kind: "mesa",
        table: "9",
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
      // Dos de la mesa 9 pagan aparte (cada uno con su factura)
      {
        key: "mesa9-aparte",
        kind: "mesa",
        table: "9",
        split: "mesa9",
        name: "Cuenta 2",
        guests: 2,
        opened: 38,
        by: "juanpablo",
        items: [{ key: "corona", qty: 2, status: "delivered", sent: 37, ready: 35 }],
      },
      {
        key: "mesa12",
        kind: "mesa",
        table: "12",
        guests: 3,
        opened: 9,
        by: "camila",
        items: [
          { key: "smash-doble", qty: 1, status: "sent", sent: 6.25, seat: 1 },
          { key: "smash-doble", qty: 1, status: "sent", sent: 6.25, seat: 2, note: "Sin cebolla" },
          { key: "smash-doble", qty: 1, status: "sent", sent: 6.25, seat: 3, mods: [{ name: "Tocineta", price: 5000, group: "Adiciones" }] },
        ],
      },
      {
        key: "mesa1",
        kind: "mesa",
        table: "1",
        guests: 2,
        opened: 14,
        by: "camila",
        items: [
          { key: "clasica-papas", qty: 1, status: "delivered", sent: 11.6, ready: 3, mods: [{ name: "Queso", price: 0 }], seat: 1 },
          { key: "limonada", qty: 1, status: "delivered", sent: 11.6, ready: 8, seat: 1 },
          { key: "express-nuggets", qty: 1, status: "sent", sent: 11.6, seat: 2, allergy: true, note: "Sin salsa rosada, alergia al huevo" },
          { key: "club", qty: 1, status: "void", sent: 11.6, voided: 2.5, reason: "El cliente cambió de opinión", voidBy: "valentina" },
        ],
      },
      {
        key: "mesa6",
        kind: "mesa",
        table: "6",
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
        kind: "mesa",
        table: "8",
        guests: 6,
        opened: 27,
        by: "camila",
        items: [
          { key: "combo-pareja", qty: 1, status: "delivered", sent: 24, ready: 10 },
          { key: "umami", qty: 2, status: "ready", sent: 12.9, ready: 1 },
          { key: "express-costilla", qty: 1, status: "sent", sent: 12.9 },
          { key: "cuatro-carnes", qty: 1, status: "draft", held: true },
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
      { key: "llevar-sebastian", kind: "llevar", name: "Sebastián", guests: 1, opened: 3, by: "valentina", items: [{ key: "combo-smash", qty: 2, status: "sent", sent: 2.1, mods: coke }] },
      {
        key: "llevar-mariana",
        kind: "llevar",
        name: "Mariana",
        opened: 15,
        by: "valentina",
        items: [
          { key: "combo-burger", qty: 1, status: "ready", sent: 13, ready: 1, mods: coke },
          { key: "antojo", qty: 1, status: "ready", sent: 13, ready: 2, mods: [{ name: "Rosada", price: 0 }] },
        ],
      },
      {
        key: "llevar-david",
        kind: "llevar",
        name: "David",
        opened: 6,
        by: "valentina",
        items: [
          { key: "express-cerdo", qty: 1, status: "sent", sent: 5 },
          { key: "limonada", qty: 1, status: "ready", sent: 5, ready: 3 },
        ],
      },
      // Domicilios: uno en cada etapa del tablero
      {
        key: "rappi-luciana",
        kind: "domicilio",
        channel: "rappi",
        name: "Luciana G.",
        opened: 1,
        by: "valentina",
        delivery: { code: "4821935", rider: 22 },
        items: [
          { key: "combo-burger", qty: 1, status: "draft", mods: [{ name: "Coca-Cola sin azúcar", price: 0 }] },
          { key: "antojo", qty: 1, status: "draft", mods: [{ name: "Queso", price: 0 }] },
        ],
      },
      {
        key: "rappi-felipe",
        kind: "domicilio",
        channel: "rappi",
        name: "Felipe M.",
        opened: 8,
        by: "valentina",
        delivery: { code: "4819402", rider: 9 },
        items: [
          { key: "bandeja-crunchy", qty: 1, status: "sent", sent: 7, mods: [{ name: "Dulce picante", price: 0 }] },
          { key: "coca", qty: 2, status: "ready", sent: 7, ready: 5 },
        ],
      },
      {
        key: "propio-carolina",
        kind: "domicilio",
        channel: "propio",
        name: "Carolina Henao",
        opened: 12,
        by: "valentina",
        delivery: { phone: "3104567821", address: "Calle 12 #16-45, Álamos", notes: "Llamar al llegar: el timbre no sirve" },
        items: [
          { key: "smash-doble", qty: 2, status: "sent", sent: 10, note: "Una sin tocineta" },
          { key: "limonada", qty: 2, status: "ready", sent: 10, ready: 6 },
        ],
      },
      {
        key: "rappi-santiago",
        kind: "domicilio",
        channel: "rappi",
        name: "Santiago R.",
        opened: 17,
        by: "valentina",
        delivery: { code: "4817766", rider: 4 },
        items: [
          { key: "combo-smash", qty: 2, status: "ready", sent: 15, ready: 2, mods: coke },
          { key: "express-nuggets", qty: 1, status: "ready", sent: 15, ready: 3 },
          { key: "antojo", qty: 1, status: "ready", sent: 15, ready: 4, mods: [{ name: "Ahumada", price: 0 }] },
        ],
      },
      {
        key: "rappi-valeria",
        kind: "domicilio",
        channel: "rappi",
        name: "Valeria O.",
        opened: 24,
        by: "valentina",
        delivery: { code: "4815230", packed: 2, packedBy: "Valentina", rider: -1 },
        items: [
          { key: "trilogia", qty: 1, status: "delivered", sent: 22, ready: 5 },
          { key: "coca", qty: 3, status: "delivered", sent: 22, ready: 18 },
        ],
      },
    ],
  },
  {
    key: "belmonte",
    sede: "Belmonte",
    slug: "sr-patata-belmonte",
    address: "Av. 30 de Agosto, frente a Postobón",
    city: "Pereira, Risaralda",
    prefix: "SPBE",
    turnos: [
      { name: "Almuerzo", from: "11:00" },
      { name: "Noche", from: "17:00" },
    ],
    channels: { rappi: true, rappiPct: 25, didi: false, didiPct: 20, propio: true },
    staff: [
      ANDRES,
      { key: "daniela", name: "Daniela", role: "admin", pin: "2121", color: "#4F46E5", pay: ["salario", 2_300_000] },
      { key: "kevin", name: "Kevin", role: "cashier", pin: "2323", color: "#0B7A55", pay: ["salario", 1_900_000] },
      { key: "natalia", name: "Natalia", role: "waiter", pin: "2424", color: "#D2232A", pay: ["salario", MIN_WAGE] },
      { key: "esteban", name: "Esteban", role: "waiter", pin: "2525", color: "#B07800", pay: ["salario", MIN_WAGE] },
      { key: "jhonatan", name: "Jhonatan", role: "bar", pin: "2626", color: "#7A4A2A", pay: ["salario", 2_000_000] },
      { key: "yuliana", name: "Yuliana", role: "bar", pin: "2727", color: "#9B3D8F", pay: ["salario", MIN_WAGE] },
      { key: "brayan", name: "Brayan", role: "bar", pin: "2828", color: "#0E7490", pay: ["hora", 13_000] },
    ],
    schedule: {
      daniela: [{ days: [1, 2, 3, 4, 5, 6], from: "11:00", to: "17:30" }],
      kevin: [{ days: [2, 3, 4, 5, 6, 7], from: "16:30", to: "23:00" }],
      natalia: [{ days: [1, 3, 4, 5, 6, 7], from: "11:00", to: "17:30" }],
      esteban: [{ days: [1, 2, 4, 5, 6, 7], from: "16:30", to: "23:00" }],
      jhonatan: [{ days: [2, 3, 4, 5, 6, 7], from: "10:30", to: "17:30" }],
      yuliana: [{ days: [1, 2, 3, 4, 5, 6], from: "16:30", to: "23:00" }],
      brayan: [
        { days: [1], from: "10:30", to: "17:30" },
        { days: [5, 6], from: "18:00", to: "23:00" },
        { days: [7], from: "16:30", to: "23:00" },
      ],
    },
    zones: [
      { key: "salon", name: "Salón" },
      { key: "terraza", name: "Terraza" },
    ],
    tables: [
      ...salon8(),
      { n: "9", zone: "terraza", seats: 4, x: 8, y: 20, shape: "square" },
      { n: "10", zone: "terraza", seats: 4, x: 36, y: 20, shape: "square" },
      { n: "11", zone: "terraza", seats: 2, x: 64, y: 20, shape: "round" },
    ],
    volume: 18,
    hours: DINNER_HOURS,
    mix: { rappi: 0.3, propio: 0.07, llevar: 0.12 },
    pools: { day: LUNCH, night: NIGHT },
    addresses: ["Calle 30 #25-12, Belmonte", "Cra. 27 #33-40, apto 301, Corales", "Mz 3 casa 15, Belmonte bajo", "Cra. 25 #28-60, torre 1, apto 502, Belmonte"],
    customers: 22,
    stock: 0.9,
    low: ["papa", "coca", "salsa-queso"],
    cash: { opening: 200_000, from: "11:30", out: [25_000, "Bolsas y sellos para domicilios"] },
    live: [
      {
        key: "mesa2",
        kind: "mesa",
        table: "2",
        guests: 2,
        opened: 18,
        by: "natalia",
        items: [
          { key: "smash-doble", qty: 1, status: "delivered", sent: 16, ready: 6 },
          { key: "club", qty: 2, status: "delivered", sent: 16, ready: 14 },
        ],
      },
      {
        key: "mesa5",
        kind: "mesa",
        table: "5",
        guests: 4,
        opened: 35,
        by: "esteban",
        items: [
          { key: "trilogia", qty: 1, status: "delivered", sent: 33, ready: 18 },
          { key: "coca", qty: 3, status: "delivered", sent: 33, ready: 30 },
          { key: "umami", qty: 1, status: "sent", sent: 9 },
        ],
      },
      {
        key: "mesa8",
        kind: "mesa",
        table: "8",
        guests: 3,
        opened: 7,
        by: "natalia",
        items: [
          { key: "combo-burger", qty: 2, status: "sent", sent: 5, mods: coke },
          { key: "limonada", qty: 1, status: "ready", sent: 5, ready: 2 },
        ],
      },
      {
        key: "llevar-simon",
        kind: "llevar",
        name: "Simón",
        opened: 5,
        by: "kevin",
        items: [
          { key: "cheese-clasica", qty: 1, status: "sent", sent: 4 },
          { key: "coca", qty: 1, status: "ready", sent: 4, ready: 3 },
        ],
      },
      {
        key: "rappi-juliana",
        kind: "domicilio",
        channel: "rappi",
        name: "Juliana P.",
        opened: 2,
        by: "kevin",
        delivery: { code: "4822071", rider: 19 },
        items: [
          { key: "bandeja-solomito", qty: 1, status: "draft" },
          { key: "coca", qty: 2, status: "draft" },
        ],
      },
      {
        key: "rappi-camilo",
        kind: "domicilio",
        channel: "rappi",
        name: "Camilo A.",
        opened: 9,
        by: "kevin",
        delivery: { code: "4820315", rider: 8 },
        items: [
          { key: "combo-smash", qty: 2, status: "sent", sent: 8, mods: coke },
          { key: "antojo", qty: 1, status: "sent", sent: 8, mods: [{ name: "BBQ", price: 0 }] },
        ],
      },
      {
        key: "rappi-sara",
        kind: "domicilio",
        channel: "rappi",
        name: "Sara V.",
        opened: 21,
        by: "kevin",
        delivery: { code: "4818544", packed: 3, packedBy: "Jhonatan", rider: 2 },
        items: [
          { key: "mega-smash", qty: 1, status: "delivered", sent: 19, ready: 6, mods: [{ name: "Tocineta", price: 5000 }] },
          { key: "express-cerdo", qty: 1, status: "delivered", sent: 19, ready: 7 },
          { key: "coca-zero", qty: 1, status: "delivered", sent: 19, ready: 17 },
        ],
      },
    ],
  },
  {
    key: "dosquebradas",
    sede: "Dosquebradas",
    slug: "sr-patata-dosquebradas",
    address: "Av. Simón Bolívar, Los Frailes",
    city: "Dosquebradas, Risaralda",
    prefix: "SPDQ",
    turnos: [
      { name: "Almuerzo", from: "11:00" },
      { name: "Noche", from: "17:00" },
    ],
    channels: { rappi: true, rappiPct: 25, didi: false, didiPct: 20, propio: true },
    staff: [
      ANDRES,
      { key: "paola", name: "Paola", role: "admin", pin: "3131", color: "#4F46E5", pay: ["salario", 2_200_000] },
      { key: "cristian", name: "Cristian", role: "cashier", pin: "3232", color: "#0B7A55", pay: ["salario", 1_900_000] },
      { key: "manuela", name: "Manuela", role: "waiter", pin: "3434", color: "#D2232A", pay: ["salario", MIN_WAGE] },
      { key: "duvan", name: "Duván", role: "bar", pin: "3535", color: "#7A4A2A", pay: ["salario", 2_000_000] },
      { key: "leidy", name: "Leidy", role: "bar", pin: "3636", color: "#9B3D8F", pay: ["salario", MIN_WAGE] },
      { key: "alejandro", name: "Alejandro", role: "bar", pin: "3737", color: "#0E7490", pay: ["hora", 13_000] },
    ],
    schedule: {
      paola: [{ days: [1, 2, 3, 4, 5, 6], from: "11:00", to: "17:30" }],
      cristian: [{ days: [2, 3, 4, 5, 6, 7], from: "16:30", to: "23:00" }],
      manuela: [
        { days: [3, 4, 5, 6, 7], from: "11:30", to: "18:00" },
        { days: [1], from: "16:30", to: "23:00" },
      ],
      duvan: [{ days: [2, 3, 4, 5, 6, 7], from: "10:30", to: "17:30" }],
      leidy: [{ days: [1, 2, 3, 4, 5, 6], from: "16:30", to: "23:00" }],
      alejandro: [
        { days: [1], from: "10:30", to: "17:30" },
        { days: [7], from: "16:30", to: "23:00" },
      ],
    },
    zones: [{ key: "salon", name: "Salón" }],
    tables: salon8(),
    volume: 14,
    hours: DINNER_HOURS,
    mix: { rappi: 0.22, propio: 0.1, llevar: 0.14 },
    pools: { day: LUNCH, night: NIGHT },
    addresses: ["Mz 12 casa 8, La Pradera", "Cra. 16 #45-30, Los Naranjos", "Calle 50 #18-22, Santa Isabel", "Torre 3, apto 704, Los Frailes"],
    customers: 16,
    stock: 0.7,
    low: ["tocineta", "pan"],
    cash: { opening: 150_000, from: "11:30", out: [15_000, "Servilletas y vasos"] },
    live: [
      {
        key: "mesa3",
        kind: "mesa",
        table: "3",
        guests: 4,
        opened: 26,
        by: "manuela",
        items: [
          { key: "bandeja-crunchy", qty: 1, status: "delivered", sent: 24, ready: 10, mods: [{ name: "Clásica", price: 0 }] },
          { key: "club", qty: 3, status: "delivered", sent: 24, ready: 22 },
        ],
      },
      {
        key: "mesa6",
        kind: "mesa",
        table: "6",
        guests: 2,
        opened: 11,
        by: "manuela",
        items: [
          { key: "clasica-papas", qty: 2, status: "sent", sent: 9, mods: [{ name: "Rosada", price: 0 }] },
          { key: "coca", qty: 2, status: "delivered", sent: 9, ready: 7 },
        ],
      },
      {
        key: "rappi-catalina",
        kind: "domicilio",
        channel: "rappi",
        name: "Catalina C.",
        opened: 10,
        by: "cristian",
        delivery: { code: "4820988", rider: 7 },
        items: [
          { key: "combo-pareja", qty: 1, status: "sent", sent: 9 },
          { key: "antojo", qty: 1, status: "ready", sent: 9, ready: 2, mods: [{ name: "Queso", price: 0 }] },
        ],
      },
      {
        key: "propio-gabriela",
        kind: "domicilio",
        channel: "propio",
        name: "Gabriela Marín",
        opened: 19,
        by: "cristian",
        delivery: { phone: "3157702214", address: "Mz 12 casa 8, La Pradera", notes: "Paga con Nequi al recibir" },
        items: [
          { key: "trilogia", qty: 1, status: "ready", sent: 17, ready: 2 },
          { key: "coca", qty: 2, status: "ready", sent: 17, ready: 15 },
        ],
      },
    ],
  },
  {
    key: "galicia",
    sede: "Galicia",
    slug: "sr-patata-galicia",
    address: "Galicia Mall Plaza, burbuja 2C",
    city: "Pereira, Risaralda",
    prefix: "SPGA",
    turnos: [
      { name: "Mañana", from: "09:30" },
      { name: "Tarde", from: "15:00" },
    ],
    // En el centro comercial no hay domicilio propio: solo Rappi
    channels: { rappi: true, rappiPct: 25, didi: false, didiPct: 20, propio: false },
    staff: [
      ANDRES,
      { key: "tatiana", name: "Tatiana", role: "cashier", pin: "4141", color: "#0B7A55", pay: ["salario", 1_900_000] },
      { key: "emanuel", name: "Emanuel", role: "cashier", pin: "4242", color: "#D2232A", pay: ["hora", 12_500] },
      { key: "karen", name: "Karen", role: "cashier", pin: "4343", color: "#B07800", pay: ["hora", 12_500] },
      { key: "samuel", name: "Samuel", role: "bar", pin: "4545", color: "#7A4A2A", pay: ["salario", 2_000_000] },
      { key: "stiven", name: "Stiven", role: "bar", pin: "4646", color: "#9B3D8F", pay: ["salario", MIN_WAGE] },
      { key: "jeison", name: "Jeison", role: "bar", pin: "4747", color: "#0E7490", pay: ["hora", 13_000] },
    ],
    schedule: {
      tatiana: [{ days: [2, 3, 4, 5, 6, 7], from: "10:00", to: "16:30" }],
      emanuel: [{ days: [1, 2, 3, 4, 5, 6], from: "15:30", to: "21:00" }],
      karen: [
        { days: [1], from: "10:00", to: "16:30" },
        { days: [7], from: "15:30", to: "21:00" },
      ],
      samuel: [{ days: [2, 3, 4, 5, 6, 7], from: "09:30", to: "16:30" }],
      stiven: [{ days: [1, 2, 3, 4, 5, 6], from: "15:00", to: "21:00" }],
      jeison: [
        { days: [1], from: "09:30", to: "16:30" },
        { days: [7], from: "15:00", to: "21:00" },
      ],
    },
    zones: [{ key: "mostrador", name: "Mostrador" }],
    tables: [
      { n: "B1", zone: "mostrador", seats: 1, x: 8, y: 30, shape: "round" },
      { n: "B2", zone: "mostrador", seats: 1, x: 30, y: 30, shape: "round" },
      { n: "B3", zone: "mostrador", seats: 1, x: 52, y: 30, shape: "round" },
      { n: "B4", zone: "mostrador", seats: 1, x: 74, y: 30, shape: "round" },
    ],
    volume: 22,
    hours: MALL_HOURS,
    mix: { rappi: 0.1, propio: 0, llevar: 0.9 },
    pools: { day: EXPRESS, night: EXPRESS },
    addresses: [],
    customers: 12,
    stock: 0.6,
    low: ["nuggets", "hatsu"],
    cash: { opening: 150_000, from: "10:00", out: [10_000, "Hielo"] },
    live: [
      {
        key: "llevar-isabela",
        kind: "llevar",
        name: "Isabela",
        opened: 9,
        by: "tatiana",
        items: [
          { key: "express-cerdo", qty: 1, status: "ready", sent: 8, ready: 1 },
          { key: "coca", qty: 1, status: "ready", sent: 8, ready: 7 },
        ],
      },
      { key: "llevar-nicolas", kind: "llevar", name: "Nicolás", opened: 12, by: "tatiana", items: [{ key: "combo-burger", qty: 1, status: "ready", sent: 11, ready: 2, mods: coke }] },
      {
        key: "llevar-tomas",
        kind: "llevar",
        name: "Tomás",
        opened: 6,
        by: "tatiana",
        items: [
          { key: "express-nuggets", qty: 2, status: "sent", sent: 5 },
          { key: "limonada", qty: 2, status: "ready", sent: 5, ready: 3 },
        ],
      },
      { key: "llevar-anamaria", kind: "llevar", name: "Ana María", opened: 4, by: "tatiana", items: [{ key: "solomito-cheese", qty: 1, status: "sent", sent: 3 }] },
      {
        key: "rappi-manuel",
        kind: "domicilio",
        channel: "rappi",
        name: "Manuel T.",
        opened: 7,
        by: "tatiana",
        delivery: { code: "4821402", rider: 11 },
        items: [
          { key: "express-costilla", qty: 1, status: "sent", sent: 6 },
          { key: "antojo", qty: 1, status: "sent", sent: 6, mods: [{ name: "Ahumada", price: 0 }] },
        ],
      },
    ],
  },
];

/** Todo el equipo de la cadena (para mostrar los PIN en la pantalla de entrada de la demo). Andrés entra en todas las sedes. */
export const DEMO_STAFF: DemoStaff[] = DEMO_SEDES.flatMap((s) => s.staff);

const MAIN = "circunvalar";

/** Id del local de cada sede: la principal conserva el de cuando la demo tenía un solo local. */
function bizOf(s: Sede) {
  return s.key === MAIN ? DEMO_BUSINESS_ID : stableId(`biz:${s.key}`);
}

/** Llave estable de algo de una sede; la principal conserva las llaves de antes. */
function keyOf(s: Sede, key: string) {
  return s.key === MAIN ? key : `${s.key}:${key}`;
}

function sedeSettings(s: Sede): Settings {
  return {
    ...DEMO_SETTINGS,
    business: { ...DEMO_SETTINGS.business, address: s.address, city: s.city },
    invoice: { ...DEMO_SETTINGS.invoice, prefix: s.prefix },
    channels: s.channels,
    labor: { ...DEMO_SETTINGS.labor, turnos: s.turnos },
  };
}

/** Catálogo, salón, equipo e insumos de cada sede. No depende de la hora. */
export async function seedBusiness(db: Tx) {
  for (const [order, s] of DEMO_SEDES.entries()) await seedSede(db, s, order);
}

async function seedSede(db: Tx, s: Sede, order: number) {
  const biz = bizOf(s);
  const id = (kind: string, key: string) => stableId(keyOf(s, `${kind}:${key}`));
  const settings = sedeSettings(s);
  // created_at fija el orden de las sedes: la principal primero
  await db.query(
    "insert into businesses (id, name, slug, settings, chain_id, sede, created_at) values ($1, $2, $3, $4::jsonb, $5, $6, $7) on conflict (id) do nothing",
    [biz, settings.business.name, s.slug, JSON.stringify(settings), DEMO_CHAIN_ID, s.sede, new Date(Date.UTC(2024, 0, 1, 5, 0, order)).toISOString()],
  );
  await db.query("insert into pulse (business_id, version) values ($1, 1) on conflict do nothing", [biz]);

  await bulkInsert(
    db,
    "staff",
    [["id", "uuid"], ["business_id", "uuid"], ["name", "text"], ["role", "text"], ["pin_hash", "text"], ["color", "text"], ["pay_kind", "text"], ["pay_amount", "int"]],
    s.staff.map((p) => ({ id: id("staff", p.key), business_id: biz, name: p.name, role: p.role, pin_hash: pinHash(id("staff", p.key), p.pin), color: p.color, pay_kind: p.pay[0], pay_amount: p.pay[1] })),
  );

  await bulkInsert(
    db,
    "zones",
    [["id", "uuid"], ["business_id", "uuid"], ["name", "text"], ["sort", "int"]],
    s.zones.map((z, i) => ({ id: id("zone", z.key), business_id: biz, name: z.name, sort: i })),
  );
  const qrPrefix = s.key === MAIN ? "sp" : `sp${s.key.slice(0, 2)}`;
  await bulkInsert(
    db,
    "floor_tables",
    [["id", "uuid"], ["business_id", "uuid"], ["zone_id", "uuid"], ["name", "text"], ["seats", "int"], ["x", "int"], ["y", "int"], ["shape", "text"], ["qr_token", "text"]],
    s.tables.map((t) => ({
      id: id("table", t.n),
      business_id: biz,
      zone_id: id("zone", t.zone),
      name: t.n,
      seats: t.seats,
      x: t.x,
      y: t.y,
      shape: t.shape,
      qr_token: `${qrPrefix}${t.n.toLowerCase()}${token(keyOf(s, `table:${t.n}`), 6)}`,
    })),
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
    [["id", "uuid"], ["business_id", "uuid"], ["group_id", "uuid"], ["name", "text"], ["price", "int"], ["is_default", "boolean"], ["sort", "int"], ["code", "text"]],
    MOD_GROUPS.flatMap((g) =>
      g.options.map((o, i) => ({
        id: id("mod", `${g.key}:${o[0]}`),
        business_id: biz,
        group_id: id("mg", g.key),
        name: o[0],
        price: o[1],
        is_default: o.length > 2 && !!o[2],
        sort: i,
        code: `${MOD_CODE[g.key]}-${i + 1}`,
      })),
    ),
  );

  const cats = new Map(CATEGORIES.map((c) => [c.key, c]));
  await bulkInsert(
    db,
    "products",
    [
      ["id", "uuid"],
      ["business_id", "uuid"],
      ["category_id", "uuid"],
      ["name", "text"],
      ["description", "text"],
      ["price", "int"],
      ["happy_price", "int"],
      ["tax_rate", "numeric"],
      ["station", "text"],
      ["favorite", "boolean"],
      ["sort", "int"],
      ["code", "text"],
      ["channel_prices", "jsonb"],
      ["hidden_channels", "jsonb"],
    ],
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
      // El mismo código en todas las sedes; en Rappi la comida sube un 15 % (redondeado a $500) y la cerveza no se ofrece
      code: `SP-${String(i + 1).padStart(3, "0")}`,
      channel_prices: p.cat === "cervezas" ? {} : { rappi: Math.round((p.price * 1.15) / 500) * 500 },
      hidden_channels: p.cat === "cervezas" ? ["rappi", "didi"] : [],
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
    INGREDIENTS.map((g) => {
      const min = Math.round(g.min * s.stock);
      const stock = s.low.includes(g.key) ? Math.round(min * 0.6) : Math.max(Math.round(g.stock * s.stock), Math.round(min * 1.25));
      return {
        id: id("ing", g.key),
        business_id: biz,
        name: g.name,
        unit: g.unit,
        stock,
        min_stock: min,
        cost: g.cost,
        pack_size: g.pack?.[0] ?? null,
        pack_label: g.pack?.[1] ?? null,
        kind: g.kind ?? "insumo",
      };
    }),
  );
  await bulkInsert(
    db,
    "recipe_items",
    [["business_id", "uuid"], ["product_id", "uuid"], ["ingredient_id", "uuid"], ["qty", "numeric"]],
    PRODUCTS.flatMap((p) => (p.recipe ?? []).map(([ing, qty]) => ({ business_id: biz, product_id: id("prod", p.key), ingredient_id: id("ing", ing), qty }))),
  );
  await bulkInsert(
    db,
    "modifier_recipe_items",
    [["business_id", "uuid"], ["modifier_id", "uuid"], ["ingredient_id", "uuid"], ["qty", "numeric"]],
    Object.entries(MOD_RECIPES).flatMap(([key, items]) => items.map(([ing, qty]) => ({ business_id: biz, modifier_id: id("mod", key), ingredient_id: id("ing", ing), qty }))),
  );
}

type Line = { prod: P; qty: number; mods: Mods };

function pick<T>(r: () => number, list: readonly T[]) {
  return list[Math.floor(r() * list.length)]!;
}

function weighted<T>(r: () => number, options: readonly (readonly [T, number])[]): T {
  let roll = r() * options.reduce((s, [, w]) => s + w, 0);
  for (const [value, w] of options) {
    if (roll < w) return value;
    roll -= w;
  }
  return options[options.length - 1]![0];
}

const BY_KEY = new Map(PRODUCTS.map((p) => [p.key, p]));

/** Un pedido sacado de la lista de lo que se pide a esa hora y por ese canal. */
function orderFor(r: () => number, pool: readonly string[], max: number): Line[] {
  const lines: Line[] = [];
  const count = 1 + Math.floor(r() * max);
  for (let i = 0; i < count; i++) {
    const prod = BY_KEY.get(pick(r, pool))!;
    const mods: Mods = [];
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

const stationOf = (p: P) => p.station ?? CATEGORIES.find((c) => c.key === p.cat)!.station;
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Quién está en turno a esa hora (a la media hora) según el horario de la sede. */
function onDuty(s: Sede, dow: number, hour: number) {
  const at = hour * 60 + 30;
  return s.staff.filter((p) => (s.schedule[p.key] ?? []).some((b) => b.days.includes(dow) && toMinutes(b.from) <= at && at < toMinutes(b.to)));
}

function randomPhone(r: () => number) {
  return `3${String(10 + Math.floor(r() * 89))}${String(1000000 + Math.floor(r() * 8999999))}`.slice(0, 10);
}

const CHECK_COLS: Col[] = [
  ["id", "uuid"], ["business_id", "uuid"], ["number", "int"], ["table_id", "uuid"], ["kind", "text"], ["name", "text"], ["guests", "int"], ["status", "text"],
  ["opened_by", "uuid"], ["opened_at", "timestamptz"], ["closed_by", "uuid"], ["closed_at", "timestamptz"], ["customer_id", "uuid"], ["discount_pct", "int"], ["tip_answer", "text"], ["updated_at", "timestamptz"],
  ["channel", "text"], ["delivery", "jsonb"], ["split_of", "uuid"],
];
const ITEM_COLS: Col[] = [
  ["id", "uuid"], ["business_id", "uuid"], ["check_id", "uuid"], ["product_id", "uuid"], ["name", "text"], ["unit_price", "int"], ["qty", "int"], ["modifiers", "jsonb"], ["note", "text"],
  ["station", "text"], ["tax_rate", "numeric"], ["status", "text"], ["round", "int"], ["source", "text"], ["added_by", "uuid"], ["sent_at", "timestamptz"], ["ready_at", "timestamptz"], ["delivered_at", "timestamptz"],
  ["void_reason", "text"], ["void_by", "uuid"], ["created_at", "timestamptz"],
];
/** Lo que está pasando ahora lleva además alergia, puesto, retenido y anulación (el historial no los necesita). */
const LIVE_ITEM_COLS: Col[] = [...ITEM_COLS, ["allergy", "boolean"], ["seat", "int"], ["held", "boolean"], ["voided_at", "timestamptz"]];
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

/** Movimiento por día de la semana (lunes … domingo); los festivos se llenan como un sábado flojo */
const BUSY = [0, 0.75, 0.75, 0.9, 1, 1.45, 1.65, 1.35];
const METHODS = [["efectivo", 0.3], ["tarjeta", 0.24], ["nequi", 0.2], ["breb", 0.22], ["daviplata", 0.04]] as const;
/** El domicilio propio se paga al recibir: efectivo o transferencia */
const DELIVERY_METHODS = [["efectivo", 0.5], ["nequi", 0.3], ["breb", 0.2]] as const;

/** Compras, mermas y conteos de los últimos días en la sede principal, como los registraría el equipo */
const MAIN_MOVES: [number, string, string, number, string, string, string][] = [
  [1, "10:40", "papa", 10000, "compra", "Distribuidora de papa del Eje · factura 2207", "andres"],
  [1, "11:15", "coca", 48, "compra", "Proveedor de gaseosas · factura 8812", "valentina"],
  [1, "21:40", "club", -1, "merma", "Se cayó en la terraza", "luisa"],
  [2, "10:50", "carne", 40, "compra", "Carnes del Eje", "andres"],
  [3, "18:20", "salsa-queso", -500, "merma", "Se cortó", "mateo"],
  [4, "10:35", "tocineta", -200, "conteo", "Conteo de la semana", "andres"],
];

/** Dos semanas de ventas de cada sede, el servicio de hoy hasta el comienzo de esta hora y lo que está pasando ahora. */
export async function seedActivity(db: Tx, now = new Date()) {
  for (const s of DEMO_SEDES) await seedSedeActivity(db, s, now);
}

async function seedSedeActivity(db: Tx, s: Sede, now: Date) {
  const biz = bizOf(s);
  const id = (kind: string, key: string) => stableId(keyOf(s, `${kind}:${key}`));
  const sk = (key: string) => stableId(keyOf(s, key));
  const staff = (k: string) => id("staff", k);
  const names = new Map(s.staff.map((p) => [p.key, p.name]));
  const offset = DEMO_SEDES.indexOf(s) * 7;
  const tables = s.tables.filter((t) => t.seats > 1);
  const ingByProduct = new Map(PRODUCTS.map((p) => [p.key, p.recipe ?? []]));
  const desk = s.staff.find((p) => p.role === "cashier") ?? s.staff.find((p) => p.role === "admin") ?? s.staff[0]!;

  // Clientes del programa de sellos
  const customers = Array.from({ length: s.customers }, (_, i) => {
    const r = rng(keyOf(s, `cust:${i}`));
    const phone = randomPhone(r);
    const visits = 1 + Math.floor(r() * 22);
    const lastDays = i < 6 ? 35 + Math.floor(r() * 40) : Math.floor(r() * 20);
    const month = bogotaParts(now).dayKey.slice(5, 7);
    return {
      id: id("cust", String(i)),
      business_id: biz,
      phone,
      name: `${FIRST[(i + offset) % FIRST.length]} ${LAST[Math.floor(r() * LAST.length)]}`,
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

  for (let d = 14; d >= 0; d--) {
    const dayKey = bogotaParts(new Date(now.getTime() - d * 86_400_000)).dayKey;
    const r = rng(keyOf(s, `day:${dayKey}`));
    const dow = weekdayOf(dayKey);
    const busy = BUSY[dow]! * (holidayName(dayKey) ? 1.3 : 1);
    const count = Math.round((s.volume + r() * s.volume * 0.4) * busy);
    for (let n = 0; n < count; n++) {
      // Cada pedido cae en su tramo del día (las horas están ordenadas): ningún día se va todo a la noche
      const hour = s.hours[Math.min(s.hours.length - 1, Math.floor(((n + r()) / count) * s.hours.length))]!;
      const night = hour >= 17;
      // Canal: Rappi, domicilio propio, para llevar o en mesa
      const roll = r();
      const { rappi, propio, llevar } = s.mix;
      let kind: "mesa" | "llevar" | "domicilio" = roll < rappi + propio ? "domicilio" : roll < rappi + propio + llevar ? "llevar" : "mesa";
      if (kind === "mesa" && !tables.length) kind = "llevar";
      const channel = kind !== "domicilio" ? "local" : roll < rappi ? "rappi" : "propio";
      const opened = new Date(Date.parse(`${dayKey}T${String(hour).padStart(2, "0")}:00:00-05:00`) + Math.floor(r() * 50) * 60_000);
      const minutes = kind === "mesa" ? 20 + Math.floor(r() * (night ? 70 : 40)) : kind === "llevar" ? 8 + Math.floor(r() * 16) : 18 + Math.floor(r() * 26);
      const closed = new Date(opened.getTime() + minutes * 60_000);
      if (closed > cutoff) continue;
      const checkId = sk(`hist:${dayKey}:${n}`);
      const checkNumber = number++;
      // Quién atiende lo dice el horario: el mesero en la mesa; caja en el mostrador y los domicilios
      const duty = onDuty(s, dow, hour);
      const waiters = duty.filter((p) => p.role === "waiter");
      const front = duty.find((p) => p.role === "cashier") ?? duty.find((p) => p.role === "admin");
      const waiter = (waiters.length ? pick(r, waiters) : (front ?? desk)).key;
      const cashier = (front ?? waiters[0] ?? desk).key;
      const taker = kind === "mesa" ? waiter : cashier;
      const table = kind === "mesa" ? pick(r, tables) : null;
      const pool = kind === "domicilio" ? DELIVERY : night ? s.pools.night : s.pools.day;
      const lines = orderFor(r, pool, kind === "mesa" ? (night ? 4 : 3) : kind === "llevar" ? 2 : 3);
      const customer = kind !== "domicilio" && r() < 0.3 ? customers[Math.floor(r() * customers.length)]! : null;
      lines.forEach((l, i) => {
        const sentAt = new Date(opened.getTime() + (2 + i) * 60_000);
        items.push({
          id: sk(`hist:${dayKey}:${n}:${i}`),
          business_id: biz,
          check_id: checkId,
          product_id: id("prod", l.prod.key),
          name: l.prod.name,
          unit_price: l.prod.price,
          qty: l.qty,
          modifiers: withOptionIds(l.mods, id),
          note: "",
          station: stationOf(l.prod),
          tax_rate: 8,
          status: "delivered",
          round: 1,
          source: kind === "mesa" && r() < 0.15 ? "qr" : "staff",
          added_by: staff(taker),
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
          id: sk(`hist:${dayKey}:${n}:void`),
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
          added_by: staff(taker),
          sent_at: opened.toISOString(),
          ready_at: null,
          delivered_at: null,
          void_reason: reason,
          void_by: staff(cashier),
          created_at: opened.toISOString(),
        });
        audit.push({ id: sk(`hist:${dayKey}:${n}:audit`), business_id: biz, staff_id: staff(cashier), action: "void", detail: { item: prod.name, check: checkNumber, reason }, amount: prod.price, created_at: opened.toISOString() });
      }
      const totals = checkTotals(lines.map((l) => ({ unitPrice: l.prod.price, qty: l.qty, modifiers: l.mods, taxRate: 8 })));
      // Propina: se pregunta siempre; en la mesa casi siempre la dejan, en el mostrador poco y en domicilio no aplica
      const tipYes = kind === "mesa" ? r() < 0.62 : kind === "llevar" ? r() < 0.15 : false;
      const tip = tipYes ? suggestedTip(totals.total, 10) : 0;
      const method = channel === "rappi" ? "plataforma" : weighted(r, channel === "propio" ? DELIVERY_METHODS : METHODS);
      const received = method === "efectivo" ? Math.ceil((totals.total + tip) / 10000) * 10000 : null;
      let name = "";
      let delivery: Record<string, unknown> | null = null;
      if (kind === "domicilio") {
        const first = pick(r, FIRST);
        const last = pick(r, LAST);
        name = channel === "rappi" ? `${first} ${last[0]}.` : `${first} ${last}`;
        const packedAt = new Date(closed.getTime() - (2 + Math.floor(r() * 5)) * 60_000).toISOString();
        const packedBy = (duty.find((p) => p.role === "bar") ?? s.staff.find((p) => p.key === cashier) ?? desk).name;
        delivery =
          channel === "rappi"
            ? { code: String(4_700_000 + Math.floor(r() * 110_000)), packedAt, packedBy }
            : { code: `P-${checkNumber}`, phone: randomPhone(r), address: s.addresses.length ? pick(r, s.addresses) : "", packedAt, packedBy };
      } else if (kind === "llevar") name = pick(r, FIRST);
      checks.push({
        id: checkId,
        business_id: biz,
        number: checkNumber,
        table_id: table ? id("table", table.n) : null,
        kind,
        name,
        guests: kind === "mesa" ? 1 + Math.floor(r() * 4) : 1,
        status: "paid",
        opened_by: staff(taker),
        opened_at: opened.toISOString(),
        closed_by: staff(cashier),
        closed_at: closed.toISOString(),
        customer_id: customer?.id ?? null,
        discount_pct: 0,
        tip_answer: tipYes ? "si" : "no",
        updated_at: closed.toISOString(),
        channel,
        delivery,
      });
      payments.push({
        id: sk(`hist:${dayKey}:${n}:pay`),
        business_id: biz,
        check_id: checkId,
        method,
        amount: totals.total,
        tip,
        received,
        reference: method === "efectivo" ? "" : method === "plataforma" ? String(delivery?.code ?? "") : String(100000 + Math.floor(r() * 899999)),
        part: "",
        status: "ok",
        created_by: staff(cashier),
        cash_session_id: null,
        created_at: closed.toISOString(),
      });
      const num = invoiceNumber++;
      invoices.push({
        id: sk(`hist:${dayKey}:${n}:inv`),
        business_id: biz,
        check_id: checkId,
        number: num,
        prefix: s.prefix,
        cufe: fakeCufe([s.prefix, num, closed.toISOString(), totals.total, totals.tax]),
        public_token: token(keyOf(s, `inv:${checkId}`), 16),
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
      moves.push({ id: sk(`use:${dayKey}:${ing}`), business_id: biz, ingredient_id: id("ing", ing), delta: -qty, reason: "venta", ref: dayKey, created_at: `${dayKey}T23:59:00-05:00` });
    }
  }
  await bulkInsert(db, "stock_movements", [["id", "uuid"], ["business_id", "uuid"], ["ingredient_id", "uuid"], ["delta", "numeric"], ["reason", "text"], ["ref", "text"], ["created_at", "timestamptz"]], moves);

  // Compras, mermas y conteos de los últimos días
  const at = (daysAgo: number, hhmm: string) => new Date(Date.parse(`${bogotaParts(new Date(now.getTime() - daysAgo * 86_400_000)).dayKey}T${hhmm}:00-05:00`));
  const boss = (s.staff.find((p) => p.role === "admin") ?? desk).key;
  const manual: [number, string, string, number, string, string, string][] =
    s.key === MAIN
      ? MAIN_MOVES
      : [
          [1, "10:20", "papa", Math.round(10000 * s.stock), "compra", "Distribuidora de papa del Eje", boss],
          [2, "10:45", "carne", Math.round(40 * s.stock), "compra", "Carnes del Eje", boss],
          [3, "16:10", "salsas", -300, "merma", "Se regó en el empaque", desk.key],
        ];
  await bulkInsert(
    db,
    "stock_movements",
    [["id", "uuid"], ["business_id", "uuid"], ["ingredient_id", "uuid"], ["delta", "numeric"], ["reason", "text"], ["ref", "text"], ["staff_id", "uuid"], ["created_at", "timestamptz"]],
    manual
      .filter(([d, hhmm]) => at(d, hhmm) < now)
      .map(([d, hhmm, ing, delta, reason, ref, who]) => ({ id: sk(`manual:${d}:${ing}`), business_id: biz, ingredient_id: id("ing", ing), delta, reason, ref, staff_id: staff(who), created_at: at(d, hhmm).toISOString() })),
  );

  // Caja de hoy abierta con su base
  const sessionId = sk(`cash:${today.dayKey}`);
  const openedCash = new Date(Math.min(now.getTime() - 30 * 60_000, Date.parse(`${today.dayKey}T${s.cash.from}:00-05:00`)));
  await db.query("insert into cash_sessions (id, business_id, opened_by, opened_at, opening) values ($1, $2, $3, $4, $5)", [sessionId, biz, staff(desk.key), openedCash.toISOString(), s.cash.opening]);
  await db.query("insert into cash_movements (id, business_id, session_id, kind, amount, reason, staff_id, created_at) values ($1, $2, $3, 'out', $4, $5, $6, $7)", [
    sk(`cashmove:${today.dayKey}`),
    biz,
    sessionId,
    s.cash.out[0],
    s.cash.out[1],
    staff(desk.key),
    new Date(openedCash.getTime() + 40 * 60_000).toISOString(),
  ]);
  await db.query("update payments set cash_session_id = $1 where business_id = $2 and created_at >= $3", [sessionId, biz, openedCash.toISOString()]);

  await bulkInsert(
    db,
    "shifts",
    [["id", "uuid"], ["business_id", "uuid"], ["staff_id", "uuid"], ["clock_in", "timestamptz"], ["clock_out", "timestamptz"], ["pay_kind", "text"], ["pay_amount", "int"]],
    seedShifts(s, now),
  );

  const next = await seedLiveService(db, s, now, number, names);
  // Consecutivos propios de la sede: lo próximo que se abra o se facture sigue desde aquí
  await db.query("insert into counters (business_id, kind, last) values ($1, 'check', $2), ($1, 'invoice', $3) on conflict (business_id, kind) do update set last = excluded.last", [
    biz,
    next - 1,
    invoiceNumber - 1,
  ]);
}

/**
 * Entradas y salidas de las dos últimas semanas según el horario, con llegadas tarde de vez en cuando,
 * y las de hoy hasta el comienzo de esta hora (quien no ha salido sigue en turno).
 */
function seedShifts(s: Sede, now: Date) {
  const cutoff = Math.floor(now.getTime() / 3_600_000) * 3_600_000;
  const today = bogotaParts(now).dayKey;
  let friday = addDays(today, -1);
  while (weekdayOf(friday) !== 5) friday = addDays(friday, -1);
  const swap = s.swap;
  const rows: Record<string, unknown>[] = [];
  for (let d = 14; d >= 0; d--) {
    const day = addDays(today, -d);
    const dow = weekdayOf(day);
    for (const p of s.staff) {
      for (const block of s.schedule[p.key] ?? []) {
        if (!block.days.includes(dow) || (swap && day === friday && p.key === swap.absent)) continue;
        const to = swap && day === friday && p.key === swap.cover ? swap.to : block.to;
        const r = rng(keyOf(s, `shift:${day}:${p.key}:${block.from}`));
        const late = r() < 0.15;
        const start = Date.parse(`${day}T${block.from}:00-05:00`) + (late ? 1 + Math.floor(r() * 14) : -Math.floor(r() * 9)) * 60_000;
        const end = Date.parse(`${day}T${to}:00-05:00`) + Math.floor(r() * 26) * 60_000;
        if (start >= cutoff) continue;
        rows.push({
          id: stableId(keyOf(s, `shift:${day}:${p.key}:${block.from}`)),
          business_id: bizOf(s),
          staff_id: stableId(keyOf(s, `staff:${p.key}`)),
          clock_in: new Date(start).toISOString(),
          clock_out: end <= cutoff ? new Date(end).toISOString() : null,
          pay_kind: p.pay[0],
          pay_amount: p.pay[1],
        });
      }
    }
  }
  return rows;
}

/** Lo que está pasando ahora: mesas abiertas, tiquetes en barra y cocina, mostrador, domicilios y pedidos por QR. Devuelve el próximo número de cuenta. */
async function seedLiveService(db: Tx, s: Sede, now: Date, firstNumber: number, names: Map<string, string>) {
  const biz = bizOf(s);
  const id = (kind: string, key: string) => stableId(keyOf(s, `${kind}:${key}`));
  const ago = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
  const staff = (k: string) => id("staff", k);
  let number = firstNumber;

  const checks: Record<string, unknown>[] = [];
  const items: Record<string, unknown>[] = [];
  for (const c of s.live) {
    const checkId = id("live", c.key);
    const checkNumber = number++;
    let delivery: Record<string, unknown> | null = null;
    if (c.kind === "domicilio") {
      const d = c.delivery ?? {};
      const packed = d.packed !== undefined;
      delivery = {
        code: c.channel === "propio" ? `P-${checkNumber}` : (d.code ?? `R-${checkNumber}`),
        ...(d.phone ? { phone: d.phone } : {}),
        ...(d.address ? { address: d.address } : {}),
        ...(d.notes ? { notes: d.notes } : {}),
        ...(packed
          ? {
              packedAt: ago(d.packed!),
              packedBy: d.packedBy ?? names.get(c.by) ?? "",
              checklist: packingList(c.items.map((it) => ({ status: it.status, name: BY_KEY.get(it.key)!.name, qty: it.qty, modifiers: it.mods ?? [] }))),
            }
          : {}),
        ...(d.rider !== undefined ? { riderAt: new Date(now.getTime() + d.rider * 60_000).toISOString() } : {}),
      };
    }
    checks.push({
      id: checkId,
      business_id: biz,
      number: checkNumber,
      table_id: c.table ? id("table", c.table) : null,
      kind: c.kind,
      name: c.name ?? "",
      guests: c.guests ?? 1,
      status: c.status ?? "open",
      opened_by: staff(c.by),
      opened_at: ago(c.opened),
      closed_by: null,
      closed_at: null,
      customer_id: null,
      discount_pct: 0,
      tip_answer: null,
      updated_at: ago(1),
      channel: c.channel ?? "local",
      delivery,
      split_of: c.split ? id("live", c.split) : null,
    });
    // Cada envío a la barra es una ronda: se numeran por orden de envío; lo que no se ha enviado va en la ronda 0
    const sends = [...new Set(c.items.filter((it) => it.sent !== undefined).map((it) => it.sent!))].sort((a, b) => b - a);
    c.items.forEach((it, i) => {
      const prod = BY_KEY.get(it.key)!;
      items.push({
        id: id("live-item", `${c.key}:${i}`),
        business_id: biz,
        check_id: checkId,
        product_id: id("prod", prod.key),
        name: prod.name,
        unit_price: prod.price,
        qty: it.qty,
        modifiers: withOptionIds(it.mods, id),
        note: it.note ?? "",
        station: stationOf(prod),
        tax_rate: 8,
        status: it.status,
        round: it.sent !== undefined ? sends.indexOf(it.sent) + 1 : 0,
        source: it.source ?? "staff",
        added_by: staff(c.by),
        sent_at: it.sent !== undefined ? ago(it.sent) : null,
        ready_at: it.ready !== undefined ? ago(it.ready) : null,
        delivered_at: it.status === "delivered" && it.ready !== undefined ? ago(Math.max(0, it.ready - 2)) : null,
        void_reason: it.reason ?? null,
        void_by: it.voidBy ? staff(it.voidBy) : null,
        created_at: ago(it.sent ?? c.opened),
        allergy: !!it.allergy,
        seat: it.seat ?? null,
        held: !!it.held,
        voided_at: it.voided !== undefined ? ago(it.voided) : null,
      });
    });
  }
  await bulkInsert(db, "checks", CHECK_COLS, checks);
  await bulkInsert(db, "check_items", LIVE_ITEM_COLS, items);

  // Pedidos y llamados desde la carta QR, en la sede principal
  if (s.key === MAIN)
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
  return number;
}
