import "server-only";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { can, secureCookies, type Staff } from "./auth";
import { audit, SEDE_COOKIE } from "./business";
import { getDb, isDemoMode, type Tx } from "./db";
import { UserError } from "./errors";
import { allow } from "./rate-limit";

/**
 * Tablets enroladas: cada tablet queda amarrada a su sede con un código que da el dueño o la administración.
 * Sin enrolar, /entrar no muestra al equipo (en la demo sí, para poder probarla).
 */
export const DEVICE_COOKIE = "ronda_device";

const hash = (s: string) => createHash("sha256").update(`ronda-device:${s}`).digest("hex");

export interface Device {
  id: string;
  business_id: string;
  name: string;
  all_sedes: boolean;
}

export const currentDevice = cache(async (): Promise<Device | null> => {
  const token = (await cookies()).get(DEVICE_COOKIE)?.value;
  if (!token || token.length < 20) return null;
  const db = await getDb();
  return db.one<Device>("select id, business_id, name, all_sedes from devices where token_hash = $1 and revoked_at is null", [hash(token)]);
});

/** ¿Esta pantalla puede mostrar al equipo para entrar? */
export async function deviceAllowed() {
  if (isDemoMode()) return true;
  return !!(await currentDevice());
}

/** Código de 6 números, válido 15 minutos, para enrolar una tablet en la sede (o en todas, si lo pide el dueño). */
export async function createEnrollCode(actor: Staff, input: { name: string; allSedes?: boolean }) {
  if (!can.manage(actor)) throw new UserError("Solo el dueño o el administrador enrolan tablets");
  const name = (input.name ?? "").trim().slice(0, 40);
  if (name.length < 2) throw new UserError("Ponle un nombre a la tablet (ej. Caja, Barra)");
  if (input.allSedes && actor.role !== "owner") throw new UserError("Solo el dueño enrola un dispositivo para todas las sedes");
  const db = await getDb();
  return db.tx(async (tx) => {
    await tx.query("delete from device_codes where expires_at < now() or used_at is not null");
    for (let i = 0; i < 8; i++) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const rows = await tx.query(
        "insert into device_codes (code_hash, business_id, name, all_sedes, created_by, expires_at) values ($1, $2, $3, $4, $5, now() + interval '15 minutes') on conflict (code_hash) do nothing returning code_hash",
        [hash(code), actor.business_id, name, !!input.allSedes, actor.id],
      );
      if (!rows.length) continue;
      await audit(tx, actor.business_id, actor.id, "device_code", { name, allSedes: !!input.allSedes });
      return code;
    }
    throw new UserError("No se pudo crear el código. Intenta de nuevo.");
  });
}

/** La tablet escribe el código: queda enrolada en esa sede. */
export async function enrollDevice(code: string) {
  if (!(await allow("enroll", 10, 10 * 60_000))) throw new UserError("Demasiados intentos. Espera unos minutos.");
  const clean = String(code ?? "").replace(/\D/g, "");
  if (clean.length !== 6) throw new UserError("El código es de 6 números");
  const db = await getDb();
  const token = randomBytes(24).toString("base64url");
  const device = await db.tx(async (tx) => {
    const row = await tx.one<{ business_id: string; name: string; all_sedes: boolean; created_by: string | null }>(
      "select business_id, name, all_sedes, created_by from device_codes where code_hash = $1 and used_at is null and expires_at > now() for update",
      [hash(clean)],
    );
    if (!row) throw new UserError("Ese código no sirve o ya se venció. Pide uno nuevo en Panel → Equipo.");
    await tx.query("update device_codes set used_at = now() where code_hash = $1", [hash(clean)]);
    const d = await tx.one<{ id: string }>("insert into devices (business_id, name, all_sedes, token_hash, created_by) values ($1, $2, $3, $4, $5) returning id", [
      row.business_id,
      row.name,
      row.all_sedes,
      hash(token),
      row.created_by,
    ]);
    await audit(tx, row.business_id, row.created_by, "device_enrolled", { name: row.name });
    return { id: d!.id, business_id: row.business_id };
  });
  const jar = await cookies();
  const secure = await secureCookies();
  jar.set(DEVICE_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 3 * 365 * 86_400, secure });
  jar.set(SEDE_COOKIE, device.business_id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 365 * 86_400, secure });
  return device;
}

/** Al dar de alta el local, la tablet donde se hizo queda enrolada para todas las sedes del dueño. */
export async function registerDevice(tx: Pick<Tx, "one">, input: { businessId: string; name: string; allSedes: boolean; createdBy: string | null }) {
  const token = randomBytes(24).toString("base64url");
  const d = await tx.one<{ id: string }>("insert into devices (business_id, name, all_sedes, token_hash, created_by) values ($1, $2, $3, $4, $5) returning id", [
    input.businessId,
    input.name,
    input.allSedes,
    hash(token),
    input.createdBy,
  ]);
  return { id: d!.id, token };
}

export async function setDeviceCookies(token: string, businessId: string) {
  const jar = await cookies();
  const secure = await secureCookies();
  jar.set(DEVICE_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 3 * 365 * 86_400, secure });
  jar.set(SEDE_COOKIE, businessId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 365 * 86_400, secure });
}

export async function listDevices(bizId: string) {
  const db = await getDb();
  return db.query<{ id: string; name: string; all_sedes: boolean; created_at: string; last_seen: string | null }>(
    "select id, name, all_sedes, created_at, last_seen from devices where business_id = $1 and revoked_at is null order by created_at",
    [bizId],
  );
}

/** Quita una tablet (perdida o cambiada): deja de mostrar al equipo y se cierran sus sesiones. */
export async function revokeDevice(actor: Staff, deviceId: string) {
  if (!can.manage(actor)) throw new UserError("Solo el dueño o el administrador quitan tablets");
  const db = await getDb();
  await db.tx(async (tx) => {
    const d = await tx.one<{ name: string }>("update devices set revoked_at = now() where id = $1 and business_id = $2 and revoked_at is null returning name", [deviceId, actor.business_id]);
    if (!d) throw new UserError("Esa tablet ya no está");
    await tx.query("update sessions set revoked_at = now() where device_id = $1 and revoked_at is null", [deviceId]);
    await audit(tx, actor.business_id, actor.id, "device_revoked", { name: d.name });
  });
}
