import "server-only";
import { checkTotals } from "../core/pricing";
import { audit, bump, getBusiness, type Business } from "./business";
import { checkLabel, loadCheck, moveStock, type Mod } from "./checks";
import { getDb } from "./db";
import { UserError } from "./errors";
import { loadMenu, priceItem, type ChosenItem } from "./menu";
import { allow } from "./rate-limit";
import type { Staff } from "./auth";

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
  const check = await db.one<{ id: string }>("select id from checks where table_id = $1 and status in ('open','bill') order by opened_at desc limit 1", [t.id]);
  return { ...t, checkId: check?.id ?? null, business: await getBusiness(t.business_id) };
}

/** La cuenta como la ve el cliente en su celular: sin datos internos. */
export async function clientCheck(qrToken: string) {
  const table = await tableByToken(qrToken);
  if (!table?.checkId) return null;
  const check = await loadCheck(table.business_id, table.checkId);
  if (!check) return null;
  const db = await getDb();
  const pending = await db.query<{ id: string; amount: number; tip: number; method: string; part: string; created_at: string }>(
    "select id, amount, tip, method, part, created_at from payments where check_id = $1 and status = 'pending' order by created_at",
    [check.id],
  );
  return {
    id: check.id,
    label: check.label,
    status: check.status,
    guests: check.guests,
    items: check.items
      .filter((i) => i.status !== "void" && i.status !== "draft")
      .map((i) => ({ id: i.id, name: i.name, qty: i.qty, modifiers: i.modifiers, unit: i.unit_price + i.modifiers.reduce((s, m) => s + m.price, 0), courtesy: i.courtesy, status: i.status })),
    totals: check.totals,
    paid: check.paid,
    due: check.due,
    pending,
  };
}

async function existingPending(tableId: string, kind: string) {
  const db = await getDb();
  return db.one("select 1 from requests where table_id = $1 and kind = $2 and status = 'pending'", [tableId, kind]);
}

export async function submitQrOrder(qrToken: string, items: ChosenItem[], guestName: string) {
  if (!(await allow("qr-order", 8, 10 * 60_000))) throw new UserError("Ya enviaste varios pedidos. Espera un momento o llama al mesero.");
  const table = await tableByToken(qrToken);
  if (!table) throw new UserError("Este QR no está activo");
  if (!table.business.settings.qr.enabled) throw new UserError("El pedido por QR está apagado en este momento");
  if (!items.length) throw new UserError("Agrega algo a tu pedido");
  const menu = await loadMenu(table.business_id);
  const lines = items.slice(0, 20).map((i) => {
    const line = priceItem(menu, i);
    if (line.product.soldOut) throw new UserError(`${line.product.name} se agotó`);
    return { productId: line.product.id, name: line.product.name, qty: line.qty, modifiers: line.modifiers, modifierIds: i.modifierIds ?? [], note: line.note, unit: line.product.price };
  });
  const db = await getDb();
  await db.tx(async (tx) => {
    await tx.query("insert into requests (business_id, table_id, check_id, kind, payload) values ($1, $2, $3, 'order', $4::jsonb)", [
      table.business_id,
      table.id,
      table.checkId,
      JSON.stringify({ items: lines, guestName: guestName.trim().slice(0, 40) }),
    ]);
    await bump(tx, table.business_id);
  });
  return { needsApproval: table.business.settings.qr.requireApproval };
}

export async function simpleQrRequest(qrToken: string, kind: "waiter" | "bill") {
  if (!(await allow(`qr-${kind}`, 6, 5 * 60_000))) throw new UserError("Ya avisamos. Alguien va para tu mesa.");
  const table = await tableByToken(qrToken);
  if (!table) throw new UserError("Este QR no está activo");
  if (await existingPending(table.id, kind)) return;
  const db = await getDb();
  await db.tx(async (tx) => {
    await tx.query("insert into requests (business_id, table_id, check_id, kind) values ($1, $2, $3, $4)", [table.business_id, table.id, table.checkId, kind]);
    await bump(tx, table.business_id);
  });
}

export async function reportClientPayment(qrToken: string, input: { method: string; amount: number; tip: number; reference: string; part: string }) {
  if (!(await allow("qr-pay", 6, 10 * 60_000))) throw new UserError("Demasiados intentos. Pide ayuda al mesero.");
  const table = await tableByToken(qrToken);
  if (!table?.checkId) throw new UserError("Tu mesa no tiene una cuenta abierta");
  if (!table.business.settings.qr.payAtTable) throw new UserError("El pago desde la mesa está apagado");
  if (!["nequi", "breb", "daviplata"].includes(input.method)) throw new UserError("Elige Nequi o Bre-B");
  const check = await loadCheck(table.business_id, table.checkId);
  if (!check) throw new UserError("Tu mesa no tiene una cuenta abierta");
  const amount = Math.round(input.amount);
  const pendingTotal = check.pendingPayments.reduce((s, p) => s + p.amount, 0);
  if (amount <= 0 || amount > check.due - pendingTotal) throw new UserError("Ese valor es mayor a lo que falta por pagar");
  const reference = input.reference.trim().slice(0, 40);
  if (reference.length < 4) throw new UserError("Escribe la referencia que te dio tu banco");
  const db = await getDb();
  await db.tx(async (tx) => {
    const p = await tx.one<{ id: string }>(
      "insert into payments (business_id, check_id, method, amount, tip, reference, part, status) values ($1, $2, $3, $4, $5, $6, $7, 'pending') returning id",
      [table.business_id, check.id, input.method, amount, Math.max(0, Math.round(input.tip)), reference, input.part.trim().slice(0, 30)],
    );
    await tx.query("insert into requests (business_id, table_id, check_id, kind, payload) values ($1, $2, $3, 'payment', $4::jsonb)", [
      table.business_id,
      table.id,
      check.id,
      JSON.stringify({ paymentId: p!.id, amount, tip: Math.max(0, Math.round(input.tip)), method: input.method, reference }),
    ]);
    await bump(tx, table.business_id);
  });
}

/** El mesero aprueba el pedido del QR: entra directo a barra y cocina como una ronda nueva. */
export async function approveRequest(staff: Staff, requestId: string) {
  const db = await getDb();
  const menu = await loadMenu(staff.business_id);
  return db.tx(async (tx) => {
    const req = await tx.one<{ id: string; kind: string; table_id: string | null; check_id: string | null; payload: { items?: { productId: string; qty: number; modifierIds?: string[]; note?: string }[] }; status: string }>(
      "select id, kind, table_id, check_id, payload, status from requests where id = $1 and business_id = $2 for update",
      [requestId, staff.business_id],
    );
    if (!req || req.status !== "pending") throw new UserError("Esa solicitud ya se atendió");
    let checkId = req.check_id;
    if (req.kind === "order") {
      if (!req.table_id) throw new UserError("Pedido sin mesa");
      const open = await tx.one<{ id: string; number: number }>("select id, number from checks where table_id = $1 and status in ('open','bill') limit 1", [req.table_id]);
      let number = open?.number ?? 0;
      if (open) checkId = open.id;
      else {
        const row = await tx.one<{ id: string; number: number }>("insert into checks (business_id, table_id, kind, guests, opened_by) values ($1, $2, 'mesa', 2, $3) returning id, number", [
          staff.business_id,
          req.table_id,
          staff.id,
        ]);
        checkId = row!.id;
        number = row!.number;
      }
      const round = await tx.one<{ r: number }>("select coalesce(max(round), 0) + 1 as r from check_items where check_id = $1", [checkId]);
      const sent: { product_id: string; qty: number }[] = [];
      for (const it of req.payload.items ?? []) {
        const line = priceItem(menu, { productId: it.productId, qty: it.qty, modifierIds: it.modifierIds, note: it.note });
        if (line.product.soldOut) throw new UserError(`${line.product.name} está agotado: recházalo o cámbialo con el cliente`);
        await tx.query(
          `insert into check_items (business_id, check_id, product_id, name, unit_price, qty, modifiers, note, station, tax_rate, status, round, source, added_by, sent_at)
           values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, 'sent', $11, 'qr', $12, now())`,
          [staff.business_id, checkId, line.product.id, line.product.name, line.product.price, line.qty, JSON.stringify(line.modifiers), line.note, line.product.station, line.product.taxRate, round!.r, staff.id],
        );
        sent.push({ product_id: line.product.id, qty: line.qty });
      }
      await moveStock(tx, staff.business_id, sent, -1, "venta", `Cuenta ${number}`, staff.id);
      await tx.query("update checks set updated_at = now() where id = $1", [checkId]);
    } else if (req.kind === "bill" && checkId) {
      await tx.query("update checks set status = 'bill', updated_at = now() where id = $1 and status = 'open'", [checkId]);
    } else if (req.kind === "payment") {
      throw new UserError("Revisa el pago desde la cuenta de la mesa");
    }
    await tx.query("update requests set status = 'done', handled_by = $2, handled_at = now(), check_id = coalesce(check_id, $3) where id = $1", [requestId, staff.id, checkId]);
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
