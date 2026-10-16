"use server";

import { revalidatePath } from "next/cache";
import { getStaff, requireStaff } from "@/lib/server/auth";
import { readPulse } from "@/lib/server/business";
import {
  addItems,
  changeDraft,
  discardCheck,
  kdsBumpTicket,
  kdsSetItem,
  markDelivered,
  openCheck,
  sendRound,
  setBillRequested,
  setDiscount,
  toggleCourtesy,
  updateCheckMeta,
  voidItem,
} from "@/lib/server/checks";
import { safely } from "@/lib/server/errors";
import type { ChosenItem } from "@/lib/server/menu";
import { updateProduct } from "@/lib/server/panel";
import {
  addCashMovement,
  attachCustomer,
  closeCash,
  closeCheck,
  openCash,
  redeemReward,
  registerPayment,
  removePayment,
  reviewClientPayment,
  type CloseInput,
} from "@/lib/server/payments";
import { approveRequest, rejectRequest } from "@/lib/server/qr";

/** Versión del local: si cambia, las pantallas se refrescan. */
export async function pulseAction() {
  const staff = await getStaff();
  if (!staff) return -1;
  return readPulse(staff.business_id);
}

export async function openCheckAction(input: { tableId?: string | null; kind: "mesa" | "barra" | "llevar"; name?: string; guests?: number }) {
  const staff = await requireStaff();
  return safely(() => openCheck(staff, input));
}

export async function addItemsAction(checkId: string, items: ChosenItem[]) {
  const staff = await requireStaff();
  return safely(() => addItems(staff, checkId, items));
}

export async function changeDraftAction(itemId: string, patch: { qty?: number; note?: string }) {
  const staff = await requireStaff();
  return safely(() => changeDraft(staff, itemId, patch));
}

export async function sendRoundAction(checkId: string) {
  const staff = await requireStaff();
  return safely(() => sendRound(staff, checkId));
}

export async function voidItemAction(itemId: string, input: { reason: string; waste: boolean; pin?: string }) {
  const staff = await requireStaff();
  return safely(() => voidItem(staff, itemId, input));
}

export async function courtesyAction(itemId: string, pin?: string) {
  const staff = await requireStaff();
  return safely(() => toggleCourtesy(staff, itemId, pin), "Listo");
}

export async function discountAction(checkId: string, input: { pct: number; reason: string; pin?: string }) {
  const staff = await requireStaff();
  return safely(() => setDiscount(staff, checkId, input), "Descuento aplicado");
}

export async function billAction(checkId: string, on: boolean) {
  const staff = await requireStaff();
  return safely(() => setBillRequested(staff, checkId, on));
}

export async function deliveredAction(checkId: string) {
  const staff = await requireStaff();
  return safely(() => markDelivered(staff, checkId), "Marcado como entregado");
}

export async function updateCheckAction(checkId: string, patch: { guests?: number; name?: string; tableId?: string }) {
  const staff = await requireStaff();
  return safely(() => updateCheckMeta(staff, checkId, patch), "Cuenta actualizada");
}

export async function discardCheckAction(checkId: string) {
  const staff = await requireStaff();
  return safely(() => discardCheck(staff, checkId), "Cuenta descartada");
}

export async function paymentAction(checkId: string, input: { method: string; amount: number; tip: number; received?: number | null; reference?: string; part?: string }) {
  const staff = await requireStaff();
  return safely(() => registerPayment(staff, checkId, input));
}

export async function reviewClientPaymentAction(paymentId: string, approve: boolean) {
  const staff = await requireStaff();
  return safely(() => reviewClientPayment(staff, paymentId, approve), approve ? "Pago confirmado" : "Pago rechazado");
}

export async function removePaymentAction(paymentId: string) {
  const staff = await requireStaff();
  return safely(() => removePayment(staff, paymentId), "Pago quitado");
}

export async function closeCheckAction(checkId: string, input: CloseInput) {
  const staff = await requireStaff();
  const result = await safely(() => closeCheck(staff, checkId, input));
  if (result.ok) revalidatePath("/salon");
  return result;
}

export async function redeemRewardAction(checkId: string) {
  const staff = await requireStaff();
  return safely(() => redeemReward(staff, checkId), "Premio aplicado");
}

export async function attachCustomerAction(checkId: string, input: { phone: string; name?: string; consent: boolean }) {
  const staff = await requireStaff();
  return safely(() => attachCustomer(staff, checkId, input), "Cliente agregado");
}

export async function approveRequestAction(requestId: string) {
  const staff = await requireStaff();
  return safely(() => approveRequest(staff, requestId));
}

export async function rejectRequestAction(requestId: string) {
  const staff = await requireStaff();
  return safely(() => rejectRequest(staff, requestId), "Pedido rechazado");
}

export async function kdsItemAction(itemId: string, status: "sent" | "ready" | "delivered") {
  const staff = await requireStaff();
  return safely(() => kdsSetItem(staff, itemId, status));
}

export async function kdsBumpAction(checkId: string, round: number, station: string, status: "ready" | "delivered" | "recall") {
  const staff = await requireStaff();
  return safely(() => kdsBumpTicket(staff, checkId, round, station, status));
}

export async function openCashAction(opening: number) {
  const staff = await requireStaff();
  return safely(() => openCash(staff, opening), "Caja abierta");
}

export async function cashMoveAction(input: { kind: "in" | "out"; amount: number; reason: string }) {
  const staff = await requireStaff();
  return safely(() => addCashMovement(staff, input), "Movimiento guardado");
}

export async function closeCashAction(counted: number, note: string) {
  const staff = await requireStaff();
  return safely(() => closeCash(staff, counted, note));
}

export async function soldOutAction(productId: string, soldOut: boolean) {
  const staff = await requireStaff();
  return safely(() => updateProduct(staff, productId, { soldOut }), soldOut ? "Marcado como agotado" : "Disponible otra vez");
}
