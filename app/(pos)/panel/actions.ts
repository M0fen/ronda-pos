"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/server/auth";
import { safely, UserError } from "@/lib/server/errors";
import { exportCsv } from "@/lib/server/export";
import { stockMove } from "@/lib/server/inventory";
import { closeShift } from "@/lib/server/labor";
import { createEnrollCode, revokeDevice } from "@/lib/server/devices";
import { canResetDemo, resetDemo } from "@/lib/server/db";
import {
  deleteCategory,
  deleteZone,
  type IngredientInput,
  moveCategory,
  placeTable,
  removeTable,
  saveCategory,
  saveIngredient,
  saveTable,
  saveZone,
  setRecipe,
  type TableInput,
} from "@/lib/server/catalog";
import { applyTaxToMenu, createProduct, deleteCustomer, saveSettings, saveStaff, unlockStaff, updateProduct, withdrawConsent } from "@/lib/server/panel";
import type { Settings } from "@/lib/settings";

export async function updateProductAction(
  productId: string,
  patch: { name?: string; price?: number; happyPrice?: number | null; soldOut?: boolean; active?: boolean; favorite?: boolean; description?: string; categoryId?: string; station?: string },
) {
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

export async function saveStaffAction(input: { id?: string; name: string; role: string; pin?: string; active?: boolean; payKind?: string; payAmount?: number }) {
  const staff = await requireStaff();
  return safely(() => saveStaff(staff, input), "Equipo actualizado");
}

export async function withdrawConsentAction(customerId: string) {
  const staff = await requireStaff();
  return safely(() => withdrawConsent(staff, customerId), "Autorización retirada");
}

export async function deleteCustomerAction(customerId: string) {
  const staff = await requireStaff();
  return safely(() => deleteCustomer(staff, customerId), "Datos del cliente borrados");
}

export async function applyTaxAction(rate: number) {
  const staff = await requireStaff();
  return safely(() => applyTaxToMenu(staff, rate), "Tarifa aplicada a toda la carta");
}

export async function unlockStaffAction(staffId: string) {
  const staff = await requireStaff();
  return safely(() => unlockStaff(staff, staffId), "PIN desbloqueado");
}

export async function enrollCodeAction(input: { name: string; allSedes?: boolean }) {
  const staff = await requireStaff();
  return safely(() => createEnrollCode(staff, input));
}

export async function revokeDeviceAction(deviceId: string) {
  const staff = await requireStaff();
  return safely(() => revokeDevice(staff, deviceId), "Tablet quitada");
}

export async function closeShiftAction(shiftId: string, hhmm: string) {
  const staff = await requireStaff();
  return safely(() => closeShift(staff, shiftId, hhmm), "Turno cerrado");
}

export async function saveSettingsAction(next: Settings) {
  const staff = await requireStaff();
  const r = await safely(() => saveSettings(staff, next), "Ajustes guardados");
  revalidatePath("/", "layout");
  return r;
}

/** Reiniciar la demo: solo el dueño, solo con la base en memoria o con permiso explícito (ALLOW_DEMO_RESET). */
export async function resetDemoAction() {
  const staff = await requireStaff();
  return safely(async () => {
    if (staff.role !== "owner") throw new UserError("Solo el dueño puede reiniciar la demo");
    if (!canResetDemo()) throw new UserError("Reiniciar la demo no está permitido en esta instalación");
    await resetDemo();
  }, "Demo reiniciada");
}

// ——— Editores del local: categorías, recetas, insumos, zonas y mesas ———

export async function saveCategoryAction(input: { id?: string | null; name: string; color: string; station: string }) {
  const staff = await requireStaff();
  return safely(() => saveCategory(staff, input), input.id ? "Categoría guardada" : "Categoría creada");
}

export async function moveCategoryAction(id: string, dir: number) {
  const staff = await requireStaff();
  return safely(() => moveCategory(staff, String(id), Number(dir)));
}

export async function deleteCategoryAction(id: string) {
  const staff = await requireStaff();
  return safely(() => deleteCategory(staff, String(id)), "Categoría borrada");
}

export async function setRecipeAction(productId: string, items: { ingredientId: string; qty: number }[]) {
  const staff = await requireStaff();
  return safely(() => setRecipe(staff, String(productId), items), "Receta guardada");
}

export async function saveIngredientAction(input: IngredientInput) {
  const staff = await requireStaff();
  return safely(() => saveIngredient(staff, input), input.id ? "Insumo guardado" : "Insumo creado");
}

export async function saveZoneAction(input: { id?: string | null; name: string }) {
  const staff = await requireStaff();
  return safely(() => saveZone(staff, input), input.id ? "Zona guardada" : "Zona creada");
}

export async function deleteZoneAction(id: string) {
  const staff = await requireStaff();
  return safely(() => deleteZone(staff, String(id)), "Zona quitada");
}

export async function saveTableAction(input: TableInput) {
  const staff = await requireStaff();
  return safely(() => saveTable(staff, input), input.id ? "Mesa guardada" : "Mesa creada");
}

export async function placeTableAction(id: string, pos: { x: number; y: number }) {
  const staff = await requireStaff();
  return safely(() => placeTable(staff, String(id), pos));
}

export async function removeTableAction(id: string) {
  const staff = await requireStaff();
  return safely(() => removeTable(staff, String(id)), "Mesa quitada");
}

// ——— Para el contador: archivos CSV por jornada y por sede ———

export async function exportCsvAction(input: { kind: string; from: string; to: string; allSedes?: boolean }) {
  const staff = await requireStaff();
  return safely(() => exportCsv(staff, input));
}
