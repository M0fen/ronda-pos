import "server-only";
import { checkTotals } from "../core/pricing";
import { audit, bump, getBusiness, type Business, nextNumber } from "./business";
import { checkLabel, loadCheck, moveStock, totalsFor, type Mod } from "./checks";
import { getDb } from "./db";
import { UserError } from "./errors";
import { loadMenu, priceItem, type ChosenItem, type Menu } from "./menu";
import { allow } from "./rate-limit";
import type { Staff } from "./auth";
import type { Tx } from "./db";

export interface QrTable {
  id: string;
  name: string;
  business_id: string;
  qr_token: string;
  checkId: string | null;
}

export async function tableByToken(qrToken: string): Promise<(QrTable & { business: Business }) | null> {
  const db = await getDb();
  const t = await db.one<Omit<QrTable, "checkId">>("select id, name, business_id, qr_token from floor_tables where qr_token = $1 and active", [qrToken]);
  if (!t) return null;
  const check = await db.one<{ id: string }>("select id from checks where table_id = $1 and status in ('open','bill') and split_of is null order by opened_at desc limit 1", [t.id]);
  return { ...t, checkId: check?.id ?? null, business: await getBusiness(t.business_id) };
}

/** La cuenta como la ve el cliente en su celular: sin datos internos y sin lo que el mesero aún no envía. */
export async function clientCheck(qrToken: string) {
  const table = await tableByToken(qrToken);
  if (!table?.checkId) return null;
  const check = await loadCheck(table.business_id, table.checkId);
  if (!check) return null;
  const db = await getDb();
  const payments = await db.query<{ id: string; amount: number; tip: number; method: string; part: string; status: string; created_at: string }>(
    "select id, amount, tip, method, part, status, created_at from payments where check_id = $1 and status in ('ok','pending') order by created_at",
    [check.id],
  );
  const sent = check.items.filter((i) => i.status !== "void" && i.status !== "draft");
  const totals = totalsFor(sent, check.discount_pct);
  const paid = payments.filter((p) => p.status === "ok").reduce((s, p) => s + p.amount, 0);
  return {
    id: check.id,
    label: check.label,
    status: check.status,
    guests: check.guests,
    items: sent.map((i) => ({ id: i.id, name: i.name, qty: i.qty, modifiers: i.modifiers, unit: i.unit_price + i.modifiers.reduce((s, m) => s + m.price, 0), courtesy: i.courtesy, status: i.status })),
    totals,
    paid,
    due: Math.max(0, totals.total - paid),
    pending: payments.filter((p) => p.status === "pending"),
    /** Partes ya pagadas o por confirmar ("Parte 2 de 3"): el cliente no paga dos veces la misma */
    parts: payments.filter((p) => p.part).map((p) => ({ part: p.part, status: p.status })),
  };
}

async function existingPending(tableId: string, kind: string) {
  const db = await getDb();
  return db.one("select 1 from requests where table_id = $1 and kind = $2 and status = 'pending'", [tableId, kind]);
}

export async function submitQrOrder(qrToken: string, items: ChosenItem[], guestName: string) {
  const table = await tableByToken(qrToken);
  if (!table) throw new UserError("Este QR no está activo");
  // El límite va por mesa (los clientes del wifi del local comparten dirección) y uno alto por dirección
  if (!(await allow(`qr-order:${table.id}`, 8, 10 * 60_000))) throw new UserError("Ya enviaron varios pedidos desde esta mesa. Espera un momento o llama al mesero.");
  if (!(await allow("qr-order-ip", 80, 10 * 60_000))) throw new UserError("Hay demasiados pedidos desde esta red. Llama al mesero.");
  if (!table.business.settings.qr.enabled) throw new UserError("El pedido por QR está apagado en este momento");
  if (!items.length) throw new UserError("Agrega algo a tu pedido");
  const menu = await loadMenu(table.business_id);
  const lines = items.slice(0, 20).map((i) => {
    if (!menu.products.some((p) => p.id === i.productId)) throw new UserError("Algo de tu pedido ya no está en la carta: lo quitamos, revisa y vuelve a enviarlo.", { missing: String(i.productId) });
    const line = priceItem(menu, i);
    if (line.product.soldOut) throw new UserError(`${line.product.name} se agotó: quítalo y vuelve a enviar`, { missing: line.product.id });
    return { productId: line.product.id, name: line.product.name, qty: line.qty, modifiers: line.modifiers, modifierIds: i.modifierIds ?? [], note: line.note, unit: line.product.price };
  });
  const db = await getDb();
  const approval = table.business.settings.qr.requireApproval;
  await db.tx(async (tx) => {
    const req = await tx.one<{ id: string }>("insert into requests (business_id, table_id, check_id, kind, payload) values ($1, $2, $3, 'order', $4::jsonb) returning id", [
      table.business_id,
      table.id,
      table.checkId,
      JSON.stringify({ items: lines, guestName: guestName.trim().slice(0, 40) }),
    ]);
    // Sin aprobación del mesero, el pedido entra de una a barra y cocina
    if (!approval) await acceptRequest(tx, table.business_id, req!.id, null, menu);
    await bump(tx, table.business_id);
  });
  return { needsApproval: approval };
}

export async function simpleQrRequest(qrToken: string, kind: "waiter" | "bill") {
  const table = await tableByToken(qrToken);
  if (!table) throw new UserError("Este QR no está activo");
  if (kind === "bill" && !table.checkId) throw new UserError("Tu mesa todavía no tiene una cuenta abierta. Si necesitas algo, llama al mesero.");
  if (await existingPending(table.id, kind)) return;
  if (!(await allow(`qr-${kind}:${table.id}`, 6, 5 * 60_000))) throw new UserError("Ya avisamos hace un momento. Alguien va para tu mesa.");
  if (!(await allow("qr-call-ip", 80, 5 * 60_000))) throw new UserError("Hay demasiadas solicitudes desde esta red. Llama al mesero.");
  const db = await getDb();
  await db.tx(async (tx) => {
    await tx.query("insert into requests (business_id, table_id, check_id, kind) values ($1, $2, $3, $4)", [table.business_id, table.id, table.checkId, kind]);
    await bump(tx, table.business_id);
  });
}

export async function reportClientPayment(qrToken: string, input: { method: string; amount: number; tip: number; reference: string; part: string }) {
  const table = await tableByToken(qrToken);
  if (!table?.checkId) throw new UserError("Tu mesa no tiene una cuenta abierta");
  if (!(await allow(`qr-pay:${table.id}`, 8, 10 * 60_000))) throw new UserError("Demasiados intentos. Pide ayuda al mesero.");
  if (!table.business.settings.qr.payAtTable) throw new UserError("El pago desde la mesa está apagado");
  if (!["nequi", "breb", "daviplata"].includes(input.method)) throw new UserError("Elige Nequi o Bre-B");
  const check = await loadCheck(table.business_id, table.checkId);
  if (!check) throw new UserError("Tu mesa no tiene una cuenta abierta");
  const amount = Math.round(Number(input.amount) || 0);
  const tip = Math.max(0, Math.round(Number(input.tip) || 0));
  const pendingTotal = check.pendingPayments.reduce((s, p) => s + p.amount, 0);
  if (check.items.some((i) => i.status === "draft")) throw new UserError("El mesero está agregando algo a tu cuenta: espera un momento");
  if (amount <= 0 || amount > check.due - pendingTotal) throw new UserError("Ese valor es mayor a lo que falta por pagar");
  // La propina es voluntaria y tiene tope: el mismo del cobro en la caja
  if (tip > Math.round(check.totals.total * 0.2)) throw new UserError("La propina no puede pasar del 20 % de la cuenta");
  const reference = input.reference.trim().slice(0, 40);
  if (reference.length < 4) throw new UserError("Escribe la referencia que te dio tu banco");
  const db = await getDb();
  await db.tx(async (tx) => {
    const p = await tx.one<{ id: string }>(
      "insert into payments (business_id, check_id, method, amount, tip, reference, part, status) values ($1, $2, $3, $4, $5, $6, $7, 'pending') returning id",
      [table.business_id, check.id, input.method, amount, tip, reference, String(input.part ?? "").trim().slice(0, 30)],
    );
    await tx.query("insert into requests (business_id, table_id, check_id, kind, payload) values ($1, $2, $3, 'payment', $4::jsonb)", [
      table.business_id,
      table.id,
      check.id,
      JSON.stringify({ paymentId: p!.id, amount, tip, method: input.method, reference }),
    ]);
    await bump(tx, table.business_id);
  });
}

/**
 * Pedido del QR que entra a barra y cocina como una ronda nueva. Lo usa el mesero al aprobarlo, o el sistema
 * cuando el local no pide aprobación (actor null). Se cobra el precio que el cliente vio al pedir.
 */
async function acceptRequest(tx: Tx, bizId: string, requestId: string, actor: Staff | null, menu: Menu) {
  const req = await tx.one<{
    id: string;
    kind: string;
    table_id: string | null;
    check_id: string | null;
    payload: { items?: { productId: string; qty: number; modifierIds?: string[]; note?: string; unit?: number }[] };
    status: string;
  }>("select id, kind, table_id, check_id, payload, status from requests where id = $1 and business_id = $2 for update", [requestId, bizId]);
  if (!req || req.status !== "pending") throw new UserError("Esa solicitud ya se atendió");
  let checkId = req.check_id;
  if (req.kind === "order") {
    if (!req.table_id) throw new UserError("Pedido sin mesa");
    const table = await tx.one("select id from floor_tables where id = $1 and business_id = $2 for update", [req.table_id, bizId]);
    if (!table) throw new UserError("Esa mesa ya no está");
    const open = await tx.one<{ id: string; number: number }>("select id, number from checks where table_id = $1 and status in ('open','bill') and split_of is null limit 1", [req.table_id]);
    let number = open?.number ?? 0;
    if (open) checkId = open.id;
    else {
      const row = await tx.one<{ id: string; number: number }>(
        "insert into checks (business_id, number, table_id, kind, guests, opened_by) values ($1, $2, $3, 'mesa', 2, $4) returning id, number",
        [bizId, await nextNumber(tx, bizId, "check"), req.table_id, actor?.id ?? null],
      );
      checkId = row!.id;
      number = row!.number;
    }
    const round = await tx.one<{ r: number }>("select coalesce(max(round), 0) + 1 as r from check_items where check_id = $1", [checkId]);
    const sent: { product_id: string; qty: number }[] = [];
    for (const it of req.payload.items ?? []) {
      if (!menu.products.some((p) => p.id === it.productId)) throw new UserError("Uno de los productos ya no está en la carta: rechaza el pedido y tómalo de nuevo");
      const line = priceItem(menu, { productId: it.productId, qty: it.qty, modifierIds: it.modifierIds, note: it.note });
      if (line.product.soldOut) throw new UserError(`${line.product.name} está agotado: recházalo o cámbialo con el cliente`);
      const seen = Number(it.unit);
      const unit = Number.isFinite(seen) && seen >= 0 && seen <= 5_000_000 ? Math.round(seen) : line.product.price;
      await tx.query(
        `insert into check_items (business_id, check_id, product_id, name, unit_price, qty, modifiers, note, station, tax_rate, status, round, source, added_by, sent_at)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, 'sent', $11, 'qr', $12, now())`,
        [bizId, checkId, line.product.id, line.product.name, unit, line.qty, JSON.stringify(line.modifiers), line.note, line.product.station, line.product.taxRate, round!.r, actor?.id ?? null],
      );
      sent.push({ product_id: line.product.id, qty: line.qty });
    }
    await moveStock(tx, bizId, sent, -1, "venta", `Cuenta ${number}`, actor?.id ?? null);
    // Una ronda nueva quita la pre-cuenta: la mesa sigue pidiendo
    await tx.query("update checks set status = 'open', updated_at = now() where id = $1", [checkId]);
  } else if (req.kind === "bill" && checkId) {
    await tx.query("update checks set status = 'bill', updated_at = now() where id = $1 and status = 'open'", [checkId]);
  } else if (req.kind === "payment") {
    throw new UserError("Revisa el pago desde la cuenta de la mesa");
  }
  await tx.query("update requests set status = 'done', handled_by = $2, handled_at = now(), check_id = coalesce(check_id, $3) where id = $1", [requestId, actor?.id ?? null, checkId]);
  return checkId;
}

/** El mesero aprueba el pedido del QR: entra directo a barra y cocina como una ronda nueva. */
export async function approveRequest(staff: Staff, requestId: string) {
  // La carta se carga antes: dentro de la transacción solo se usa tx (PGlite tiene una sola conexión)
  const menu = await loadMenu(staff.business_id);
  const db = await getDb();
  return db.tx(async (tx) => {
    const checkId = await acceptRequest(tx, staff.business_id, requestId, staff, menu);
    await bump(tx, staff.business_id);
    return checkId;
  });
}

export async function rejectRequest(staff: Staff, requestId: string) {
  const db = await getDb();
  await db.tx(async (tx) => {
    const req = await tx.one<{ kind: string; status: string }>("select kind, status from requests where id = $1 and business_id = $2", [requestId, staff.business_id]);
    if (!req || req.status !== "pending") throw new UserError("Esa solicitud ya se atendió");
    await tx.query("update requests set status = 'rejected', handled_by = $2, handled_at = now() where id = $1", [requestId, staff.id]);
    if (req.kind === "order") await audit(tx, staff.business_id, staff.id, "qr_rejected", {});
    await bump(tx, staff.business_id);
  });
}

export function qrOrderTotal(items: { unit: number; qty: number; modifiers: Mod[] }[]) {
  return checkTotals(items.map((i) => ({ unitPrice: i.unit, qty: i.qty, modifiers: i.modifiers, taxRate: 0 }))).total;
}

export { checkLabel };
