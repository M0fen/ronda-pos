"use server";

import { cookies } from "next/headers";
import { loginWithPin, logout } from "@/lib/server/auth";
import { SEDE_COOKIE } from "@/lib/server/business";
import { getDb } from "@/lib/server/db";
import { safely } from "@/lib/server/errors";
import { clockToggle } from "@/lib/server/labor";

export async function pinLoginAction(staffId: string, pin: string) {
  return safely(async () => {
    const staff = await loginWithPin(staffId, pin);
    return { role: staff.role };
  });
}

/** Marca la entrada o la salida del turno con el PIN, sin entrar al sistema. */
export async function clockAction(staffId: string, pin: string) {
  return safely(() => clockToggle(staffId, pin));
}

/** Elige la sede de este dispositivo: la pantalla de entrada muestra a su equipo. */
export async function chooseSedeAction(bizId: string) {
  return safely(async () => {
    const db = await getDb();
    const row = /^[0-9a-f-]{36}$/i.test(bizId) ? await db.one<{ id: string }>("select id from businesses where id = $1", [bizId]) : null;
    if (!row) throw new Error("Sede no encontrada");
    (await cookies()).set(SEDE_COOKIE, row.id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 365 * 86_400, secure: process.env.NODE_ENV === "production" });
  });
}

export async function logoutAction() {
  await logout();
}
