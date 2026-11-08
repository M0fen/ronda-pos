"use server";

import { safely } from "@/lib/server/errors";
import { type SetupInput, setupBusiness } from "@/lib/server/setup";

export async function setupAction(input: SetupInput) {
  return safely(() => setupBusiness(input), "¡Listo! Tu local quedó creado");
}
