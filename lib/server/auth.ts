import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { pinHash } from "../seed";
import { createSessionToken, SESSION_COOKIE, SESSION_HOURS, verifySessionToken } from "../session";
import { audit, SEDE_COOKIE } from "./business";
import { getDb, isEphemeralDb, type Tx } from "./db";
import { UserError } from "./errors";

export type Role = "owner" | "admin" | "cashier" | "waiter" | "bar";

export interface Staff {
  id: string;
  business_id: string;
  name: string;
  role: Role;
  color: string;
}

/** Quién puede autorizar cada cosa con su PIN (siempre otra persona, nunca quien la pide). */
export const AUTHORIZERS = {
  /** Anular lo enviado, quitar pagos, sacar plata de la caja */
  void: ["owner", "admin", "cashier"] as Role[],
  /** Cortesías, descuentos sobre el límite, corregir cobros y facturas */
  manage: ["owner", "admin"] as Role[],
};
export type AuthLevel = keyof typeof AUTHORIZERS;

/** Autorización que llega de la pantalla: quién autoriza y su PIN. */
export interface AuthInput {
  id: string;
  pin: string;
}

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
/** Tope alto por dirección: frena un script que pruebe PIN de todo el equipo, sin bloquear el wifi del local por unos errores */
const IP_FAILS = 40;
const IP_WINDOW = 10 * 60_000;

export const getStaff = cache(async (): Promise<Staff | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await verifySessionToken(token);
  if (!session?.sid) return null;
  const db = await getDb();
  const staff = await db.one<Staff>("select id, business_id, name, role, color from staff where id = $1 and active", [session.id]);
  if (!staff) return null;
  const row = await db.one<{ revoked_at: string | null }>("select revoked_at from sessions where id = $1 and staff_id = $2", [session.sid, staff.id]);
  if (row?.revoked_at) return null;
  if (!row) {
    // La demo en memoria tiene una base por copia del servidor: la sesión de otra copia sigue valiendo
    if (!isEphemeralDb()) return null;
    await db.query("insert into sessions (id, business_id, staff_id) values ($1, $2, $3) on conflict do nothing", [session.sid, staff.business_id, staff.id]);
  }
  return staff;
});

/** Cada página y acción del equipo lo llama (el proxy no basta). Si el rol no alcanza, vuelve a una pantalla que sí puede ver. */
export async function requireStaff(roles?: Role[]) {
  const staff = await getStaff();
  if (!staff) redirect("/entrar?sesion=1");
  if (roles && !roles.includes(staff.role)) redirect(can.panel(staff) ? "/panel" : "/salon");
  return staff;
}

export const can = {
  manage: (s: Staff) => s.role === "owner" || s.role === "admin",
  charge: (s: Staff) => s.role !== "bar",
  closeCash: (s: Staff) => s.role === "owner" || s.role === "admin" || s.role === "cashier",
  voidSent: (s: Staff) => s.role === "owner" || s.role === "admin" || s.role === "cashier",
  panel: (s: Staff) => s.role === "owner" || s.role === "admin" || s.role === "cashier",
  /** Ver todas las sedes juntas: solo el dueño; el administrador de cada sede ve la suya */
  chain: (s: Staff) => s.role === "owner",
  /** Ver el efectivo esperado antes de contar: así el arqueo de caja es a ciegas */
  seeExpected: (s: Staff) => s.role === "owner" || s.role === "admin",
};

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "local";
}

const ipFails = new Map<string, { count: number; until: number }>();

async function ipBlocked() {
  const rec = ipFails.get(await clientIp());
  return !!rec && rec.until > Date.now() && rec.count >= IP_FAILS;
}

async function noteIpFail() {
  const ip = await clientIp();
  const rec = ipFails.get(ip);
  ipFails.set(ip, rec && rec.until > Date.now() ? { count: rec.count + 1, until: rec.until } : { count: 1, until: Date.now() + IP_WINDOW });
  if (ipFails.size > 5000) for (const [k, v] of ipFails) if (v.until < Date.now()) ipFails.delete(k);
}

function minutesLeft(until: string) {
  return Math.max(1, Math.ceil((Date.parse(until) - Date.now()) / 60_000));
}

/**
 * Verifica el PIN de una persona. Los fallos se cuentan por persona en la base: con 5 seguidos
 * su PIN queda bloqueado 15 minutos (el dueño lo desbloquea en Equipo). Corre fuera de cualquier
 * transacción para que el fallo quede guardado aunque la acción no siga.
 */
export async function verifyPin(staffId: string, pin: string, opts: { bizId?: string; roles?: Role[] } = {}): Promise<Staff> {
  if (await ipBlocked()) throw new UserError("Demasiados intentos desde este equipo. Espera unos minutos.");
  const db = await getDb();
  const row = /^[0-9a-f-]{36}$/i.test(staffId)
    ? await db.one<Staff & { pin_hash: string; pin_fails: number; locked_until: string | null }>(
        "select id, business_id, name, role, color, pin_hash, pin_fails, locked_until from staff where id = $1 and active",
        [staffId],
      )
    : null;
  if (!row || (opts.bizId && row.business_id !== opts.bizId) || (opts.roles && !opts.roles.includes(row.role))) {
    await noteIpFail();
    throw new UserError("Esa persona no puede hacer esto");
  }
  if (row.locked_until && Date.parse(row.locked_until) > Date.now()) {
    throw new UserError(`El PIN de ${row.name} está bloqueado ${minutesLeft(row.locked_until)} min por intentos fallidos. El dueño puede desbloquearlo en Equipo.`);
  }
  if (row.pin_hash !== pinHash(row.id, String(pin ?? ""))) {
    await noteIpFail();
    const fails = row.pin_fails + 1;
    if (fails >= MAX_FAILS) {
      await db.tx(async (tx) => {
        await tx.query(`update staff set pin_fails = 0, locked_until = now() + interval '${LOCK_MINUTES} minutes' where id = $1`, [row.id]);
        await audit(tx, row.business_id, row.id, "pin_locked", { name: row.name });
      });
      await new Promise((r) => setTimeout(r, 300));
      throw new UserError(`PIN incorrecto. El PIN de ${row.name} queda bloqueado ${LOCK_MINUTES} minutos; el dueño puede desbloquearlo en Equipo.`);
    }
    await db.query("update staff set pin_fails = $2 where id = $1", [row.id, fails]);
    await new Promise((r) => setTimeout(r, 300));
    const left = MAX_FAILS - fails;
    throw new UserError(`PIN incorrecto. ${left === 1 ? "Queda 1 intento" : `Quedan ${left} intentos`} antes de bloquearlo.`);
  }
  if (row.pin_fails || row.locked_until) await db.query("update staff set pin_fails = 0, locked_until = null where id = $1", [row.id]);
  return { id: row.id, business_id: row.business_id, name: row.name, role: row.role, color: row.color };
}

/**
 * Autorización de otra persona en el momento: quién autoriza y su PIN, con el rol que pide cada acción.
 * Se verifica antes de la transacción de la acción (ver verifyPin).
 */
export async function verifyAuthorizer(requester: Staff, auth: AuthInput | undefined | null, level: AuthLevel): Promise<Staff | null> {
  if (!auth?.id || !auth.pin) return null;
  if (auth.id === requester.id) throw new UserError("Tiene que autorizar otra persona, no quien hace el cambio");
  return verifyPin(auth.id, auth.pin, { bizId: requester.business_id, roles: AUTHORIZERS[level] });
}

/** Pide autorización si hace falta: si la acción la necesita y no llegó, la pantalla abre la hoja de autorización. */
export function requireAuth(needed: boolean, requester: Staff, who: Staff | null, level: AuthLevel): Staff {
  if (!needed) return requester;
  if (!who) throw new UserError(level === "manage" ? "Necesita la autorización del dueño o del administrador" : "Necesita la autorización de caja o del encargado", { auth: level });
  return who;
}

/** Personas que pueden autorizar en la sede (para la hoja de autorización). */
export async function authorizersOf(bizId: string) {
  const db = await getDb();
  return db.query<{ id: string; name: string; role: Role; color: string; pin_len: number }>(
    "select id, name, role, color, pin_len from staff where business_id = $1 and active and role in ('owner','admin','cashier') order by role, name",
    [bizId],
  );
}

async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: await secureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

/** Cookies seguras cuando la petición llega por https (en el wifi del local puede ser http). */
export async function secureCookies() {
  const h = await headers();
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (proto) return proto === "https";
  return process.env.NODE_ENV === "production" && !/^(localhost|127\.0\.0\.1|192\.168\.|10\.)/.test(h.get("host") ?? "");
}

/** Entra con el PIN. En una tablet enrolada, solo el equipo de su sede (salvo el dispositivo del dueño, que sirve en todas). */
export async function loginWithPin(staffId: string, pin: string, device?: { id: string; business_id: string; all_sedes: boolean } | null) {
  const staff = await verifyPin(staffId, pin, { bizId: device && !device.all_sedes ? device.business_id : undefined });
  const db = await getDb();
  const session = await db.one<{ id: string }>("insert into sessions (business_id, staff_id, device_id) values ($1, $2, $3) returning id", [staff.business_id, staff.id, device?.id ?? null]);
  const token = await createSessionToken({ id: staff.id, biz: staff.business_id, role: staff.role, sid: session!.id });
  (await cookies()).set(SEDE_COOKIE, staff.business_id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 365 * 86_400, secure: await secureCookies() });
  await setSessionCookie(token);
  return staff;
}

/** Renueva la sesión mientras se usa: el cobro no se cae a las 14 horas. La llama el pulso de las pantallas. */
export async function renewSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session?.sid || !session.iat) return;
  if (Date.now() / 1000 - session.iat < 3600) return;
  const db = await getDb();
  await db.query("update sessions set last_seen = now() where id = $1", [session.sid]);
  await setSessionCookie(await createSessionToken({ id: session.id, biz: session.biz, role: session.role, sid: session.sid }));
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (session?.sid) {
    const db = await getDb();
    await db.query("update sessions set revoked_at = now() where id = $1 and revoked_at is null", [session.sid]);
  }
  jar.delete(SESSION_COOKIE);
}

/** Cierra todas las sesiones de una persona (cambio de PIN, de rol o desactivación). */
export async function revokeSessions(tx: Pick<Tx, "query">, staffId: string) {
  await tx.query("update sessions set revoked_at = now() where staff_id = $1 and revoked_at is null", [staffId]);
}
