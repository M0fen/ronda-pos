"use server";

import { loginWithPin, logout } from "@/lib/server/auth";
import { safely } from "@/lib/server/errors";

export async function pinLoginAction(staffId: string, pin: string) {
  return safely(async () => {
    const staff = await loginWithPin(staffId, pin);
    return { role: staff.role };
  });
}

export async function logoutAction() {
  await logout();
}
