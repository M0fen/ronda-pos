import "server-only";
import { balance, checkTotals, type CheckTotals } from "../core/pricing";
import { minutesSince } from "../core/time";
import { can, requireAuth, verifyAuthorizer, type AuthInput, type Staff } from "./auth";
import { CHANNEL_SHORT } from "../settings";
import { audit, bump, getBusiness, nextNumber } from "./business";
import { getDb, type Tx } from "./db";
import { UserError } from "./errors";
import { cop } from "../money";
import { loadMenu, priceItem, type ChosenItem } from "./menu";

export interface Mod {
  name: string;
  price: number;
}

export interface CheckItem {
  id: string;
  product_id: string | null;
  name: string;
  unit_price: number;
  qty: number;
  modifiers: Mod[];
  note: string;
  station: string;
  tax_rate: number;
  status: "draft" | "sent" | "ready" | "delivered" | "void";
  round: number;
  courtesy: boolean;
  source: string;
  sent_at: string | null;
  ready_at: string | null;
  delivered_at: string | null;
  void_reason: string | null;
  created_at: string;
}

export interface PaymentRow {
  id: string;
  method: string;
  amount: number;
  tip: number;
  received: number | null;
  reference: string;
  part: string;
  status: string;
  created_at: string;
}

export interface CheckRow {
  id: string;
  number: number;
  table_id: string | null;
  table_name: string | null;
  kind: "mesa" | "barra" | "llevar" | "domicilio";
  /** local, rappi, didi o propio */
  channel: string;
  delivery: Delivery | null;
  name: string;
  guests: number;
  status: "open" | "bill" | "paid" | "void";
  opened_by: string | null;
  waiter_name: string | null;
  waiter_color: string | null;
  opened_at: string;
  closed_at: string | null;
  customer_id: string | null;
  discount_pct: number;
  discount_reason: string | null;
  tip_answer: string | null;
  updated_at: string;
}

/** Datos del domicilio: código del pedido en la plataforma o propio, cliente, dirección y empaque. */
export interface Delivery {
  code: string;
  phone?: string;
  address?: string;
  notes?: string;
  packedAt?: string;
  packedBy?: string;
  checklist?: string[];
  riderAt?: string;
}

export interface CheckView extends CheckRow {
  label: string;
  items: CheckItem[];
  payments: PaymentRow[];
  totals: CheckTotals;
  paid: number;
  due: number;
  tips: number;
  pendingPayments: PaymentRow[];
  customer: { id: string; name: string; phone: string; stamps: number; visits: number } | null;
  invoice: { id: string; number: number; prefix: string; public_token: string } | null;
}

export function checkLabel(c: Pick<CheckRow, "kind" | "table_name" | "name" | "number"> & { channel?: string; delivery?: Pick<Delivery, "code"> | null }) {
  if (c.kind === "mesa") return `Mesa ${c.table_name ?? "?"}`;
  if (c.kind === "domicilio") return [CHANNEL_SHORT[c.channel ?? "propio"] ?? "Domicilio", c.delivery?.code, c.name].filter(Boolean).join(" · ");
  if (c.kind === "barra") return c.name ? `Barra · ${c.name}` : `Barra #${c.number}`;
  return c.name ? `Para llevar · ${c.name}` : `Para llevar #${c.number}`;
}

const CHECK_SELECT = `
  select c.id, c.number, c.table_id, t.name as table_name, c.kind, c.channel, c.delivery, c.name, c.guests, c.status, c.opened_by,
         s.name as waiter_name, s.color as waiter_color, c.opened_at, c.closed_at, c.customer_id, c.discount_pct,
         c.discount_reason, c.tip_answer, c.updated_at
    from checks c
    left join floor_tables t on t.id = c.table_id
    left join staff s on s.id = c.opened_by`;

const ITEM_SELECT = `select id, product_id, name, unit_price, qty, modifiers, note, station, tax_rate, status, round, courtesy, source,
  sent_at, ready_at, delivered_at, void_reason, created_at from check_items`;

export function totalsFor(items: Pick<CheckItem, "unit_price" | "qty" | "modifiers" | "tax_rate" | "status" | "courtesy">[], discountPct: number) {
  return checkTotals(
    items.map((i) => ({ unitPrice: i.unit_price, qty: i.qty, modifiers: i.modifiers, taxRate: Number(i.tax_rate), status: i.status, courtesy: i.courtesy })),
    discountPct,
  );
}

export async function loadCheck(bizId: string, checkId: string, tx?: Tx): Promise<CheckView | null> {
  const db = tx ?? (await getDb());
  const check = await db.one<CheckRow>(`${CHECK_SELECT} where c.id = $1 and c.business_id = $2`, [checkId, bizId]);
  if (!check) return null;
  const [items, payments, customer, invoice] = await Promise.all([
    db.query<CheckItem>(`${ITEM_SELECT} where check_id = $1 order by created_at, id`, [checkId]),
    db.query<PaymentRow>("select id, method, amount, tip, received, reference, part, status, created_at from payments where check_id = $1 order by created_at", [checkId]),
    check.customer_id ? db.one<CheckView["customer"]>("select id, name, phone, stamps, visits from customers where id = $1", [check.customer_id]) : Promise.resolve(null),
    db.one<CheckView["invoice"]>("select id, number, prefix, public_token from invoices where check_id = $1 and voided_at is null order by created_at desc limit 1", [checkId]),
  ]);
  const totals = totalsFor(items, check.discount_pct);
  const ok = payments.filter((p) => p.status === "ok");
  const { paid, due } = balance(totals.total, ok);
  return {
    ...check,
    label: checkLabel(check),
    items,
    payments: ok,
    pendingPayments: payments.filter((p) => p.status === "pending"),
    totals,
    paid,
    due,
    tips: ok.reduce((s, p) => s + p.tip, 0),
    customer,
    invoice,
  };
}

export interface CheckSummary extends CheckRow {
  label: string;
  total: number;
  units: number;
  drafts: number;
  inStation: number;
  ready: number;
  lastOrderAt: string | null;
  minutesOpen: number;
  minutesIdle: number;
}

export async function openChecks(bizId: string): Promise<CheckSummary[]> {
  const db = await getDb();
  const checks = await db.query<CheckRow>(`${CHECK_SELECT} where c.business_id = $1 and c.status in ('open','bill') order by c.opened_at`, [bizId]);
  if (!checks.length) return [];
  const items = await db.query<CheckItem & { check_id: string }>(`${ITEM_SELECT.replace("select id,", "select check_id, id,")} where check_id = any($1::uuid[])`, [checks.map((c) => c.id)]);
  const now = new Date();
  return checks.map((c) => {
    const mine = items.filter((i) => i.check_id === c.id);
    const totals = totalsFor(mine, c.discount_pct);
    const sent = mine.map((i) => i.sent_at).filter((x): x is string => !!x).sort();
    const last = sent[sent.length - 1] ?? null;
    return {
      ...c,
      label: checkLabel(c),
      total: totals.total,
      units: totals.units,
      drafts: mine.filter((i) => i.status === "draft").length,
      inStation: mine.filter((i) => i.status === "sent").length,
      ready: mine.filter((i) => i.status === "ready").length,
      lastOrderAt: last,
      minutesOpen: minutesSince(c.opened_at, now),
      minutesIdle: minutesSince(last ?? c.opened_at, now),
    };
  });
}

/** Ventas netas (sin impuesto) de lo que se está consumiendo en las cuentas abiertas: lo enviado, sin borradores. */
export async function openNetSales(bizId: string) {
  const checks = await openChecks(bizId);
  if (!checks.length) return 0;
  const db = await getDb();
  const items = await db.query<CheckItem & { check_id: string }>(
    `${ITEM_SELECT.replace("select id,", "select check_id, id,")} where check_id = any($1::uuid[]) and status in ('sent','ready','delivered')`,
    [checks.map((c) => c.id)],
  );
  return checks.reduce((sum, c) => sum + totalsFor(items.filter((i) => i.check_id === c.id), c.discount_pct).base, 0);
}

export interface TableView {
  id: string;
  name: string;
  seats: number;
  x: number;
  y: number;
  shape: string;
  zone_id: string;
  qr_token: string;
  check: CheckSummary | null;
}

export interface RequestView {
  id: string;
  kind: "order" | "waiter" | "bill" | "payment";
  table_id: string | null;
  table_name: string | null;
  check_id: string | null;
  payload: { items?: { productId: string; name: string; qty: number; modifiers: Mod[]; note: string }[]; guestName?: string; amount?: number; tip?: number; method?: string; reference?: string; paymentId?: string };
  created_at: string;
}

export async function pendingRequests(bizId: string): Promise<RequestView[]> {
  const db = await getDb();
  return db.query<RequestView>(
    `select r.id, r.kind, r.table_id, t.name as table_name, r.check_id, r.payload, r.created_at
       from requests r left join floor_tables t on t.id = r.table_id
      where r.business_id = $1 and r.status = 'pending' order by r.created_at`,
    [bizId],
  );
}

export async function floorState(bizId: string) {
  const db = await getDb();
  const [zones, tables, checks, requests] = await Promise.all([
    db.query<{ id: string; name: string }>("select id, name from zones where business_id = $1 order by sort", [bizId]),
    db.query<Omit<TableView, "check">>("select id, name, seats, x, y, shape, zone_id, qr_token from floor_tables where business_id = $1 and active order by zone_id, name", [bizId]),
    openChecks(bizId),
    pendingRequests(bizId),
  ]);
  const byTable = new Map(checks.filter((c) => c.table_id).map((c) => [c.table_id!, c]));
  return {
    zones,
    tables: tables.map((t) => ({ ...t, check: byTable.get(t.id) ?? null })) as TableView[],
    others: checks.filter((c) => !c.table_id && c.kind !== "domicilio"),
    deliveries: checks.filter((c) => c.kind === "domicilio").length,
    checks,
    requests,
  };
}

async function editableCheck(tx: Tx, bizId: string, checkId: string) {
  const check = await tx.one<{ id: string; status: string; number: number; discount_pct: number; kind: CheckRow["kind"] }>(
    "select id, status, number, discount_pct, kind from checks where id = $1 and business_id = $2 for update",
    [checkId, bizId],
  );
  if (!check) throw new UserError("Cuenta no encontrada");
  if (check.status === "paid" || check.status === "void") throw new UserError("Esta cuenta ya está cerrada");
  return check;
}

/** Nada puede dejar lo pagado por encima del total: primero se quita un pago. Se llama después del cambio, en la misma transacción. */
export async function assertNotOverpaid(tx: Tx, bizId: string, checkId: string) {
  const check = await loadCheck(bizId, checkId, tx);
  if (check && check.paid > check.totals.total) {
    throw new UserError(`Ya se pagaron ${cop(check.paid)} y la cuenta quedaría en ${cop(check.totals.total)}. Quita un pago antes de hacer este cambio.`);
  }
}

/** Un domicilio ya empacado que cambia vuelve a "Para empacar": la bolsa se revisa otra vez. */
export async function reopenBag(tx: Tx, bizId: string, checkId: string, staffId: string) {
  const rows = await tx.query<{ id: string }>(
    "update checks set delivery = delivery - 'packedAt' - 'packedBy' - 'checklist' where id = $1 and kind = 'domicilio' and delivery ? 'packedAt' returning id",
    [checkId],
  );
  if (rows.length) await audit(tx, bizId, staffId, "bag_reopened", { check: checkId });
}

export async function openCheck(staff: Staff, input: { tableId?: string | null; kind: "mesa" | "barra" | "llevar"; name?: string; guests?: number }) {
  const db = await getDb();
  return db.tx(async (tx) => {
    if (input.kind === "mesa") {
      if (!input.tableId) throw new UserError("Elige una mesa");
      // Bloquea la mesa: dos meseros a la vez no abren dos cuentas en la misma mesa
      const table = await tx.one<{ id: string }>("select id from floor_tables where id = $1 and business_id = $2 and active for update", [input.tableId, staff.business_id]);
      if (!table) throw new UserError("Mesa no encontrada");
      const existing = await tx.one<{ id: string }>("select id from checks where table_id = $1 and status in ('open','bill')", [input.tableId]);
      if (existing) return existing.id;
    }
    const name = (input.name ?? "").trim().slice(0, 40);
    if (input.kind !== "mesa" && !name) throw new UserError("Escribe un nombre para la cuenta");
    const row = await tx.one<{ id: string }>(
      "insert into checks (business_id, number, table_id, kind, name, guests, opened_by) values ($1, $2, $3, $4, $5, $6, $7) returning id",
      [
        staff.business_id,
        await nextNumber(tx, staff.business_id, "check"),
        input.kind === "mesa" ? input.tableId : null,
        input.kind,
        name,
        Math.min(40, Math.max(1, Math.floor(input.guests ?? 2))),
        staff.id,
      ],
    );
    await bump(tx, staff.business_id);
    return row!.id;
  });
}

export async function addItems(staff: Staff, checkId: string, chosen: ChosenItem[], source = "staff", tx?: Tx) {
  if (!chosen.length) return;
  const menu = await loadMenu(staff.business_id);
  const run = async (t: Tx) => {
    await editableCheck(t, staff.business_id, checkId);
    for (const c of chosen.slice(0, 40)) {
      const line = priceItem(menu, c);
      if (line.product.soldOut) throw new UserError(`${line.product.name} está agotado`);
      // Si ya hay una línea igual sin enviar, suma cantidad
      const same = await t.one<{ id: string; qty: number }>(
        "select id, qty from check_items where check_id = $1 and status = 'draft' and product_id = $2 and modifiers = $3::jsonb and note = $4 and unit_price = $5",
        [checkId, line.product.id, JSON.stringify(line.modifiers), line.note, line.product.price],
      );
      if (same) {
        await t.query("update check_items set qty = least(99, qty + $2) where id = $1", [same.id, line.qty]);
      } else {
        await t.query(
          `insert into check_items (business_id, check_id, product_id, name, unit_price, qty, modifiers, note, station, tax_rate, source, added_by)
           values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12)`,
          [staff.business_id, checkId, line.product.id, line.product.name, line.product.price, line.qty, JSON.stringify(line.modifiers), line.note, line.product.station, line.product.taxRate, source, staff.id],
        );
      }
    }
    await t.query("update checks set updated_at = now() where id = $1", [checkId]);
    await reopenBag(t, staff.business_id, checkId, staff.id);
  };
  if (tx) return run(tx);
  const db = await getDb();
  await db.tx(run);
}

export async function changeDraft(staff: Staff, itemId: string, patch: { qty?: number; note?: string }) {
  const db = await getDb();
  await db.tx(async (tx) => {
    const item = await tx.one<{ check_id: string; status: string }>("select check_id, status from check_items where id = $1 and business_id = $2", [itemId, staff.business_id]);
    if (!item) throw new UserError("Ítem no encontrado");
    if (item.status !== "draft") throw new UserError("Ya se envió: para quitarlo, anúlalo");
    await editableCheck(tx, staff.business_id, item.check_id);
    if (patch.qty !== undefined && patch.qty <= 0) {
      await tx.query("delete from check_items where id = $1", [itemId]);
    } else {
      if (patch.qty !== undefined) await tx.query("update check_items set qty = $2 where id = $1", [itemId, Math.min(99, Math.floor(patch.qty))]);
      if (patch.note !== undefined) await tx.query("update check_items set note = $2 where id = $1", [itemId, patch.note.trim().slice(0, 140)]);
    }
  });
}

/** Descuenta (o devuelve) insumos según las recetas. */
export async function moveStock(tx: Tx, bizId: string, items: { product_id: string | null; qty: number }[], sign: -1 | 1, reason: "venta" | "anulacion", ref: string, staffId: string | null) {
  const ids = [...new Set(items.map((i) => i.product_id).filter((x): x is string => !!x))];
  if (!ids.length) return;
  const recipe = await tx.query<{ product_id: string; ingredient_id: string; qty: number }>(
    "select product_id, ingredient_id, qty from recipe_items where product_id = any($1::uuid[])",
    [ids],
  );
  const delta = new Map<string, number>();
  for (const it of items) for (const r of recipe.filter((x) => x.product_id === it.product_id)) delta.set(r.ingredient_id, (delta.get(r.ingredient_id) ?? 0) + Number(r.qty) * it.qty * sign);
  if (!delta.size) return;
  const rows = [...delta].map(([ingredient_id, d]) => ({ ingredient_id, d }));
  await tx.query(
    `update ingredients i set stock = i.stock + x.d from jsonb_to_recordset($1::jsonb) as x(ingredient_id uuid, d numeric) where i.id = x.ingredient_id and i.business_id = $2`,
    [JSON.stringify(rows), bizId],
  );
  await tx.query(
    `insert into stock_movements (business_id, ingredient_id, delta, reason, ref, staff_id)
     select $2, x.ingredient_id, x.d, $3, $4, $5 from jsonb_to_recordset($1::jsonb) as x(ingredient_id uuid, d numeric)`,
    [JSON.stringify(rows), bizId, reason, ref, staffId],
  );
}

/** Envía la ronda: lo que estaba en borrador pasa a barra y cocina y descuenta inventario. */
export async function sendRound(staff: Staff, checkId: string) {
  const db = await getDb();
  return db.tx(async (tx) => {
    const check = await editableCheck(tx, staff.business_id, checkId);
    const drafts = await tx.query<{ id: string; product_id: string | null; qty: number; station: string }>(
      "select id, product_id, qty, station from check_items where check_id = $1 and status = 'draft'",
      [checkId],
    );
    if (!drafts.length) throw new UserError("No hay nada nuevo para enviar");
    const round = await tx.one<{ r: number }>("select coalesce(max(round), 0) + 1 as r from check_items where check_id = $1", [checkId]);
    await tx.query("update check_items set status = 'sent', round = $2, sent_at = now() where check_id = $1 and status = 'draft'", [checkId, round!.r]);
    await tx.query("update checks set status = 'open', updated_at = now() where id = $1", [checkId]);
    await moveStock(tx, staff.business_id, drafts, -1, "venta", `Cuenta ${check.number}`, staff.id);
    await bump(tx, staff.business_id);
    const stations = [...new Set(drafts.map((d) => d.station))];
    return { count: drafts.length, stations };
  });
}

export async function voidItem(staff: Staff, itemId: string, input: { reason: string; waste: boolean; auth?: AuthInput | null }) {
  const reason = input.reason.trim().slice(0, 120);
  if (reason.length < 3) throw new UserError("Escribe el motivo de la anulación");
  // La autorización se verifica antes: así un PIN equivocado cuenta como intento aunque la acción no siga
  const authorizedBy = await verifyAuthorizer(staff, input.auth, "void");
  const db = await getDb();
  const biz = await getBusiness(staff.business_id);
  return db.tx(async (tx) => {
    const item = await tx.one<CheckItem & { check_id: string }>(`${ITEM_SELECT.replace("select id,", "select check_id, id,")} where id = $1 and business_id = $2`, [itemId, staff.business_id]);
    if (!item) throw new UserError("Ítem no encontrado");
    const check = await editableCheck(tx, staff.business_id, item.check_id);
    if (item.status === "void") return { alert: false };
    if (item.status === "draft") {
      await tx.query("delete from check_items where id = $1", [itemId]);
      return { alert: false };
    }
    const amount = item.courtesy ? 0 : (item.unit_price + item.modifiers.reduce((s, m) => s + m.price, 0)) * item.qty;
    const who = requireAuth(!can.voidSent(staff), staff, authorizedBy, "void");
    await tx.query("update check_items set status = 'void', void_reason = $2, void_by = $3, void_waste = $4 where id = $1", [itemId, reason, who.id, input.waste]);
    if (!input.waste) await moveStock(tx, staff.business_id, [item], 1, "anulacion", `Cuenta ${check.number}`, staff.id);
    await assertNotOverpaid(tx, staff.business_id, item.check_id);
    await reopenBag(tx, staff.business_id, item.check_id, staff.id);
    await audit(tx, staff.business_id, staff.id, "void", { item: item.name, qty: item.qty, check: check.number, reason, authorizedBy: who.name, waste: input.waste }, amount);
    await bump(tx, staff.business_id);
    return { alert: amount >= biz.settings.alerts.voidLimit };
  });
}

export async function toggleCourtesy(staff: Staff, itemId: string, auth?: AuthInput | null) {
  const authorizedBy = await verifyAuthorizer(staff, auth, "manage");
  const db = await getDb();
  await db.tx(async (tx) => {
    const item = await tx.one<{ check_id: string; courtesy: boolean; name: string; unit_price: number; qty: number; status: string; modifiers: Mod[] }>(
      "select check_id, courtesy, name, unit_price, qty, status, modifiers from check_items where id = $1 and business_id = $2",
      [itemId, staff.business_id],
    );
    if (!item || item.status === "void") throw new UserError("Ítem no encontrado");
    const check = await editableCheck(tx, staff.business_id, item.check_id);
    const who = requireAuth(!can.manage(staff), staff, authorizedBy, "manage");
    await tx.query("update check_items set courtesy = not courtesy where id = $1", [itemId]);
    await assertNotOverpaid(tx, staff.business_id, item.check_id);
    const amount = (item.unit_price + item.modifiers.reduce((s, m) => s + m.price, 0)) * item.qty;
    await audit(tx, staff.business_id, staff.id, item.courtesy ? "courtesy_off" : "courtesy", { item: item.name, check: check.number, authorizedBy: who.name }, amount);
    await bump(tx, staff.business_id);
  });
}

export async function setDiscount(staff: Staff, checkId: string, input: { pct: number; reason: string; auth?: AuthInput | null }) {
  const pct = Math.min(100, Math.max(0, Math.round(Number(input.pct) || 0)));
  const reason = (input.reason ?? "").trim().slice(0, 120);
  if (pct > 0 && reason.length < 3) throw new UserError("Escribe el motivo del descuento");
  const biz = await getBusiness(staff.business_id);
  const authorizedBy = await verifyAuthorizer(staff, input.auth, "manage");
  const db = await getDb();
  await db.tx(async (tx) => {
    const check = await editableCheck(tx, staff.business_id, checkId);
    const who = requireAuth(pct > biz.settings.alerts.discountLimitPct && !can.manage(staff), staff, authorizedBy, "manage");
    const before = check.discount_pct;
    await tx.query("update checks set discount_pct = $2, discount_reason = $3, updated_at = now() where id = $1", [checkId, pct, pct ? reason : null]);
    await assertNotOverpaid(tx, staff.business_id, checkId);
    // Queda el valor en pesos del descuento: sale en el panel junto a cortesías y anulaciones
    const after = await loadCheck(staff.business_id, checkId, tx);
    await audit(tx, staff.business_id, staff.id, "discount", { check: check.number, pct, from: before, reason, authorizedBy: who.name }, after?.totals.discount ?? 0);
    await bump(tx, staff.business_id);
  });
}

export async function setBillRequested(staff: Staff, checkId: string, on: boolean) {
  const db = await getDb();
  await db.tx(async (tx) => {
    await editableCheck(tx, staff.business_id, checkId);
    await tx.query("update checks set status = $2, updated_at = now() where id = $1", [checkId, on ? "bill" : "open"]);
    await tx.query("update requests set status = 'done', handled_by = $2, handled_at = now() where check_id = $1 and kind = 'bill' and status = 'pending'", [checkId, staff.id]);
    await bump(tx, staff.business_id);
  });
}

/** Marca entregado lo que estaba listo: un producto, o todo lo listo de la cuenta. */
export async function markDelivered(staff: Staff, checkId: string, itemId?: string | null) {
  const db = await getDb();
  await db.tx(async (tx) => {
    await editableCheck(tx, staff.business_id, checkId);
    if (itemId) await tx.query("update check_items set status = 'delivered', delivered_at = now() where id = $2 and check_id = $1 and status = 'ready'", [checkId, itemId]);
    else await tx.query("update check_items set status = 'delivered', delivered_at = now() where check_id = $1 and status = 'ready'", [checkId]);
    await bump(tx, staff.business_id);
  });
}

export async function updateCheckMeta(staff: Staff, checkId: string, patch: { guests?: number; name?: string; tableId?: string }) {
  const db = await getDb();
  await db.tx(async (tx) => {
    const current = await editableCheck(tx, staff.business_id, checkId);
    if (patch.guests !== undefined) await tx.query("update checks set guests = $2 where id = $1", [checkId, Math.min(40, Math.max(1, Math.floor(patch.guests)))]);
    if (patch.name !== undefined) await tx.query("update checks set name = $2 where id = $1", [checkId, patch.name.trim().slice(0, 40)]);
    if (patch.tableId) {
      if (current.kind === "domicilio") throw new UserError("Un domicilio no se puede pasar a una mesa");
      const table = await tx.one("select 1 from floor_tables where id = $1 and business_id = $2 and active for update", [patch.tableId, staff.business_id]);
      if (!table) throw new UserError("Mesa no encontrada");
      const busy = await tx.one("select 1 from checks where table_id = $1 and status in ('open','bill') and id <> $2", [patch.tableId, checkId]);
      if (busy) throw new UserError("Esa mesa ya tiene una cuenta abierta");
      await tx.query("update checks set table_id = $2, kind = 'mesa' where id = $1", [checkId, patch.tableId]);
    }
    await tx.query("update checks set updated_at = now() where id = $1", [checkId]);
    await bump(tx, staff.business_id);
  });
}

/** Cierra una cuenta vacía (sin nada enviado) que se abrió por error. */
export async function discardCheck(staff: Staff, checkId: string) {
  const db = await getDb();
  await db.tx(async (tx) => {
    const check = await editableCheck(tx, staff.business_id, checkId);
    const sent = await tx.one("select 1 from check_items where check_id = $1 and status not in ('draft','void')", [checkId]);
    if (sent) throw new UserError("Tiene productos enviados: anúlalos primero");
    const paid = await tx.one("select 1 from payments where check_id = $1 and status in ('ok','pending')", [checkId]);
    if (paid) throw new UserError("Tiene pagos registrados: quítalos antes de descartarla");
    // Solo se borran los borradores; lo anulado queda como registro
    const drafts = await tx.query<{ id: string }>("delete from check_items where check_id = $1 and status = 'draft' returning id", [checkId]);
    await tx.query("update checks set status = 'void', closed_at = now(), closed_by = $2 where id = $1", [checkId, staff.id]);
    await tx.query("update requests set status = 'done', handled_by = $2, handled_at = now() where check_id = $1 and status = 'pending'", [checkId, staff.id]);
    await audit(tx, staff.business_id, staff.id, "discard", { check: check.number, drafts: drafts.length });
    await bump(tx, staff.business_id);
  });
}

/* ---------- Pantalla de barra y cocina ---------- */

export interface Ticket {
  key: string;
  checkId: string;
  label: string;
  waiter: string | null;
  round: number;
  station: string;
  sentAt: string;
  items: { id: string; name: string; qty: number; modifiers: Mod[]; note: string; status: string; source: string; ficha: string | null }[];
  /** Pedido de domicilio: canal para el color del tiquete */
  channel: string | null;
  /** Domicilio: cuándo llega el domiciliario, para que la cocina priorice */
  riderAt: string | null;
}

const GRAMS = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });

export async function kdsBoard(bizId: string, station: string | null) {
  const db = await getDb();
  const rows = await db.query<
    CheckItem & {
      check_id: string;
      kind: CheckRow["kind"];
      channel: string;
      delivery: Delivery | null;
      table_name: string | null;
      check_name: string;
      number: number;
      waiter: string | null;
      ficha: { q: number; u: string; n: string }[] | null;
    }
  >(
    `select i.id, i.check_id, i.name, i.qty, i.modifiers, i.note, i.status, i.round, i.station, i.sent_at, i.ready_at, i.source,
            c.kind, c.channel, c.delivery, t.name as table_name, c.name as check_name, c.number, s.name as waiter,
            -- Ficha técnica: los gramajes de la receta, para que salga igual en todas las sedes
            case when i.station = 'cocina' then (
              select json_agg(json_build_object('q', r.qty, 'u', g.unit, 'n', lower(g.name)) order by r.qty desc)
                from recipe_items r join ingredients g on g.id = r.ingredient_id where r.product_id = i.product_id
            ) end as ficha
       from check_items i
       join checks c on c.id = i.check_id
       left join floor_tables t on t.id = c.table_id
       left join staff s on s.id = c.opened_by
      where i.business_id = $1
        and i.sent_at > now() - interval '12 hours'
        -- Cobrar no saca nada de la cocina: lo pagado que falta sigue en pantalla hasta que se entrega
        and (c.status in ('open','bill') or (c.status = 'paid' and c.closed_at > now() - interval '4 hours'))
        and (i.status in ('sent','ready') or (i.status = 'delivered' and i.delivered_at > now() - interval '15 minutes'))
        ${station ? "and i.station = $2" : ""}
      order by i.sent_at, i.id`,
    station ? [bizId, station] : [bizId],
  );
  const tickets = new Map<string, Ticket>();
  for (const r of rows) {
    const key = `${r.check_id}:${r.round}:${r.station}`;
    const t = tickets.get(key) ?? {
      key,
      checkId: r.check_id,
      label: checkLabel({ kind: r.kind, table_name: r.table_name, name: r.check_name, number: r.number, channel: r.channel, delivery: r.delivery }),
      channel: r.kind === "domicilio" ? r.channel : null,
      riderAt: r.kind === "domicilio" ? (r.delivery?.riderAt ?? null) : null,
      waiter: r.waiter,
      round: r.round,
      station: r.station,
      sentAt: r.sent_at!,
      items: [],
    };
    // Los gramajes se escriben aquí y no en SQL: 22,5 g sale como 22,5 (no como 23)
    const ficha = r.ficha?.length ? r.ficha.map((x) => `${GRAMS.format(Number(x.q))} ${x.u} ${x.n}`).join(" · ") : null;
    t.items.push({ id: r.id, name: r.name, qty: r.qty, modifiers: r.modifiers, note: r.note, status: r.status, source: r.source, ficha });
    tickets.set(key, t);
  }
  const all = [...tickets.values()];
  const active = all.filter((t) => t.items.some((i) => i.status === "sent"));
  const ready = all.filter((t) => !t.items.some((i) => i.status === "sent") && t.items.some((i) => i.status === "ready"));
  const done = all.filter((t) => t.items.every((i) => i.status === "delivered"));
  const avg = await db.one<{ m: number | null }>(
    `select round(avg(extract(epoch from (ready_at - sent_at)) / 60)::numeric, 1) as m from check_items
      where business_id = $1 and ready_at > now() - interval '3 hours' and sent_at is not null ${station ? "and station = $2" : ""}`,
    station ? [bizId, station] : [bizId],
  );
  return { active, ready, done, avgMinutes: avg?.m ? Number(avg.m) : null };
}

/** Barra y cocina solo mueven lo que está en preparación: enviado ↔ listo. Nada más (ni anular ni volver a borrador). */
export async function kdsSetItem(staff: Staff, itemId: string, status: "sent" | "ready") {
  if (status !== "sent" && status !== "ready") throw new UserError("Ese cambio no se puede hacer desde barra y cocina");
  const db = await getDb();
  await db.tx(async (tx) => {
    const item = await tx.one<{ status: string; check_status: string }>(
      "select i.status, c.status as check_status from check_items i join checks c on c.id = i.check_id where i.id = $1 and i.business_id = $2 for update of i",
      [itemId, staff.business_id],
    );
    const allowed = item && item.check_status !== "void" && ((item.status === "sent" && status === "ready") || (item.status === "ready" && status === "sent"));
    if (!allowed) throw new UserError("Ese producto ya no está en preparación");
    await tx.query("update check_items set status = $2, ready_at = case when $2 = 'ready' then now() else null end where id = $1", [itemId, status]);
    await bump(tx, staff.business_id);
  });
}

/** Tiquete completo: listo (enviado → listo), entregado (listo → entregado) o devolver a listos (entregado → listo). */
export async function kdsBumpTicket(staff: Staff, checkId: string, round: number, station: string, status: "ready" | "delivered" | "recall") {
  const moves = { ready: { from: "sent", to: "ready" }, delivered: { from: "ready", to: "delivered" }, recall: { from: "delivered", to: "ready" } } as const;
  const move = moves[status as keyof typeof moves];
  if (!move) throw new UserError("Ese cambio no se puede hacer desde barra y cocina");
  const db = await getDb();
  await db.tx(async (tx) => {
    const check = await tx.one<{ kind: string; status: string }>("select kind, status from checks where id = $1 and business_id = $2 for update", [checkId, staff.business_id]);
    if (!check || check.status === "void") throw new UserError("Esa cuenta ya no está");
    // Un domicilio se entrega al empacarlo y revisar la bolsa, no desde la cocina
    if (check.kind === "domicilio" && move.to === "delivered") throw new UserError("Los domicilios se entregan desde Domicilios, al revisar la bolsa");
    await tx.query(
      `update check_items set status = $5, ready_at = case when $5 = 'ready' then coalesce(ready_at, now()) else ready_at end,
              delivered_at = case when $5 = 'delivered' then now() else null end
        where check_id = $1 and round = $2 and station = $3 and business_id = $4 and status = $6`,
      [checkId, Math.floor(Number(round)), String(station), staff.business_id, move.to, move.from],
    );
    await bump(tx, staff.business_id);
  });
}
