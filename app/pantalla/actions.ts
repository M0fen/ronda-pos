"use server";

import { readPulse } from "@/lib/server/business";

/** Versión del local para la pantalla de turnos (pública): solo un número, nada del negocio. */
export async function screenPulseAction(bizId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(String(bizId))) return -1;
  return readPulse(String(bizId));
}
