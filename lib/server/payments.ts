import "server-only";
import { stampsEarned } from "../core/pricing";
import { bogotaParts } from "../core/time";
import { cop } from "../money";
import { fakeCufe, token } from "../seed";
import { METHOD_LABEL } from "../settings";
import { normalizePhone } from "../utils";
import { can, requireAuth, verifyAuthorizer, type AuthInput, type Staff } from "./auth";
import { audit, bump, getBusiness, nextNumber, type Business } from "./business";
import { assertNotOverpaid, isClosed, loadCheck, promoteSplit } from "./checks";
import { getDb, type Tx } from "./db";
import { UserError } from "./errors";

const METHODS = ["efectivo", "nequi", "breb", "tarjeta", "daviplata"] as const;
export type Method = (typeof METHODS)[number];

/** Tope de cada entrada o salida de efectivo */
const CASH_MOVE_MAX = 5_000_000;

export async function currentCashSession(bizId: string, tx?: Pick<Tx, "one">) {
  const db = tx ?? (await getDb());
  return db.one<{ id: string; opened_at: string; opening: number; opened_by: string | null; opener: string | null }>(
    `select cs.id, cs.opened_at, cs.opening, cs.opened_by, s.name as opener
       from cash_sessions cs left join staff s on s.id = cs.opened_by
      where cs.business_id = $1 and cs.closed_at is null order by cs.opened_at desc limit 1`,
    [bizId],
  );
}

/** Bloquea la cuenta para esta transacción: dos tablets no cobran ni cierran la misma cuenta a la vez. */
async function lockCheck(tx: Tx, bizId: string, checkId: string) {
  const row = await tx.one("select id from checks where id = $1 and business_id = $2 for update", [checkId, bizId]);
  const check = row ? await loadCheck(bizId, checkId, tx) : null;
  if (!check) throw new UserError("Cuenta no encontrada");
  return check;
}

function checkReference(method: string, reference: string) {
  if ((method === "tarjeta" || method === "breb" || method === "nequi" || method === "daviplata") && reference.length < 4) {
    throw new UserError(method === "tarjeta" ? "Escribe el número de aprobación del datáfono" : "Escribe la referencia o los últimos dígitos del comprobante");
  }
}

export async function registerPayment(
  staff: Staff,
  checkId: string,
  input: { method: string; amount: number; tip: number; received?: number | null; reference?: string; part?: string; confirmTip?: boolean },
) {
  if (!can.charge(staff)) throw new UserError("Tu usuario no puede cobrar");
  const method = input.method as Method;
  if (!METHODS.includes(method)) throw new UserError("Elige cómo paga");
  const biz = await getBusiness(staff.business_id);
  if (!biz.settings.payments[method]) throw new UserError(`${METHOD_LABEL[method]} no está activo en este local`);
  const amount = Math.round(Number(input.amount) || 0);
  const tip = Math.max(0, Math.round(Number(input.tip) || 0));
  if (amount <= 0) throw new UserError("El valor debe ser mayor a cero");
  const db = await getDb();
  return db.tx(async (tx) => {
    const check = await lockCheck(tx, staff.business_id, checkId);
    if (isClosed(check.status)) throw new UserError("Esta cuenta ya está cerrada");
    if (check.items.some((i) => i.status === "draft")) throw new UserError("Hay productos sin enviar: envíalos o quítalos antes de cobrar");
    if (check.pendingPayments.length) throw new UserError("El cliente reportó un pago desde la mesa: confírmalo o recházalo antes de cobrar");
    if (amount > check.due) throw new UserError(`Solo falta pagar ${cop(check.due)}`);
    if (tip > Math.round(check.totals.total * 0.2) && !input.confirmTip) {
      throw new UserError(`La propina de ${cop(tip)} es más del 20 % de la cuenta. Confírmala con el cliente.`, { tipConfirm: "1" });
    }
    if (tip > Math.max(check.totals.total, 200_000)) throw new UserError("Revisa la propina: es mayor que la cuenta");
    const session = await currentCashSession(staff.business_id, tx);
    if (!session) throw new UserError("Abre la caja para cobrar: así cada pago queda en un cierre");
    let received: number | null = null;
    if (method === "efectivo") {
      received = Math.round(Number(input.received ?? amount + tip) || 0);
      if (received < amount + tip) throw new UserError("El efectivo recibido no alcanza");
      if (received > amount + tip + 1_000_000) throw new UserError("Revisa el efectivo recibido");
    }
    const reference = (input.reference ?? "").trim().slice(0, 40);
    checkReference(method, reference);
    await tx.query(
      `insert into payments (business_id, check_id, method, amount, tip, received, reference, part, created_by, cash_session_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [staff.business_id, checkId, method, amount, tip, received, reference, (input.part ?? "").slice(0, 30), staff.id, session.id],
    );
    await tx.query("update checks set status = 'bill', tip_answer = coalesce(tip_answer, $2), updated_at = now() where id = $1", [checkId, tip > 0 ? "si" : null]);
    await bump(tx, staff.business_id);
    return { change: received !== null ? received - amount - tip : 0, due: check.due - amount };
  });
}

/** Confirma (o rechaza) un pago que el cliente reportó desde el QR de la mesa. */
export async function reviewClientPayment(staff: Staff, paymentId: string, approve: boolean) {
  if (!can.charge(staff)) throw new UserError("Tu usuario no puede cobrar");
  const db = await getDb();
  await db.tx(async (tx) => {
    const p = await tx.one<{ id: string; check_id: string; amount: number; status: string }>("select id, check_id, amount, status from payments where id = $1 and business_id = $2 for update", [
      paymentId,
      staff.business_id,
    ]);
    if (!p || p.status !== "pending") throw new UserError("Ese pago ya se revisó");
    if (approve) {
      const check = await lockCheck(tx, staff.business_id, p.check_id);
      if (isClosed(check.status)) throw new UserError("Esa cuenta ya está cerrada");
      if (p.amount > check.due) throw new UserError("Ese pago supera lo que falta");
      const session = await currentCashSession(staff.business_id, tx);
      if (!session) throw new UserError("Abre la caja para confirmar el pago: así queda en un cierre");
      await tx.query("update payments set status = 'ok', created_by = $2, cash_session_id = $3 where id = $1", [paymentId, staff.id, session.id]);
      await tx.query("update checks set status = 'bill', updated_at = now() where id = $1 and status = 'open'", [p.check_id]);
    } else {
      await tx.query("update payments set status = 'rejected' where id = $1", [paymentId]);
    }
    await tx.query("update requests set status = 'done', handled_by = $2, handled_at = now() where kind = 'payment' and payload->>'paymentId' = $1", [paymentId, staff.id]);
    await bump(tx, staff.business_id);
  });
}

/** Quitar un pago lo deja marcado como quitado, con motivo y quién lo autorizó: sale en el panel del día. */
export async function removePayment(staff: Staff, paymentId: string, input: { reason: string; auth?: AuthInput | null }) {
  const reason = (input.reason ?? "").trim().slice(0, 120);
  if (reason.length < 3) throw new UserError("Escribe por qué se quita el pago");
  const authorizedBy = await verifyAuthorizer(staff, input.auth, "void");
  const db = await getDb();
  await db.tx(async (tx) => {
    const p = await tx.one<{ check_id: string; amount: number; tip: number; method: string; status: string; check_status: string; number: number; session_closed: string | null }>(
      `select p.check_id, p.amount, p.tip, p.method, p.status, c.status as check_status, c.number, cs.closed_at as session_closed
         from payments p join checks c on c.id = p.check_id left join cash_sessions cs on cs.id = p.cash_session_id
        where p.id = $1 and p.business_id = $2 for update of p`,
      [paymentId, staff.business_id],
    );
    if (!p || p.status !== "ok" || !["open", "bill"].includes(p.check_status)) throw new UserError("No se puede quitar ese pago");
    if (p.session_closed) throw new UserError("Ese pago es de una caja que ya se cerró");
    const who = requireAuth(!can.voidSent(staff), staff, authorizedBy, "void");
    await tx.query("update payments set status = 'removed', removed_by = $2, removed_at = now(), removed_reason = $3 where id = $1", [paymentId, staff.id, reason]);
    await audit(tx, staff.business_id, staff.id, "payment_removed", { method: p.method, check: p.number, reason, tip: p.tip, authorizedBy: who.name }, p.amount);
    await bump(tx, staff.business_id);
  });
}

export interface CloseInput {
  tipAnswer: "si" | "no";
  invoice: { kind: "consumidor" | "nit"; doc?: string; name?: string; email?: string };
  customer?: { phone: string; name?: string; consent: boolean; birthday?: string } | null;
}

/** Rango y vigencia de la resolución de facturación: fuera de ellos no se factura. */
function checkResolution(biz: Business, number: number, now: Date) {
  const inv = biz.settings.invoice;
  const today = bogotaParts(now).dayKey;
  if (inv.validTo && today > inv.validTo) throw new UserError(`La resolución de facturación venció el ${inv.validTo}. Actualízala en Ajustes con la nueva de la DIAN.`);
  if (inv.rangeTo && number > inv.rangeTo) throw new UserError(`Se acabó el rango de facturación autorizado (hasta el ${inv.rangeTo}). Pide una nueva resolución a la DIAN y actualízala en Ajustes.`);
}

/** Cierra la cuenta: emite la factura electrónica (simulada en la demo), suma sellos y libera la mesa. */
export async function closeCheck(staff: Staff, checkId: string, input: CloseInput) {
  if (!can.charge(staff)) throw new UserError("Tu usuario no puede cobrar");
  const biz = await getBusiness(staff.business_id);
  const db = await getDb();
  return db.tx((tx) => closeCheckTx(tx, staff, biz, checkId, input));
}

/** El cierre dentro de una transacción ya abierta (el despacho de domicilios lo usa junto con el pago). */
export async function closeCheckTx(tx: Tx, staff: Staff, biz: Business, checkId: string, input: CloseInput): Promise<{ invoiceId: string | null; stamps: number }> {
  const check = await lockCheck(tx, staff.business_id, checkId);
  if (isClosed(check.status)) throw new UserError("Esta cuenta ya está cerrada");
  if (check.items.some((i) => i.status === "draft")) throw new UserError("Hay productos sin enviar");
  if (!check.items.some((i) => i.status !== "void")) throw new UserError("La cuenta no tiene productos: descártala desde el menú de la cuenta");
  if (check.kind === "domicilio" && !check.delivery?.packedAt) throw new UserError("Empaca y revisa la bolsa antes de cerrar el domicilio");
  if (check.paid > check.totals.total) throw new UserError(`Se pagó de más: ${cop(check.paid - check.totals.total)}. Quita el pago sobrante antes de cerrar.`);
  if (check.due > 0) throw new UserError(`Faltan ${cop(check.due)} por pagar`);
  if (check.pendingPayments.length) throw new UserError("Hay un pago del cliente por confirmar");
  if (biz.settings.tips.enabled && check.totals.total > 0 && !input.tipAnswer) throw new UserError("Pregunta al cliente si incluye la propina");
  const nit = input.invoice?.kind === "nit";
  if (nit) {
    if (!input.invoice.doc || input.invoice.doc.replace(/\D/g, "").length < 6) throw new UserError("Escribe el NIT o la cédula para la factura");
    if (!input.invoice.name || input.invoice.name.trim().length < 3) throw new UserError("Escribe el nombre o la razón social");
  }

  // Cliente y sellos (con autorización de datos, Ley 1581)
  let customerId = check.customer_id;
  if (input.customer?.phone) {
    const phone = normalizePhone(input.customer.phone);
    if (phone.length !== 10) throw new UserError("Revisa el celular del cliente: son 10 números, sin el 57");
    if (!input.customer.consent) throw new UserError("El cliente debe autorizar el uso de sus datos para sumar sellos");
    const birthday = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(input.customer.birthday ?? "") ? input.customer.birthday! : null;
    const row = await tx.one<{ id: string }>(
      `insert into customers (business_id, phone, name, consent_at, birthday) values ($1, $2, $3, now(), $4)
       on conflict (business_id, phone) do update set name = case when customers.name = '' then excluded.name else customers.name end,
         consent_at = case when customers.consent_withdrawn_at is not null or customers.consent_at is null then now() else customers.consent_at end,
         consent_withdrawn_at = null, birthday = coalesce(customers.birthday, excluded.birthday)
       returning id`,
      [staff.business_id, phone, (input.customer.name ?? "").trim().slice(0, 60), birthday],
    );
    customerId = row!.id;
  }

  // Todo en cortesía: se cierra sin factura (no hay venta)
  let invoiceId: string | null = null;
  if (check.totals.total > 0) {
    const now = new Date();
    const number = await nextNumber(tx, staff.business_id, "invoice");
    checkResolution(biz, number, now);
    const doc = nit ? input.invoice.doc!.trim().slice(0, 20) : "222222222222";
    const inv = await tx.one<{ id: string }>(
      `insert into invoices (business_id, check_id, prefix, cufe, public_token, kind, customer_doc, customer_name, customer_email, subtotal, tax, tip, total, number)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id`,
      [
        staff.business_id,
        checkId,
        biz.settings.invoice.prefix,
        // CUFE simulado con la misma receta de la DIAN (SHA-384 de número, fecha, valores y documentos)
        fakeCufe([biz.settings.invoice.prefix, number, now.toISOString(), check.totals.base, check.totals.tax, check.totals.total, biz.settings.business.nit, doc]),
        token(`inv:${checkId}:${now.getTime()}`, 16),
        nit ? "nit" : "consumidor",
        doc,
        nit ? input.invoice.name!.trim().slice(0, 80) : "Consumidor final",
        input.invoice?.email?.trim().slice(0, 80) || null,
        check.totals.base,
        check.totals.tax,
        check.tips,
        check.totals.total + check.tips,
        number,
      ],
    );
    invoiceId = inv!.id;
  }

  await tx.query("update checks set status = 'paid', closed_at = now(), closed_by = $2, tip_answer = $3, customer_id = $4, updated_at = now() where id = $1", [
    checkId,
    staff.id,
    input.tipAnswer === "si" ? "si" : "no",
    customerId,
  ]);
  // Si era la cuenta principal de la mesa y quedan cuentas aparte, la más antigua pasa a ser la principal
  await promoteSplit(tx, checkId);
  // Lo listo se entregó; lo que aún se prepara sigue en barra y cocina hasta que salga
  await tx.query("update check_items set status = 'delivered', delivered_at = coalesce(delivered_at, now()) where check_id = $1 and status = 'ready'", [checkId]);
  await tx.query("update requests set status = 'done', handled_by = $2, handled_at = now() where check_id = $1 and status = 'pending'", [checkId, staff.id]);

  let stamps = 0;
  if (customerId && biz.settings.loyalty.enabled && check.totals.total > 0) {
    stamps = stampsEarned(check.totals.total, biz.settings.loyalty);
    await tx.query("update customers set stamps = stamps + $2, visits = visits + 1, total_spent = total_spent + $3, last_visit = now() where id = $1", [customerId, stamps, check.totals.total]);
    if (stamps) await tx.query("insert into loyalty_ledger (business_id, customer_id, delta, reason, check_id) values ($1, $2, $3, 'Visita', $4)", [staff.business_id, customerId, stamps, checkId]);
  }
  if (!invoiceId) await audit(tx, staff.business_id, staff.id, "closed_no_invoice", { check: check.number });
  await bump(tx, staff.business_id);
  return { invoiceId, stamps };
}

/** Canjea el premio de sellos: la bebida más cara que entre en el tope queda como cortesía. */
export async function redeemReward(staff: Staff, checkId: string) {
  const biz = await getBusiness(staff.business_id);
  const db = await getDb();
  await db.tx(async (tx) => {
    const check = await lockCheck(tx, staff.business_id, checkId);
    if (isClosed(check.status)) throw new UserError("Esta cuenta ya está cerrada");
    if (!check.customer) throw new UserError("Primero agrega el cliente a la cuenta");
    if (check.customer.stamps < biz.settings.loyalty.goal) throw new UserError(`Le faltan ${biz.settings.loyalty.goal - check.customer.stamps} sellos`);
    const eligible = check.items
      .filter((i) => i.status !== "void" && i.status !== "draft" && !i.courtesy && i.station === "barra" && i.unit_price <= biz.settings.loyalty.rewardMax)
      .sort((a, b) => b.unit_price - a.unit_price)[0];
    if (!eligible) throw new UserError(`No hay una bebida enviada de hasta ${cop(biz.settings.loyalty.rewardMax)} en la cuenta`);
    if (eligible.qty > 1) {
      await tx.query("update check_items set qty = qty - 1 where id = $1", [eligible.id]);
      await tx.query(
        `insert into check_items (business_id, check_id, product_id, name, unit_price, qty, modifiers, note, station, tax_rate, status, round, courtesy, added_by, sent_at, ready_at, delivered_at)
         select business_id, check_id, product_id, name, unit_price, 1, modifiers, 'Premio de sellos', station, tax_rate, status, round, true, $2, sent_at, ready_at, delivered_at from check_items where id = $1`,
        [eligible.id, staff.id],
      );
    } else {
      await tx.query("update check_items set courtesy = true, note = 'Premio de sellos' where id = $1", [eligible.id]);
    }
    await assertNotOverpaid(tx, staff.business_id, checkId);
    await tx.query("update customers set stamps = stamps - $2 where id = $1", [check.customer.id, biz.settings.loyalty.goal]);
    await tx.query("insert into loyalty_ledger (business_id, customer_id, delta, reason, check_id) values ($1, $2, $3, 'Premio canjeado', $4)", [
      staff.business_id,
      check.customer.id,
      -biz.settings.loyalty.goal,
      checkId,
    ]);
    await audit(tx, staff.business_id, staff.id, "reward", { item: eligible.name, customer: check.customer.name, check: check.number }, eligible.unit_price);
    await bump(tx, staff.business_id);
  });
}

export async function attachCustomer(staff: Staff, checkId: string, input: { phone: string; name?: string; consent: boolean; birthday?: string }) {
  const phone = normalizePhone(input.phone);
  if (phone.length !== 10) throw new UserError("Escribe un celular de 10 números, sin el 57");
  const birthday = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(input.birthday ?? "") ? input.birthday! : null;
  const db = await getDb();
  return db.tx(async (tx) => {
    const check = await lockCheck(tx, staff.business_id, checkId);
    if (isClosed(check.status)) throw new UserError("Esta cuenta ya está cerrada");
    const existing = await tx.one<{ id: string; consent_at: string | null; consent_withdrawn_at: string | null }>(
      "select id, consent_at, consent_withdrawn_at from customers where business_id = $1 and phone = $2",
      [staff.business_id, phone],
    );
    const hasConsent = !!existing?.consent_at && !existing.consent_withdrawn_at;
    if (!hasConsent && !input.consent) throw new UserError("El cliente debe autorizar el uso de sus datos");
    const row = existing
      ? existing
      : await tx.one<{ id: string }>("insert into customers (business_id, phone, name, consent_at, birthday) values ($1, $2, $3, now(), $4) returning id", [
          staff.business_id,
          phone,
          (input.name ?? "").trim().slice(0, 60),
          birthday,
        ]);
    if (existing) {
      if (!hasConsent) await tx.query("update customers set consent_at = now(), consent_withdrawn_at = null where id = $1", [existing.id]);
      if (birthday) await tx.query("update customers set birthday = coalesce(birthday, $2) where id = $1", [existing.id, birthday]);
      if (input.name?.trim()) await tx.query("update customers set name = case when name = '' then $2 else name end where id = $1", [existing.id, input.name.trim().slice(0, 60)]);
    }
    await tx.query("update checks set customer_id = $2, updated_at = now() where id = $1 and business_id = $3", [checkId, row!.id, staff.business_id]);
    await bump(tx, staff.business_id);
    return row!.id;
  });
}

/* ---------- Correcciones después de cerrar ---------- */

/** Corrige el método de un pago de una cuenta cerrada mientras su caja siga abierta (dueño o administración). */
export async function changePaymentMethod(staff: Staff, paymentId: string, input: { method: string; reference?: string; auth?: AuthInput | null }) {
  const method = input.method as Method;
  if (!METHODS.includes(method)) throw new UserError("Elige el método correcto");
  const biz = await getBusiness(staff.business_id);
  if (!biz.settings.payments[method]) throw new UserError(`${METHOD_LABEL[method]} no está activo en este local`);
  const reference = (input.reference ?? "").trim().slice(0, 40);
  checkReference(method, reference);
  const authorizedBy = await verifyAuthorizer(staff, input.auth, "manage");
  const db = await getDb();
  await db.tx(async (tx) => {
    const p = await tx.one<{ id: string; method: string; amount: number; tip: number; status: string; number: number; closed: string | null; session: string | null }>(
      `select p.id, p.method, p.amount, p.tip, p.status, c.number, cs.closed_at as closed, p.cash_session_id as session
         from payments p join checks c on c.id = p.check_id left join cash_sessions cs on cs.id = p.cash_session_id
        where p.id = $1 and p.business_id = $2 for update of p`,
      [paymentId, staff.business_id],
    );
    if (!p || p.status !== "ok") throw new UserError("Ese pago no se puede corregir");
    if (p.method === "plataforma") throw new UserError("Lo pagado en la plataforma no se cambia");
    if (!p.session || p.closed) throw new UserError("Ese pago es de una caja que ya se cerró: el cierre no se puede cambiar");
    if (p.method === method) throw new UserError("Ese ya es el método del pago");
    const who = requireAuth(!can.manage(staff), staff, authorizedBy, "manage");
    await tx.query("update payments set method = $2, reference = $3, received = case when $2 = 'efectivo' then amount + tip else null end where id = $1", [paymentId, method, reference]);
    await audit(tx, staff.business_id, staff.id, "payment_fixed", { check: p.number, from: p.method, to: method, authorizedBy: who.name }, p.amount);
    await bump(tx, staff.business_id);
  });
}

async function voidInvoiceTx(tx: Tx, staff: Staff, invoiceId: string, reason: string) {
  const credit = await nextNumber(tx, staff.business_id, "credit");
  await tx.query("update invoices set status = 'anulada', voided_at = now(), voided_by = $2, void_reason = $3, credit_note = $4 where id = $1", [invoiceId, staff.id, reason, credit]);
  return credit;
}

/** Refactura una cuenta cerrada con otros datos (por ejemplo, con NIT): anula la factura con nota crédito y emite una nueva. */
export async function reissueInvoice(staff: Staff, checkId: string, input: { invoice: CloseInput["invoice"]; auth?: AuthInput | null }) {
  const nit = input.invoice?.kind === "nit";
  if (nit) {
    if (!input.invoice.doc || input.invoice.doc.replace(/\D/g, "").length < 6) throw new UserError("Escribe el NIT o la cédula para la factura");
    if (!input.invoice.name || input.invoice.name.trim().length < 3) throw new UserError("Escribe el nombre o la razón social");
  }
  const biz = await getBusiness(staff.business_id);
  const authorizedBy = await verifyAuthorizer(staff, input.auth, "manage");
  const db = await getDb();
  return db.tx(async (tx) => {
    const inv = await tx.one<{ id: string; number: number; prefix: string; subtotal: number; tax: number; tip: number; total: number; check_status: string }>(
      `select v.id, v.number, v.prefix, v.subtotal, v.tax, v.tip, v.total, c.status as check_status from invoices v join checks c on c.id = v.check_id
        where v.check_id = $1 and v.business_id = $2 and v.voided_at is null for update of v`,
      [checkId, staff.business_id],
    );
    if (!inv || inv.check_status !== "paid") throw new UserError("Esa cuenta no tiene una factura vigente");
    const who = requireAuth(!can.manage(staff), staff, authorizedBy, "manage");
    const credit = await voidInvoiceTx(tx, staff, inv.id, "Refacturada con otros datos");
    const now = new Date();
    const number = await nextNumber(tx, staff.business_id, "invoice");
    checkResolution(biz, number, now);
    const doc = nit ? input.invoice.doc!.trim().slice(0, 20) : "222222222222";
    const row = await tx.one<{ id: string }>(
      `insert into invoices (business_id, check_id, prefix, cufe, public_token, kind, customer_doc, customer_name, customer_email, subtotal, tax, tip, total, number)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id`,
      [
        staff.business_id,
        checkId,
        biz.settings.invoice.prefix,
        fakeCufe([biz.settings.invoice.prefix, number, now.toISOString(), inv.subtotal, inv.tax, inv.total - inv.tip, biz.settings.business.nit, doc]),
        token(`inv:${checkId}:${now.getTime()}`, 16),
        nit ? "nit" : "consumidor",
        doc,
        nit ? input.invoice.name!.trim().slice(0, 80) : "Consumidor final",
        input.invoice?.email?.trim().slice(0, 80) || null,
        inv.subtotal,
        inv.tax,
        inv.tip,
        inv.total,
        number,
      ],
    );
    await audit(tx, staff.business_id, staff.id, "invoice_reissued", { from: `${inv.prefix}${inv.number}`, to: `${biz.settings.invoice.prefix}${number}`, creditNote: credit, authorizedBy: who.name }, inv.total);
    await bump(tx, staff.business_id);
    return row!.id;
  });
}

/** Anula una venta ya cerrada (devolución): nota crédito, pagos devueltos y sellos reversados. Solo con su caja abierta. */
export async function voidSale(staff: Staff, checkId: string, input: { reason: string; auth?: AuthInput | null }) {
  const reason = (input.reason ?? "").trim().slice(0, 120);
  if (reason.length < 3) throw new UserError("Escribe el motivo de la anulación");
  const authorizedBy = await verifyAuthorizer(staff, input.auth, "manage");
  const db = await getDb();
  await db.tx(async (tx) => {
    const check = await lockCheck(tx, staff.business_id, checkId);
    if (check.status !== "paid") throw new UserError("Solo se anulan ventas cerradas");
    const closedSession = await tx.one(
      "select 1 from payments p join cash_sessions cs on cs.id = p.cash_session_id where p.check_id = $1 and p.status = 'ok' and cs.closed_at is not null limit 1",
      [checkId],
    );
    if (closedSession) throw new UserError("Esa venta es de una caja que ya se cerró: no se puede anular desde aquí");
    const who = requireAuth(!can.manage(staff), staff, authorizedBy, "manage");
    const inv = await tx.one<{ id: string }>("select id from invoices where check_id = $1 and voided_at is null", [checkId]);
    const credit = inv ? await voidInvoiceTx(tx, staff, inv.id, reason) : null;
    await tx.query("update payments set status = 'removed', removed_by = $2, removed_at = now(), removed_reason = $3 where check_id = $1 and status = 'ok'", [checkId, staff.id, `Venta anulada: ${reason}`]);
    const stamps = await tx.query<{ customer_id: string; delta: number }>("select customer_id, delta from loyalty_ledger where check_id = $1 and delta > 0", [checkId]);
    for (const s of stamps) {
      await tx.query("update customers set stamps = greatest(0, stamps - $2), visits = greatest(0, visits - 1) where id = $1", [s.customer_id, s.delta]);
      await tx.query("insert into loyalty_ledger (business_id, customer_id, delta, reason, check_id) values ($1, $2, $3, 'Venta anulada', $4)", [staff.business_id, s.customer_id, -s.delta, checkId]);
    }
    await tx.query("update checks set status = 'void', updated_at = now() where id = $1", [checkId]);
    await audit(tx, staff.business_id, staff.id, "sale_voided", { check: check.number, reason, creditNote: credit, authorizedBy: who.name }, check.paid + check.tips);
    await bump(tx, staff.business_id);
  });
}

/* ---------- Caja ---------- */

export async function openCash(staff: Staff, opening: number) {
  if (!can.closeCash(staff)) throw new UserError("Solo caja o el encargado abren la caja");
  const amount = Math.round(Number(opening) || 0);
  if (amount < 0 || amount > CASH_MOVE_MAX) throw new UserError("Revisa la base de la caja");
  const db = await getDb();
  await db.tx(async (tx) => {
    if (await currentCashSession(staff.business_id, tx)) throw new UserError("Ya hay una caja abierta");
    await tx.query("insert into cash_sessions (business_id, opened_by, opening) values ($1, $2, $3)", [staff.business_id, staff.id, amount]);
    await audit(tx, staff.business_id, staff.id, "cash_open", {}, amount);
    await bump(tx, staff.business_id);
  });
}

/** Entradas y salidas de efectivo: solo caja, administración o dueño; los demás con la autorización de uno de ellos. */
export async function addCashMovement(staff: Staff, input: { kind: "in" | "out"; amount: number; reason: string; auth?: AuthInput | null }) {
  const kind = input.kind === "in" ? "in" : "out";
  const amount = Math.round(Number(input.amount) || 0);
  if (amount <= 0) throw new UserError("Escribe el valor");
  if (amount > CASH_MOVE_MAX) throw new UserError(`Cada movimiento es de máximo ${cop(CASH_MOVE_MAX)}`);
  const reason = (input.reason ?? "").trim().slice(0, 80);
  if (reason.length < 3) throw new UserError("Escribe el motivo");
  const authorizedBy = await verifyAuthorizer(staff, input.auth, "void");
  const db = await getDb();
  await db.tx(async (tx) => {
    const session = await tx.one<{ id: string }>("select id from cash_sessions where business_id = $1 and closed_at is null for update", [staff.business_id]);
    if (!session) throw new UserError("Abre la caja primero");
    const who = requireAuth(!can.closeCash(staff), staff, authorizedBy, "void");
    if (kind === "out") {
      const summary = await cashSummary(staff.business_id, session.id, tx);
      if (summary && amount > summary.expected) throw new UserError("Ese valor es más de lo que debería haber en el cajón");
    }
    await tx.query("insert into cash_movements (business_id, session_id, kind, amount, reason, staff_id) values ($1, $2, $3, $4, $5, $6)", [
      staff.business_id,
      session.id,
      kind,
      amount,
      reason,
      staff.id,
    ]);
    await audit(tx, staff.business_id, staff.id, kind === "in" ? "cash_in" : "cash_out", { reason, authorizedBy: who.name }, amount);
    await bump(tx, staff.business_id);
  });
}

export async function cashSummary(bizId: string, sessionId: string, tx?: Tx) {
  const db = tx ?? (await getDb());
  const session = await db.one<{
    id: string;
    opened_at: string;
    opening: number;
    closed_at: string | null;
    counted: number | null;
    expected: number | null;
    difference: number | null;
    opener: string | null;
    closer: string | null;
  }>(
    `select cs.id, cs.opened_at, cs.opening, cs.closed_at, cs.counted, cs.expected, cs.difference, o.name as opener, c.name as closer
       from cash_sessions cs left join staff o on o.id = cs.opened_by left join staff c on c.id = cs.closed_by
      where cs.id = $1 and cs.business_id = $2`,
    [sessionId, bizId],
  );
  if (!session) return null;
  const byMethod = await db.query<{ method: string; amount: number; tip: number; n: number; received: number }>(
    `select method, sum(amount)::int as amount, sum(tip)::int as tip, count(*)::int as n, coalesce(sum(received), 0)::int as received
       from payments where cash_session_id = $1 and status = 'ok' group by method order by method`,
    [sessionId],
  );
  const moves = await db.query<{ id: string; kind: string; amount: number; reason: string; created_at: string; staff: string | null }>(
    "select m.id, m.kind, m.amount, m.reason, m.created_at, s.name as staff from cash_movements m left join staff s on s.id = m.staff_id where m.session_id = $1 order by m.created_at",
    [sessionId],
  );
  const openChecks = await db.one<{ n: number }>("select count(*)::int as n from checks where business_id = $1 and status in ('open','bill')", [bizId]);
  const removed = await db.one<{ n: number; amount: number }>(
    "select count(*)::int as n, coalesce(sum(amount), 0)::int as amount from payments where cash_session_id = $1 and status = 'removed'",
    [sessionId],
  );
  const cash = byMethod.find((m) => m.method === "efectivo");
  const ins = moves.filter((m) => m.kind === "in").reduce((s, m) => s + m.amount, 0);
  const outs = moves.filter((m) => m.kind === "out").reduce((s, m) => s + m.amount, 0);
  // En el cajón queda la base, lo cobrado en efectivo (con su propina) y los movimientos
  const expected = session.opening + (cash ? cash.amount + cash.tip : 0) + ins - outs;
  const sales = byMethod.reduce((s, m) => s + m.amount, 0);
  const tips = byMethod.reduce((s, m) => s + m.tip, 0);
  return {
    session,
    byMethod,
    moves,
    ins,
    outs,
    expected,
    sales,
    tips,
    cashPayments: cash?.n ?? 0,
    openChecks: openChecks?.n ?? 0,
    removed: removed ?? { n: 0, amount: 0 },
    payments: byMethod.reduce((s, m) => s + m.n, 0),
  };
}

/** Cierre con arqueo a ciegas: quien no ve el esperado tampoco ve la diferencia; el dueño sí. */
export async function closeCash(staff: Staff, input: { counted: number; note: string; confirm: boolean }) {
  if (!can.closeCash(staff)) throw new UserError("Solo caja o el encargado cierran la caja");
  if (!input.confirm) throw new UserError("Confirma el cierre de caja");
  const counted = Math.max(0, Math.round(Number(input.counted) || 0));
  if (counted > 100_000_000) throw new UserError("Revisa el conteo");
  const db = await getDb();
  return db.tx(async (tx) => {
    const session = await tx.one<{ id: string }>("select id from cash_sessions where business_id = $1 and closed_at is null for update", [staff.business_id]);
    if (!session) throw new UserError("No hay caja abierta");
    const summary = await cashSummary(staff.business_id, session.id, tx);
    if (!summary) throw new UserError("No hay caja abierta");
    const difference = counted - summary.expected;
    await tx.query("update cash_sessions set closed_at = now(), closed_by = $2, counted = $3, expected = $4, difference = $5, note = $6 where id = $1", [
      session.id,
      staff.id,
      counted,
      summary.expected,
      difference,
      (input.note ?? "").trim().slice(0, 200),
    ]);
    await audit(tx, staff.business_id, staff.id, "cash_close", { expected: summary.expected, counted, openChecks: summary.openChecks }, difference);
    await bump(tx, staff.business_id);
    return { sessionId: session.id, difference: can.seeExpected(staff) ? difference : null };
  });
}

/** El dueño o la administración corrigen el conteo de un cierre reciente (por ejemplo, un billete que no se contó), con registro. */
export async function fixCashCount(staff: Staff, sessionId: string, input: { counted: number; note: string }) {
  if (!can.manage(staff)) throw new UserError("Solo el dueño o el administrador corrigen un cierre");
  const counted = Math.max(0, Math.round(Number(input.counted) || 0));
  const note = (input.note ?? "").trim().slice(0, 200);
  if (note.length < 3) throw new UserError("Escribe por qué se corrige el conteo");
  const db = await getDb();
  await db.tx(async (tx) => {
    const s = await tx.one<{ id: string; counted: number; expected: number }>(
      "select id, counted, expected from cash_sessions where id = $1 and business_id = $2 and closed_at > now() - interval '7 days' for update",
      [sessionId, staff.business_id],
    );
    if (!s) throw new UserError("Solo se corrigen cierres de los últimos 7 días");
    await tx.query("update cash_sessions set counted = $2, difference = $2 - expected, note = trim(note || ' · Corregido: ' || $3) where id = $1", [s.id, counted, note]);
    await audit(tx, staff.business_id, staff.id, "cash_fix", { from: s.counted, to: counted, note }, counted - s.expected);
    await bump(tx, staff.business_id);
  });
}

export async function lastClosedSessions(bizId: string, limit = 5) {
  const db = await getDb();
  return db.query<{ id: string; opened_at: string; closed_at: string; expected: number; counted: number; difference: number; closer: string | null }>(
    `select cs.id, cs.opened_at, cs.closed_at, cs.expected, cs.counted, cs.difference, s.name as closer from cash_sessions cs
       left join staff s on s.id = cs.closed_by where cs.business_id = $1 and cs.closed_at is not null order by cs.closed_at desc limit $2`,
    [bizId, limit],
  );
}
