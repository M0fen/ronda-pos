"use server";

import { revalidatePath } from "next/cache";
import { getStaff, renewSession, requireStaff, verifyPin, type AuthInput } from "@/lib/server/auth";
import { readPulse } from "@/lib/server/business";
import {
  addItems,
  changeDraft,
  changeWaiter,
  discardCheck,
  kdsAckVoids,
  kdsBumpTicket,
  kdsDetail,
  kdsSetItem,
  markDelivered,
  mergeChecks,
  moveItems,
  openCheck,
  repeatRound,
  sendRound,
  setBillRequested,
  setDiscount,
  toggleCourtesy,
  updateCheckMeta,
  voidItem,
  type DraftPatch,
  type MoveTarget,
} from "@/lib/server/checks";
import { noteScreen } from "@/lib/server/db";
import { UserError } from "@/lib/server/errors";
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
  payAndClose,
  redeemReward,
  registerPayment,
  reissueInvoice,
  removePayment,
  reviewClientPayment,
  voidSale,
  type CloseInput,
  type PaymentInput,
} from "@/lib/server/payments";
import { approveRequest, rejectRequest } from "@/lib/server/qr";
import { cancelDelivery, createDelivery, dispatchDelivery, packDelivery } from "@/lib/server/delivery";

/** Versión del local: si cambia, las pantallas se refrescan. -1: la sesión terminó. De paso renueva la sesión mientras se usa. */
export async function pulseAction() {
  const staff = await getStaff();
  if (!staff) return -1;
  // Una pantalla abierta con sesión cuenta como uso: la demo en memoria no se resiembra a mitad de una presentación
  noteScreen();
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

export async function changeDraftAction(itemId: string, patch: DraftPatch) {
  const staff = await requireStaff();
  return safely(() => changeDraft(staff, itemId, patch));
}

/** Envía lo nuevo; con held, solo lo retenido. */
export async function sendRoundAction(checkId: string, held = false) {
  const staff = await requireStaff();
  return safely(() => sendRound(staff, checkId, { held }));
}

export async function repeatRoundAction(checkId: string, round: number) {
  const staff = await requireStaff();
  return safely(() => repeatRound(staff, checkId, round));
}

export async function moveItemsAction(checkId: string, input: { items: { id: string; qty: number }[]; to: MoveTarget }) {
  const staff = await requireStaff();
  return safely(() => moveItems(staff, checkId, input));
}

export async function mergeChecksAction(intoId: string, fromId: string) {
  const staff = await requireStaff();
  return safely(() => mergeChecks(staff, intoId, fromId), "Cuentas unidas");
}

export async function changeWaiterAction(checkId: string, input: { staffId: string; auth?: AuthInput | null }) {
  const staff = await requireStaff();
  return safely(() => changeWaiter(staff, checkId, input), "Cuenta pasada");
}

export async function voidItemAction(itemId: string, input: { reason: string; waste: boolean; auth?: AuthInput | null }) {
  const staff = await requireStaff();
  return safely(() => voidItem(staff, itemId, input));
}

export async function courtesyAction(itemId: string, input: { reason?: string; auth?: AuthInput | null }) {
  const staff = await requireStaff();
  return safely(() => toggleCourtesy(staff, itemId, input), "Listo");
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

/** Registra un pago. Con `attemptKey`, el mismo intento reenviado (la respuesta se perdió) no se cobra dos veces. */
export async function paymentAction(checkId: string, input: PaymentInput) {
  const staff = await requireStaff();
  return safely(() => registerPayment(staff, checkId, input));
}

/** «Efectivo exacto y cerrar»: el pago y el cierre en un solo paso y una sola transacción. */
export async function payAndCloseAction(checkId: string, input: { payment: PaymentInput; close: CloseInput }) {
  const staff = await requireStaff();
  const result = await safely(() => payAndClose(staff, checkId, input));
  if (result.ok) revalidatePath("/salon");
  return result;
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

export async function kdsAckVoidsAction(itemIds: string[]) {
  const staff = await requireStaff();
  return safely(() => kdsAckVoids(staff, itemIds));
}

/** Todo lo de una cuenta para barra y cocina (la hoja que se abre al tocar un tiquete). */
export async function kdsDetailAction(checkId: string) {
  const staff = await requireStaff();
  return safely(async () => {
    const detail = await kdsDetail(staff.business_id, checkId);
    if (!detail) throw new UserError("Esa cuenta ya no está");
    return detail;
  });
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

