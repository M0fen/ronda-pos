import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { pinHash } from "../seed";
import { createSessionToken, SESSION_COOKIE, SESSION_HOURS, verifySessionToken } from "../session";
import { getDb, type Tx } from "./db";
import { UserError } from "./errors";

export type Role = "owner" | "admin" | "cashier" | "waiter" | "bar";

export interface Staff {
  id: string;
  business_id: string;
  name: string;
  role: Role;
  color: string;
}

export const getStaff = cache(async (): Promise<Staff | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await verifySessionToken(token);
  if (!session) return null;
  const db = await getDb();
  return db.one<Staff>("select id, business_id, name, role, color from staff where id = $1 and active", [session.id]);
});

/** Cada página y acción del equipo lo llama (el proxy no basta). */
export async function requireStaff(roles?: Role[]) {
  const staff = await getStaff();
  if (!staff) redirect("/entrar");
  if (roles && !roles.includes(staff.role)) throw new UserError("Tu usuario no tiene permiso para esto");
  return staff;
}

export const can = {
  manage: (s: Staff) => s.role === "owner" || s.role === "admin",
  charge: (s: Staff) => s.role !== "bar",
  closeCash: (s: Staff) => s.role === "owner" || s.role === "admin" || s.role === "cashier",
  voidSent: (s: Staff) => s.role === "owner" || s.role === "admin" || s.role === "cashier",
  panel: (s: Staff) => s.role === "owner" || s.role === "admin" || s.role === "cashier",
};

const attempts = new Map<string, { count: number; until: number }>();

async function throttle(key: string) {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const k = `${key}:${ip}`;
  const rec = attempts.get(k);
  if (rec && rec.until > Date.now() && rec.count >= 10) throw new UserError("Demasiados intentos. Espera 5 minutos.");
  return {
    fail() {
      const next = rec && rec.until > Date.now() ? { count: rec.count + 1, until: rec.until } : { count: 1, until: Date.now() + 5 * 60_000 };
      attempts.set(k, next);
    },
    ok() {
      attempts.delete(k);
    },
  };
}

export async function loginWithPin(staffId: string, pin: string) {
  const t = await throttle("pin");
  const db = await getDb();
  const staff = await db.one<Staff & { pin_hash: string }>("select id, business_id, name, role, color, pin_hash from staff where id = $1 and active", [staffId]);
  if (!staff || staff.pin_hash !== pinHash(staff.id, pin)) {
    t.fail();
    await new Promise((r) => setTimeout(r, 300));
    throw new UserError("PIN incorrecto");
  }
  t.ok();
  const token = await createSessionToken({ id: staff.id, biz: staff.business_id, role: staff.role });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
  return staff;
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Autorización de un superior en el momento: devuelve quién autorizó, o error. */
export async function authorizeWithPin(bizId: string, pin: string, tx?: Pick<Tx, "query">) {
  const t = await throttle("auth");
  // Dentro de una transacción hay que usar la misma conexión (PGlite tiene una sola)
  const db = tx ?? (await getDb());
  const rows = await db.query<Staff & { pin_hash: string }>(
    "select id, business_id, name, role, color, pin_hash from staff where business_id = $1 and active and role in ('owner','admin','cashier')",
    [bizId],
  );
  const found = rows.find((r) => r.pin_hash === pinHash(r.id, pin));
  if (!found) {
    t.fail();
    throw new UserError("Ese PIN no puede autorizar");
  }
  t.ok();
  return found;
}
