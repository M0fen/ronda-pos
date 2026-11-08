"use server";

import { cookies } from "next/headers";
import { getStaff, loginWithPin, logout, secureCookies } from "@/lib/server/auth";
import { SEDE_COOKIE } from "@/lib/server/business";
import { getDb, isDemoMode } from "@/lib/server/db";
import { currentDevice, enrollDevice } from "@/lib/server/devices";
import { safely, UserError } from "@/lib/server/errors";
import { clockToggle } from "@/lib/server/labor";

export async function pinLoginAction(staffId: string, pin: string) {
  return safely(async () => {
    const device = await currentDevice();
    if (!isDemoMode() && !device) throw new UserError("Esta tablet no está enrolada. Pide un código al dueño.");
    const staff = await loginWithPin(staffId, pin, device);
    return { role: staff.role };
  });
}

/** Enrola esta tablet en su sede con el código que dio el dueño o la administración. */
export async function enrollAction(code: string) {
  return safely(() => enrollDevice(String(code ?? "")), "Tablet enrolada");
}

/** Marca la entrada o la salida del turno con el PIN, sin entrar al sistema. */
export async function clockAction(staffId: string, pin: string) {
  return safely(async () => {
    const device = await currentDevice();
    if (!isDemoMode() && !device) throw new UserError("Esta tablet no está enrolada. Pide un código al dueño.");
    return clockToggle(staffId, pin);
  });
}

/**
 * Elige la sede de este dispositivo: la pantalla de entrada muestra a su equipo.
 * Si había una sesión abierta, se cierra: la tablet nunca queda con la sesión de una sede y la pantalla de otra.
 */
export async function chooseSedeAction(bizId: string) {
  return safely(async () => {
    const db = await getDb();
    const row = /^[0-9a-f-]{36}$/i.test(bizId) ? await db.one<{ id: string }>("select id from businesses where id = $1", [bizId]) : null;
    if (!row) throw new UserError("Sede no encontrada");
    const staff = await getStaff();
    if (staff && staff.business_id !== row.id) await logout();
    (await cookies()).set(SEDE_COOKIE, row.id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 365 * 86_400, secure: await secureCookies() });
  });
}

export async function logoutAction() {
  await logout();
}
