import "server-only";
import { stampsEarned } from "../core/pricing";
import { fakeCufe, token } from "../seed";
import { METHOD_LABEL } from "../settings";
import { normalizePhone } from "../utils";
import { can, type Staff } from "./auth";
import { audit, bump, getBusiness } from "./business";
import { loadCheck } from "./checks";
import { getDb, type Tx } from "./db";
import { UserError } from "./errors";

const METHODS = ["efectivo", "nequi", "breb", "tarjeta", "daviplata"] as const;
export type Method = (typeof METHODS)[number];

export async function currentCashSession(bizId: string, tx?: Tx) {
  const db = tx ?? (await getDb());
  return db.one<{ id: string; opened_at: string; opening: number; opened_by: string | null; opener: string | null }>(
    `select cs.id, cs.opened_at, cs.opening, cs.opened_by, s.name as opener
       from cash_sessions cs left join staff s on s.id = cs.opened_by
      where cs.business_id = $1 and cs.closed_at is null order by cs.opened_at desc limit 1`,
    [bizId],
  );
}

export async function registerPayment(
  staff: Staff,
  checkId: string,
  input: { method: string; amount: number; tip: number; received?: number | null; reference?: string; part?: string },
) {
  if (!can.charge(staff)) throw new UserError("Tu usuario no puede cobrar");
  const method = input.method as Method;
  if (!METHODS.includes(method)) throw new UserError("Elige cómo paga");
  const biz = await getBusiness(staff.business_id);
  if (!biz.settings.payments[method]) throw new UserError(`${METHOD_LABEL[method]} no está activo en este local`);
  const amount = Math.round(input.amount);
  const tip = Math.max(0, Math.round(input.tip || 0));
  if (amount <= 0) throw new UserError("El valor debe ser mayor a cero");
  const db = await getDb();
  return db.tx(async (tx) => {
    const check = await loadCheck(staff.business_id, checkId, tx);
    if (!check) throw new UserError("Cuenta no encontrada");
    if (check.status === "paid" || check.status === "void") throw new UserError("Esta cuenta ya está cerrada");
    if (check.items.some((i) => i.status === "draft")) throw new UserError("Hay productos sin enviar: envíalos o quítalos antes de cobrar");
    if (amount > check.due) throw new UserError(`Solo falta pagar $${check.due.toLocaleString("es-CO")}`);
    if (tip > Math.round(check.totals.total * 0.2)) throw new UserError("Revisa la propina: es más del 20 % de la cuenta");
    const session = await currentCashSession(staff.business_id, tx);
    if (method === "efectivo" && !session) throw new UserError("Abre la caja para recibir efectivo");
    let received: number | null = null;
    if (method === "efectivo") {
      received = Math.round(input.received ?? amount + tip);
      if (received < amount + tip) throw new UserError("El efectivo recibido no alcanza");
    }
    const reference = (input.reference ?? "").trim().slice(0, 40);
    if ((method === "tarjeta" || method === "breb" || method === "nequi" || method === "daviplata") && reference.length < 4) {
      throw new UserError(method === "tarjeta" ? "Escribe el número de aprobación del datáfono" : "Escribe la referencia o los últimos dígitos del comprobante");
    }
    await tx.query(
      `insert into payments (business_id, check_id, method, amount, tip, received, reference, part, created_by, cash_session_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [staff.business_id, checkId, method, amount, tip, received, reference, (input.part ?? "").slice(0, 30), staff.id, session?.id ?? null],
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
    const p = await tx.one<{ id: string; check_id: string; amount: number; status: string }>("select id, check_id, amount, status from payments where id = $1 and business_id = $2", [
      paymentId,
      staff.business_id,
    ]);
    if (!p || p.status !== "pending") throw new UserError("Ese pago ya se revisó");
    if (approve) {
      const check = await loadCheck(staff.business_id, p.check_id, tx);
      if (!check || p.amount > check.due) throw new UserError("Ese pago supera lo que falta");
      const session = await currentCashSession(staff.business_id, tx);
      await tx.query("update payments set status = 'ok', created_by = $2, cash_session_id = $3 where id = $1", [paymentId, staff.id, session?.id ?? null]);
    } else {
      await tx.query("update payments set status = 'rejected' where id = $1", [paymentId]);
    }
    await tx.query("update requests set status = 'done', handled_by = $2, handled_at = now() where kind = 'payment' and payload->>'paymentId' = $1", [paymentId, staff.id]);
    await bump(tx, staff.business_id);
  });
}

export async function removePayment(staff: Staff, paymentId: string) {
  if (!can.voidSent(staff)) throw new UserError("Pide al cajero o al encargado que quite el pago");
  const db = await getDb();
  await db.tx(async (tx) => {
    const p = await tx.one<{ check_id: string; amount: number; method: string }>(
      "select p.check_id, p.amount, p.method from payments p join checks c on c.id = p.check_id where p.id = $1 and p.business_id = $2 and c.status in ('open','bill')",
      [paymentId, staff.business_id],
    );
    if (!p) throw new UserError("No se puede quitar ese pago");
    await tx.query("delete from payments where id = $1", [paymentId]);
    await audit(tx, staff.business_id, staff.id, "payment_removed", { method: p.method }, p.amount);
    await bump(tx, staff.business_id);
  });
}

export interface CloseInput {
  tipAnswer: "si" | "no";
  invoice: { kind: "consumidor" | "nit"; doc?: string; name?: string; email?: string };
  customer?: { phone: string; name?: string; consent: boolean } | null;
}

/** Cierra la cuenta: emite la factura electrónica (simulada en la demo), suma sellos y libera la mesa. */
export async function closeCheck(staff: Staff, checkId: string, input: CloseInput) {
  if (!can.charge(staff)) throw new UserError("Tu usuario no puede cobrar");
  const biz = await getBusiness(staff.business_id);
  const db = await getDb();
  return db.tx(async (tx) => {
    const check = await loadCheck(staff.business_id, checkId, tx);
    if (!check) throw new UserError("Cuenta no encontrada");
    if (check.status === "paid") throw new UserError("Esta cuenta ya está cerrada");
    if (check.items.some((i) => i.status === "draft")) throw new UserError("Hay productos sin enviar");
    if (check.totals.total > 0 && check.due > 0) throw new UserError(`Faltan $${check.due.toLocaleString("es-CO")} por pagar`);
    if (check.pendingPayments.length) throw new UserError("Hay un pago del cliente por confirmar");
    if (biz.settings.tips.enabled && !input.tipAnswer) throw new UserError("Pregunta al cliente si incluye la propina");
    if (input.invoice.kind === "nit") {
      if (!input.invoice.doc || input.invoice.doc.replace(/\D/g, "").length < 6) throw new UserError("Escribe el NIT o la cédula para la factura");
      if (!input.invoice.name || input.invoice.name.trim().length < 3) throw new UserError("Escribe el nombre o la razón social");
    }

    // Cliente y sellos (con autorización de datos, Ley 1581)
    let customerId = check.customer_id;
    if (input.customer?.phone) {
      const phone = normalizePhone(input.customer.phone);
      if (phone.length !== 10) throw new UserError("Revisa el celular del cliente");
      if (!input.customer.consent) throw new UserError("El cliente debe autorizar el uso de sus datos para sumar sellos");
      const row = await tx.one<{ id: string }>(
        `insert into customers (business_id, phone, name, consent_at) values ($1, $2, $3, now())
         on conflict (business_id, phone) do update set name = case when customers.name = '' then excluded.name else customers.name end,
           consent_at = coalesce(customers.consent_at, now())
         returning id`,
        [staff.business_id, phone, (input.customer.name ?? "").trim().slice(0, 60)],
      );
      customerId = row!.id;
    }

    const now = new Date();
    const inv = await tx.one<{ id: string; number: number }>(
      `insert into invoices (business_id, check_id, prefix, cufe, public_token, kind, customer_doc, customer_name, customer_email, subtotal, tax, tip, total)
       values ($1, $2, $3, 'pendiente', $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id, number`,
      [
        staff.business_id,
        checkId,
        biz.settings.invoice.prefix,
        token(`inv:${checkId}:${now.getTime()}`, 16),
        input.invoice.kind,
        input.invoice.kind === "nit" ? input.invoice.doc!.trim().slice(0, 20) : "222222222222",
        input.invoice.kind === "nit" ? input.invoice.name!.trim().slice(0, 80) : "Consumidor final",
        input.invoice.email?.trim().slice(0, 80) || null,
        check.totals.base,
        check.totals.tax,
        check.tips,
        check.totals.total + check.tips,
      ],
    );
    // CUFE simulado con la misma receta de la DIAN (SHA-384 de número, fecha, valores y NIT)
    const cufe = fakeCufe([biz.settings.invoice.prefix, inv!.number, now.toISOString(), check.totals.base, check.totals.tax, check.totals.total, biz.settings.business.nit, input.invoice.doc ?? "222222222222"]);
    await tx.query("update invoices set cufe = $2 where id = $1", [inv!.id, cufe]);

    await tx.query(
      "update checks set status = 'paid', closed_at = now(), closed_by = $2, tip_answer = $3, customer_id = $4, updated_at = now() where id = $1",
      [checkId, staff.id, input.tipAnswer, customerId],
    );
    await tx.query("update check_items set status = 'delivered', delivered_at = coalesce(delivered_at, now()), ready_at = coalesce(ready_at, now()) where check_id = $1 and status in ('sent','ready')", [checkId]);
    await tx.query("update requests set status = 'done', handled_by = $2, handled_at = now() where check_id = $1 and status = 'pending'", [checkId, staff.id]);

    let stamps = 0;
    if (customerId && biz.settings.loyalty.enabled) {
      stamps = stampsEarned(check.totals.total, biz.settings.loyalty);
      await tx.query(
        "update customers set stamps = stamps + $2, visits = visits + 1, total_spent = total_spent + $3, last_visit = now() where id = $1",
        [customerId, stamps, check.totals.total],
      );
      if (stamps) await tx.query("insert into loyalty_ledger (business_id, customer_id, delta, reason, check_id) values ($1, $2, $3, 'Visita', $4)", [staff.business_id, customerId, stamps, checkId]);
    }
    await bump(tx, staff.business_id);
    return { invoiceId: inv!.id, stamps };
  });
}

/** Canjea el premio de sellos: la bebida más cara que entre en el tope queda como cortesía. */
export async function redeemReward(staff: Staff, checkId: string) {
  const biz = await getBusiness(staff.business_id);
  const db = await getDb();
  await db.tx(async (tx) => {
    const check = await loadCheck(staff.business_id, checkId, tx);
    if (!check?.customer) throw new UserError("Primero agrega el cliente a la cuenta");
    if (check.customer.stamps < biz.settings.loyalty.goal) throw new UserError(`Le faltan ${biz.settings.loyalty.goal - check.customer.stamps} sellos`);
    const eligible = check.items
      .filter((i) => i.status !== "void" && !i.courtesy && i.station === "barra" && i.unit_price <= biz.settings.loyalty.rewardMax)
      .sort((a, b) => b.unit_price - a.unit_price)[0];
    if (!eligible) throw new UserError(`No hay una bebida de hasta $${biz.settings.loyalty.rewardMax.toLocaleString("es-CO")} en la cuenta`);
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
    await tx.query("update customers set stamps = stamps - $2 where id = $1", [check.customer.id, biz.settings.loyalty.goal]);
    await tx.query("insert into loyalty_ledger (business_id, customer_id, delta, reason, check_id) values ($1, $2, $3, 'Premio canjeado', $4)", [
      staff.business_id,
      check.customer.id,
      -biz.settings.loyalty.goal,
      checkId,
    ]);
    await audit(tx, staff.business_id, staff.id, "reward", { item: eligible.name, customer: check.customer.name }, eligible.unit_price);
    await bump(tx, staff.business_id);
  });
}

export async function attachCustomer(staff: Staff, checkId: string, input: { phone: string; name?: string; consent: boolean }) {
  const phone = normalizePhone(input.phone);
  if (phone.length !== 10) throw new UserError("Escribe un celular de 10 dígitos");
  const db = await getDb();
  return db.tx(async (tx) => {
    const existing = await tx.one<{ id: string; consent_at: string | null }>("select id, consent_at from customers where business_id = $1 and phone = $2", [staff.business_id, phone]);
    if (!existing && !input.consent) throw new UserError("El cliente debe autorizar el uso de sus datos");
    const row = existing
      ? existing
      : await tx.one<{ id: string }>("insert into customers (business_id, phone, name, consent_at) values ($1, $2, $3, now()) returning id", [
          staff.business_id,
          phone,
          (input.name ?? "").trim().slice(0, 60),
        ]);
    if (existing && !existing.consent_at && input.consent) await tx.query("update customers set consent_at = now() where id = $1", [existing.id]);
    await tx.query("update checks set customer_id = $2, updated_at = now() where id = $1 and business_id = $3", [checkId, row!.id, staff.business_id]);
    await bump(tx, staff.business_id);
    return row!.id;
  });
}

/* ---------- Caja ---------- */

export async function openCash(staff: Staff, opening: number) {
  if (!can.charge(staff)) throw new UserError("Tu usuario no puede abrir caja");
  const db = await getDb();
  await db.tx(async (tx) => {
    if (await currentCashSession(staff.business_id, tx)) throw new UserError("Ya hay una caja abierta");
    await tx.query("insert into cash_sessions (business_id, opened_by, opening) values ($1, $2, $3)", [staff.business_id, staff.id, Math.max(0, Math.round(opening))]);
    await audit(tx, staff.business_id, staff.id, "cash_open", {}, Math.round(opening));
    await bump(tx, staff.business_id);
  });
}

export async function addCashMovement(staff: Staff, input: { kind: "in" | "out"; amount: number; reason: string }) {
  const db = await getDb();
  await db.tx(async (tx) => {
    const session = await currentCashSession(staff.business_id, tx);
    if (!session) throw new UserError("Abre la caja primero");
    const amount = Math.round(input.amount);
    if (amount <= 0) throw new UserError("Escribe el valor");
    if (input.reason.trim().length < 3) throw new UserError("Escribe el motivo");
    await tx.query("insert into cash_movements (business_id, session_id, kind, amount, reason, staff_id) values ($1, $2, $3, $4, $5, $6)", [
      staff.business_id,
      session.id,
      input.kind,
      amount,
      input.reason.trim().slice(0, 80),
      staff.id,
    ]);
    await audit(tx, staff.business_id, staff.id, input.kind === "in" ? "cash_in" : "cash_out", { reason: input.reason }, amount);
    await bump(tx, staff.business_id);
  });
}

export async function cashSummary(bizId: string, sessionId: string) {
  const db = await getDb();
  const [session, byMethod, moves, openChecks] = await Promise.all([
    db.one<{ id: string; opened_at: string; opening: number; closed_at: string | null; counted: number | null; expected: number | null; difference: number | null; opener: string | null; closer: string | null }>(
      `select cs.id, cs.opened_at, cs.opening, cs.closed_at, cs.counted, cs.expected, cs.difference, o.name as opener, c.name as closer
         from cash_sessions cs left join staff o on o.id = cs.opened_by left join staff c on c.id = cs.closed_by
        where cs.id = $1 and cs.business_id = $2`,
      [sessionId, bizId],
    ),
    db.query<{ method: string; amount: number; tip: number; n: number; received: number }>(
      `select method, sum(amount)::int as amount, sum(tip)::int as tip, count(*)::int as n, coalesce(sum(received), 0)::int as received
         from payments where cash_session_id = $1 and status = 'ok' group by method`,
      [sessionId],
    ),
    db.query<{ id: string; kind: string; amount: number; reason: string; created_at: string; staff: string | null }>(
      "select m.id, m.kind, m.amount, m.reason, m.created_at, s.name as staff from cash_movements m left join staff s on s.id = m.staff_id where m.session_id = $1 order by m.created_at",
      [sessionId],
    ),
    db.one<{ n: number }>("select count(*)::int as n from checks where business_id = $1 and status in ('open','bill')", [bizId]),
  ]);
  if (!session) return null;
  const cash = byMethod.find((m) => m.method === "efectivo");
  const ins = moves.filter((m) => m.kind === "in").reduce((s, m) => s + m.amount, 0);
  const outs = moves.filter((m) => m.kind === "out").reduce((s, m) => s + m.amount, 0);
  // En el cajón queda la base, lo cobrado en efectivo (con su propina) y los movimientos
  const expected = session.opening + (cash ? cash.amount + cash.tip : 0) + ins - outs;
  const sales = byMethod.reduce((s, m) => s + m.amount, 0);
  const tips = byMethod.reduce((s, m) => s + m.tip, 0);
  return { session, byMethod, moves, ins, outs, expected, sales, tips, openChecks: openChecks?.n ?? 0, payments: byMethod.reduce((s, m) => s + m.n, 0) };
}

export async function closeCash(staff: Staff, counted: number, note: string) {
  if (!can.closeCash(staff)) throw new UserError("Solo caja o el encargado cierran la caja");
  const db = await getDb();
  const session = await currentCashSession(staff.business_id);
  if (!session) throw new UserError("No hay caja abierta");
  const summary = await cashSummary(staff.business_id, session.id);
  if (!summary) throw new UserError("No hay caja abierta");
  const c = Math.max(0, Math.round(counted));
  await db.tx(async (tx) => {
    await tx.query("update cash_sessions set closed_at = now(), closed_by = $2, counted = $3, expected = $4, difference = $5, note = $6 where id = $1", [
      session.id,
      staff.id,
      c,
      summary.expected,
      c - summary.expected,
      note.trim().slice(0, 200),
    ]);
    await audit(tx, staff.business_id, staff.id, "cash_close", { expected: summary.expected, counted: c }, c - summary.expected);
    await bump(tx, staff.business_id);
  });
  return { sessionId: session.id, difference: c - summary.expected };
}

export async function lastClosedSessions(bizId: string, limit = 5) {
  const db = await getDb();
  return db.query<{ id: string; opened_at: string; closed_at: string; expected: number; counted: number; difference: number; closer: string | null }>(
    `select cs.id, cs.opened_at, cs.closed_at, cs.expected, cs.counted, cs.difference, s.name as closer from cash_sessions cs
       left join staff s on s.id = cs.closed_by where cs.business_id = $1 and cs.closed_at is not null order by cs.closed_at desc limit $2`,
    [bizId, limit],
  );
}

