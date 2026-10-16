import "server-only";
import QRCode from "qrcode";
import { mergeSettings, type Settings } from "../settings";
import { pinHash } from "../seed";
import { normalizePhone } from "../utils";
import { can, type Staff } from "./auth";
import { audit, bump } from "./business";
import { getDb } from "./db";
import { UserError } from "./errors";

export async function updateProduct(
  staff: Staff,
  productId: string,
  patch: { name?: string; price?: number; happyPrice?: number | null; soldOut?: boolean; active?: boolean; description?: string; favorite?: boolean },
) {
  // Marcar agotado lo puede hacer cualquiera del equipo; el resto, el encargado
  const onlyStock = Object.keys(patch).every((k) => k === "soldOut");
  if (!onlyStock && !can.manage(staff)) throw new UserError("Solo el dueño o el administrador cambian la carta");
  const db = await getDb();
  await db.tx(async (tx) => {
    const p = await tx.one<{ id: string; name: string; price: number }>("select id, name, price from products where id = $1 and business_id = $2", [productId, staff.business_id]);
    if (!p) throw new UserError("Producto no encontrado");
    if (patch.name !== undefined) {
      if (patch.name.trim().length < 2) throw new UserError("Escribe el nombre");
      await tx.query("update products set name = $2 where id = $1", [productId, patch.name.trim().slice(0, 60)]);
    }
    if (patch.description !== undefined) await tx.query("update products set description = $2 where id = $1", [productId, patch.description.trim().slice(0, 200)]);
    if (patch.price !== undefined) {
      const price = Math.round(patch.price);
      if (price <= 0 || price > 5_000_000) throw new UserError("Revisa el precio");
      await tx.query("update products set price = $2 where id = $1", [productId, price]);
      if (price !== p.price) await audit(tx, staff.business_id, staff.id, "price", { product: p.name, from: p.price, to: price });
    }
    if (patch.happyPrice !== undefined) await tx.query("update products set happy_price = $2 where id = $1", [productId, patch.happyPrice && patch.happyPrice > 0 ? Math.round(patch.happyPrice) : null]);
    if (patch.soldOut !== undefined) await tx.query("update products set sold_out = $2 where id = $1", [productId, patch.soldOut]);
    if (patch.active !== undefined) await tx.query("update products set active = $2 where id = $1", [productId, patch.active]);
    if (patch.favorite !== undefined) await tx.query("update products set favorite = $2 where id = $1", [productId, patch.favorite]);
    await bump(tx, staff.business_id);
  });
}

export async function createProduct(staff: Staff, input: { name: string; categoryId: string; price: number }) {
  if (!can.manage(staff)) throw new UserError("Solo el dueño o el administrador cambian la carta");
  const name = input.name.trim();
  if (name.length < 2) throw new UserError("Escribe el nombre");
  const price = Math.round(input.price);
  if (price <= 0) throw new UserError("Escribe el precio");
  const db = await getDb();
  return db.tx(async (tx) => {
    const cat = await tx.one<{ station: string }>("select station from categories where id = $1 and business_id = $2", [input.categoryId, staff.business_id]);
    if (!cat) throw new UserError("Elige una categoría");
    const row = await tx.one<{ id: string }>(
      "insert into products (business_id, category_id, name, price, station, sort) values ($1, $2, $3, $4, $5, 999) returning id",
      [staff.business_id, input.categoryId, name.slice(0, 60), price, cat.station],
    );
    await bump(tx, staff.business_id);
    return row!.id;
  });
}

export async function listStaff(bizId: string) {
  const db = await getDb();
  return db.query<{ id: string; name: string; role: string; color: string; active: boolean }>("select id, name, role, color, active from staff where business_id = $1 order by active desc, created_at", [bizId]);
}

export async function saveStaff(actor: Staff, input: { id?: string; name: string; role: string; pin?: string; active?: boolean }) {
  if (!can.manage(actor)) throw new UserError("Solo el dueño o el administrador manejan el equipo");
  const name = input.name.trim();
  if (name.length < 2) throw new UserError("Escribe el nombre");
  if (!["owner", "admin", "cashier", "waiter", "bar"].includes(input.role)) throw new UserError("Elige un rol");
  if (input.pin !== undefined && input.pin !== "" && !/^\d{4}$/.test(input.pin)) throw new UserError("El PIN es de 4 números");
  const db = await getDb();
  await db.tx(async (tx) => {
    const others = await tx.query<{ id: string; pin_hash: string }>("select id, pin_hash from staff where business_id = $1 and active", [actor.business_id]);
    if (input.pin && others.some((o) => o.id !== input.id && o.pin_hash === pinHash(o.id, input.pin!))) throw new UserError("Ese PIN ya lo usa otra persona");
    if (input.id) {
      const row = await tx.one("select 1 from staff where id = $1 and business_id = $2", [input.id, actor.business_id]);
      if (!row) throw new UserError("Persona no encontrada");
      if (input.id === actor.id && input.active === false) throw new UserError("No puedes desactivarte a ti mismo");
      await tx.query("update staff set name = $2, role = $3, active = coalesce($4, active) where id = $1", [input.id, name.slice(0, 40), input.role, input.active ?? null]);
      if (input.pin) await tx.query("update staff set pin_hash = $2 where id = $1", [input.id, pinHash(input.id, input.pin)]);
    } else {
      if (!input.pin) throw new UserError("Asigna un PIN de 4 números");
      const id = crypto.randomUUID();
      await tx.query("insert into staff (id, business_id, name, role, pin_hash, color) values ($1, $2, $3, $4, $5, $6)", [
        id,
        actor.business_id,
        name.slice(0, 40),
        input.role,
        pinHash(id, input.pin),
        ["#1E4FB8", "#0B7A55", "#D2232A", "#B07800", "#7A4A2A", "#9B3D8F"][others.length % 6],
      ]);
    }
    await audit(tx, actor.business_id, actor.id, "staff", { name, role: input.role });
  });
}

export async function saveSettings(staff: Staff, next: Settings) {
  if (!can.manage(staff)) throw new UserError("Solo el dueño o el administrador cambian los ajustes");
  const clean = mergeSettings(next);
  for (const key of ["primary", "accent"] as const) if (!/^#[0-9a-fA-F]{6}$/.test(clean.theme[key])) throw new UserError("Revisa los colores (formato #RRGGBB)");
  if (clean.business.name.trim().length < 2) throw new UserError("Escribe el nombre del local");
  clean.alerts.ownerWhatsapp = normalizePhone(clean.alerts.ownerWhatsapp);
  const db = await getDb();
  await db.tx(async (tx) => {
    await tx.query("update businesses set name = $2, settings = $3::jsonb where id = $1", [staff.business_id, clean.business.name.trim(), JSON.stringify(clean)]);
    await audit(tx, staff.business_id, staff.id, "settings", {});
    await bump(tx, staff.business_id);
  });
}

export async function tableQrs(bizId: string, origin: string) {
  const db = await getDb();
  const tables = await db.query<{ id: string; name: string; qr_token: string; zone: string }>(
    "select t.id, t.name, t.qr_token, z.name as zone from floor_tables t join zones z on z.id = t.zone_id where t.business_id = $1 and t.active order by z.sort, t.name",
    [bizId],
  );
  return Promise.all(
    tables.map(async (t) => {
      const url = `${origin}/m/${t.qr_token}`;
      return { ...t, url, svg: await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#24150F", light: "#FFFFFF" } }) };
    }),
  );
}

export async function customersView(bizId: string, goal: number) {
  const db = await getDb();
  const rows = await db.query<{ id: string; name: string; phone: string; stamps: number; visits: number; total_spent: number; last_visit: string | null; birthday: string | null; consent_at: string | null }>(
    "select id, name, phone, stamps, visits, total_spent, last_visit, birthday, consent_at from customers where business_id = $1 order by last_visit desc nulls last",
    [bizId],
  );
  const now = Date.now();
  const month = new Date(now - 5 * 3_600_000).toISOString().slice(5, 7);
  return rows.map((r) => ({
    ...r,
    inactive: r.last_visit ? now - new Date(r.last_visit).getTime() > 30 * 86_400_000 : true,
    nearReward: r.stamps >= goal - 1,
    birthdayMonth: !!r.birthday && r.birthday.startsWith(month),
    frequent: r.visits >= 8,
  }));
}
