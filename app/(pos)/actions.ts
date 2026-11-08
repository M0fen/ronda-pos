"use server";

import { revalidatePath } from "next/cache";
import { getStaff, renewSession, requireStaff, verifyPin, type AuthInput } from "@/lib/server/auth";
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
  changePaymentMethod,
  closeCash,
  closeCheck,
  fixCashCount,
  openCash,
  redeemReward,
  registerPayment,
  reissueInvoice,
  removePayment,
  reviewClientPayment,
  voidSale,
  type CloseInput,
} from "@/lib/server/payments";
import { approveRequest, rejectRequest } from "@/lib/server/qr";
import { cancelDelivery, createDelivery, dispatchDelivery, packDelivery } from "@/lib/server/delivery";

/** Versión del local: si cambia, las pantallas se refrescan. -1: la sesión terminó. De paso renueva la sesión mientras se usa. */
export async function pulseAction() {
  const staff = await getStaff();
  if (!staff) return -1;
  await renewSession().catch(() => {});
  return readPulse(staff.business_id);
}

/** Desbloquea la pantalla tras la inactividad con el PIN de quien tiene la sesión. */
export async function unlockAction(pin: string) {
  const staff = await requireStaff();
  return safely(async () => {
    await verifyPin(staff.id, String(pin ?? ""));
  });
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

export async function voidItemAction(itemId: string, input: { reason: string; waste: boolean; auth?: AuthInput | null }) {
  const staff = await requireStaff();
  return safely(() => voidItem(staff, itemId, input));
}

export async function courtesyAction(itemId: string, auth?: AuthInput | null) {
  const staff = await requireStaff();
  return safely(() => toggleCourtesy(staff, itemId, auth), "Listo");
}

export async function discountAction(checkId: string, input: { pct: number; reason: string; auth?: AuthInput | null }) {
  const staff = await requireStaff();
  return safely(() => setDiscount(staff, checkId, input), "Descuento aplicado");
}

export async function billAction(checkId: string, on: boolean) {
  const staff = await requireStaff();
  return safely(() => setBillRequested(staff, checkId, on));
}

export async function deliveredAction(checkId: string, itemId?: string | null) {
  const staff = await requireStaff();
  return safely(() => markDelivered(staff, checkId, itemId), "Marcado como entregado");
}

export async function updateCheckAction(checkId: string, patch: { guests?: number; name?: string; tableId?: string }) {
  const staff = await requireStaff();
  return safely(() => updateCheckMeta(staff, checkId, patch), "Cuenta actualizada");
}

export async function discardCheckAction(checkId: string) {
  const staff = await requireStaff();
  return safely(() => discardCheck(staff, checkId), "Cuenta descartada");
}

export async function paymentAction(checkId: string, input: { method: string; amount: number; tip: number; received?: number | null; reference?: string; part?: string; confirmTip?: boolean }) {
  const staff = await requireStaff();
  return safely(() => registerPayment(staff, checkId, input));
}

export async function reviewClientPaymentAction(paymentId: string, approve: boolean) {
  const staff = await requireStaff();
  return safely(() => reviewClientPayment(staff, paymentId, approve), approve ? "Pago confirmado" : "Pago rechazado");
}

export async function removePaymentAction(paymentId: string, input: { reason: string; auth?: AuthInput | null }) {
  const staff = await requireStaff();
  return safely(() => removePayment(staff, paymentId, input), "Pago quitado");
}

export async function changePaymentMethodAction(paymentId: string, input: { method: string; reference?: string; auth?: AuthInput | null }) {
  const staff = await requireStaff();
  return safely(() => changePaymentMethod(staff, paymentId, input), "Pago corregido");
}

export async function reissueInvoiceAction(checkId: string, input: { invoice: CloseInput["invoice"]; auth?: AuthInput | null }) {
  const staff = await requireStaff();
  return safely(() => reissueInvoice(staff, checkId, input), "Factura anulada con nota crédito y emitida de nuevo");
}

export async function voidSaleAction(checkId: string, input: { reason: string; auth?: AuthInput | null }) {
  const staff = await requireStaff();
  return safely(() => voidSale(staff, checkId, input), "Venta anulada con nota crédito");
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

export async function kdsItemAction(itemId: string, status: "sent" | "ready") {
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

export async function cashMoveAction(input: { kind: "in" | "out"; amount: number; reason: string; auth?: AuthInput | null }) {
  const staff = await requireStaff();
  return safely(() => addCashMovement(staff, input), "Movimiento guardado");
}

export async function closeCashAction(input: { counted: number; note: string; confirm: boolean }) {
  const staff = await requireStaff();
  return safely(() => closeCash(staff, input));
}

export async function fixCashCountAction(sessionId: string, input: { counted: number; note: string }) {
  const staff = await requireStaff();
  return safely(() => fixCashCount(staff, sessionId, input), "Conteo corregido");
}

export async function soldOutAction(productId: string, soldOut: boolean) {
  const staff = await requireStaff();
  return safely(() => updateProduct(staff, productId, { soldOut }), soldOut ? "Marcado como agotado" : "Disponible otra vez");
}

export async function createDeliveryAction(input: { channel: string; customer: string; code?: string; rider?: string; phone?: string; address?: string; notes?: string }) {
  const staff = await requireStaff();
  return safely(() => createDelivery(staff, input));
}

export async function packDeliveryAction(checkId: string, checked: string[]) {
  const staff = await requireStaff();
  return safely(() => packDelivery(staff, checkId, checked), "Pedido empacado y revisado");
}

export async function dispatchDeliveryAction(checkId: string) {
  const staff = await requireStaff();
  return safely(() => dispatchDelivery(staff, checkId), "Entregado al domiciliario");
}

export async function cancelDeliveryAction(checkId: string, input: { reason: string; auth?: AuthInput | null }) {
  const staff = await requireStaff();
  return safely(() => cancelDelivery(staff, checkId, input), "Pedido cancelado");
}

