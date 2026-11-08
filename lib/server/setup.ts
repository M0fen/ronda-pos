import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { mergeSettings } from "../settings";
import { pinHash } from "../seed";
import { normalizePhone } from "../utils";
import { loginWithPin } from "./auth";
import { audit, getBusiness } from "./business";
import { getDb, isDemoMode } from "./db";
import { registerDevice, setDeviceCookies } from "./devices";
import { UserError } from "./errors";
import { allow } from "./rate-limit";

/**
 * Alta de un local nuevo: solo con la base vacía (fuera de la demo) y con el código de instalación
 * (SETUP_TOKEN). Crea la sede, el dueño, el salón y las categorías, enrola esta tablet y deja al dueño adentro.
 */

export function setupConfigured() {
  return (process.env.SETUP_TOKEN ?? "").trim().length >= 12;
}

export async function needsSetup() {
  if (isDemoMode()) return false;
  const db = await getDb();
  const row = await db.one<{ n: number }>("select count(*)::int as n from businesses");
  return !row?.n;
}

const TEMPLATES = {
  cafe: [
    ["Café", "#7A4A2A", "barra"],
    ["Bebidas frías", "#1E4FB8", "barra"],
    ["Panadería", "#B07800", "barra"],
    ["Desayunos", "#C2541B", "cocina"],
    ["Postres", "#D2232A", "barra"],
  ],
  bar: [
    ["Cervezas", "#E0A100", "barra"],
    ["Cócteles", "#D2232A", "barra"],
    ["Licores", "#7A4A2A", "barra"],
    ["Sin alcohol", "#1E4FB8", "barra"],
    ["Para picar", "#C2541B", "cocina"],
  ],
  restaurante: [
    ["Entradas", "#0B7A55", "cocina"],
    ["Platos fuertes", "#C2541B", "cocina"],
    ["Bebidas", "#1E4FB8", "barra"],
    ["Postres", "#D2232A", "cocina"],
  ],
} as const;

const TAX = {
  consumo: { label: "Impuesto al consumo", rate: 8 },
  iva: { label: "IVA", rate: 19 },
  ninguno: { label: "Sin impuesto", rate: 0 },
} as const;

export interface SetupInput {
  token: string;
  kind: keyof typeof TEMPLATES;
  name: string;
  legalName: string;
  nit: string;
  city: string;
  address: string;
  phone: string;
  sede: string;
  tax: keyof typeof TAX;
  tables: number;
  barSeats: number;
  owner: string;
  pin: string;
}

const text = (v: unknown, max: number) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);

function tokenOk(given: string) {
  const want = (process.env.SETUP_TOKEN ?? "").trim();
  if (want.length < 12) return false;
  const a = createHash("sha256").update(String(given ?? "").trim()).digest();
  const b = createHash("sha256").update(want).digest();
  return timingSafeEqual(a, b);
}

/** Cuadrícula de 4 × 2 del plano del salón, como la de la demo; lo que no cabe va en filas de en medio. */
function slot(i: number) {
  const base = [6, 30, 54, 78];
  if (i < 8) return { x: base[i % 4]!, y: i < 4 ? 10 : 56 };
  const j = i - 8;
  return { x: [18, 42, 66][j % 3]!, y: 33 };
}

export async function setupBusiness(input: SetupInput) {
  if (!(await allow("setup", 10, 10 * 60_000))) throw new UserError("Demasiados intentos. Espera unos minutos.");
  if (!setupConfigured()) throw new UserError("Falta configurar el código de instalación (SETUP_TOKEN) en el servidor");
  if (!tokenOk(input.token)) throw new UserError("Ese código de instalación no es el del servidor", { token: "No coincide" });
  const kind = input.kind in TEMPLATES ? input.kind : "cafe";
  const tax = TAX[input.tax in TAX ? input.tax : "consumo"];
  const name = text(input.name, 40);
  if (name.length < 2) throw new UserError("Escribe el nombre del local", { name: "Falta" });
  const owner = text(input.owner, 40);
  if (owner.length < 2) throw new UserError("Escribe tu nombre", { owner: "Falta" });
  const pin = String(input.pin ?? "");
  if (!/^\d{6}$/.test(pin)) throw new UserError("El PIN del dueño es de 6 números", { pin: "6 números" });
  if (/^(\d)\1{5}$/.test(pin) || "0123456789".includes(pin) || "9876543210".includes(pin)) throw new UserError("Ese PIN es muy fácil de adivinar: usa otro", { pin: "Muy fácil" });
  const tables = Math.max(0, Math.min(11, Math.round(Number(input.tables) || 0)));
  const barSeats = Math.max(0, Math.min(11, Math.round(Number(input.barSeats) || 0)));
  if (!tables && !barSeats) throw new UserError("Pon al menos una mesa o una silla de barra");
  const phone = input.phone ? normalizePhone(input.phone) : "";
  if (input.phone && !phone) throw new UserError("El celular es de 10 números", { phone: "10 números" });
  const settings = mergeSettings({
    business: { name, legalName: text(input.legalName, 80), nit: text(input.nit, 20), address: text(input.address, 80), city: text(input.city, 40) || "Colombia", phone, instagram: "" },
    tax,
  });

  const db = await getDb();
  const { bizId, ownerId, device } = await db.tx(async (tx) => {
    // Solo una vez: si dos personas lo intentan a la vez, la segunda encuentra el local ya creado
    await tx.query("lock table businesses in exclusive mode");
    const exists = await tx.one<{ n: number }>("select count(*)::int as n from businesses");
    if (exists?.n) throw new UserError("Este sistema ya tiene un local. Entra con tu PIN.");
    const biz = await tx.one<{ id: string }>("insert into businesses (name, slug, settings, sede) values ($1, $2, $3::jsonb, $4) returning id", [
      name,
      name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "local",
      JSON.stringify(settings),
      text(input.sede, 30),
    ]);
    const bizId = biz!.id;
    await tx.query("insert into pulse (business_id, version) values ($1, 1) on conflict do nothing", [bizId]);
    const staff = await tx.one<{ id: string }>("insert into staff (business_id, name, role, pin_hash, color, pin_len) values ($1, $2, 'owner', 'pendiente', '#7A4A2A', 6) returning id", [bizId, owner]);
    await tx.query("update staff set pin_hash = $2 where id = $1", [staff!.id, pinHash(staff!.id, pin)]);

    let order = 0;
    const addZone = async (zoneName: string) => (await tx.one<{ id: string }>("insert into zones (business_id, name, sort) values ($1, $2, $3) returning id", [bizId, zoneName, order++]))!.id;
    const token = () => `m${createHash("sha256").update(`${bizId}:${Math.random()}:${Date.now()}`).digest("base64url").replace(/[-_]/g, "").slice(0, 10).toLowerCase()}`;
    if (tables) {
      const zone = await addZone("Salón");
      for (let i = 0; i < tables; i++) {
        const { x, y } = slot(i);
        await tx.query("insert into floor_tables (business_id, zone_id, name, seats, x, y, shape, qr_token) values ($1, $2, $3, 4, $4, $5, 'square', $6)", [bizId, zone, String(i + 1), x, y, token()]);
      }
    }
    if (barSeats) {
      const zone = await addZone("Barra");
      for (let i = 0; i < barSeats; i++) {
        const { x, y } = slot(i);
        await tx.query("insert into floor_tables (business_id, zone_id, name, seats, x, y, shape, qr_token) values ($1, $2, $3, 1, $4, $5, 'round', $6)", [bizId, zone, `B${i + 1}`, x, y, token()]);
      }
    }
    for (const [i, [cat, color, station]] of TEMPLATES[kind].entries())
      await tx.query("insert into categories (business_id, name, color, station, sort) values ($1, $2, $3, $4, $5)", [bizId, cat, color, station, i]);

    const device = await registerDevice(tx, { businessId: bizId, name: "Tablet del alta", allSedes: true, createdBy: staff!.id });
    await audit(tx, bizId, staff!.id, "setup", { name, kind, tables, barSeats });
    return { bizId, ownerId: staff!.id, device };
  });
  await setDeviceCookies(device.token, bizId);
  await loginWithPin(ownerId, pin, { id: device.id, business_id: bizId, all_sedes: true });
  return bizId;
}

/** Lo que falta para operar un local recién creado. Nada en la demo; nada cuando ya está todo. */
export async function setupProgress(bizId: string) {
  if (isDemoMode()) return null;
  const db = await getDb();
  const [r, biz] = await Promise.all([
    db.one<{ products: number; tables: number; ingredients: number; recipes: number; staff: number; cash: number }>(
      `select (select count(*)::int from products where business_id = $1 and active) as products,
              (select count(*)::int from floor_tables where business_id = $1 and active) as tables,
              (select count(*)::int from ingredients where business_id = $1) as ingredients,
              (select count(distinct product_id)::int from recipe_items where business_id = $1) as recipes,
              (select count(*)::int from staff where business_id = $1 and active) as staff,
              (select count(*)::int from cash_sessions where business_id = $1) as cash`,
      [bizId],
    ),
    getBusiness(bizId),
  ]);
  if (!r) return null;
  const inv = biz.settings.invoice;
  const steps = [
    { label: "Carta: categorías, productos y precios", href: "/panel/carta", done: r.products > 0 },
    { label: "Mesas y zonas del salón", href: "/panel/mesas", done: r.tables > 0 },
    { label: "Equipo con su PIN, y las tablets que van a usar", href: "/panel/equipo", done: r.staff > 1 },
    { label: "Resolución de facturación de la DIAN", href: "/panel/ajustes", done: !!inv.resolution && inv.rangeTo > 0 },
    { label: "Abrir caja y hacer una venta de prueba", href: "/caja", done: r.cash > 0 },
    { label: "Insumos y recetas (opcional): inventario y márgenes", href: "/panel/inventario", done: r.ingredients > 0 && r.recipes > 0, optional: true },
  ];
  // Se va cuando está lo necesario para vender; lo opcional no la deja pegada
  return steps.every((s) => s.done || "optional" in s) ? null : steps;
}
