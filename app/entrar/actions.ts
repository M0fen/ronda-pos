"use server";

import { loginWithPin, logout } from "@/lib/server/auth";
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

export async function logoutAction() {
  await logout();
}
