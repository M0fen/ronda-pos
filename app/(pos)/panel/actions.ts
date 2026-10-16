"use server";

import { revalidatePath } from "next/cache";
import { can, requireStaff } from "@/lib/server/auth";
import { resetDemo } from "@/lib/server/db";
import { safely, UserError } from "@/lib/server/errors";
import { stockMove } from "@/lib/server/inventory";
import { createProduct, saveSettings, saveStaff, updateProduct } from "@/lib/server/panel";
import type { Settings } from "@/lib/settings";

export async function updateProductAction(productId: string, patch: { name?: string; price?: number; happyPrice?: number | null; soldOut?: boolean; active?: boolean; favorite?: boolean; description?: string }) {
  const staff = await requireStaff();
  return safely(() => updateProduct(staff, productId, patch), "Guardado");
}

export async function createProductAction(input: { name: string; categoryId: string; price: number }) {
  const staff = await requireStaff();
  return safely(() => createProduct(staff, input), "Producto creado");
}

export async function stockMoveAction(input: { ingredientId: string; kind: "compra" | "merma" | "conteo"; qty: number; totalCost?: number; note?: string }) {
  const staff = await requireStaff();
  return safely(() => stockMove(staff, input), input.kind === "compra" ? "Compra registrada" : input.kind === "merma" ? "Merma registrada" : "Conteo guardado");
}

export async function saveStaffAction(input: { id?: string; name: string; role: string; pin?: string; active?: boolean }) {
  const staff = await requireStaff();
  return safely(() => saveStaff(staff, input), "Equipo actualizado");
}

export async function saveSettingsAction(next: Settings) {
  const staff = await requireStaff();
  const r = await safely(() => saveSettings(staff, next), "Ajustes guardados");
  revalidatePath("/", "layout");
  return r;
}

export async function resetDemoAction() {
  const staff = await requireStaff();
  return safely(async () => {
    if (!can.manage(staff)) throw new UserError("Solo el dueño puede reiniciar la demo");
    await resetDemo();
  }, "Demo reiniciada");
}
