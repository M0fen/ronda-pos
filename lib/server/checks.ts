import "server-only";
import { balance, checkTotals, type CheckTotals } from "../core/pricing";
import { minutesSince } from "../core/time";
import { can, requireAuth, verifyAuthorizer, type AuthInput, type Staff } from "./auth";
import { CHANNEL_SHORT } from "../settings";
import { audit, bump, getBusiness, nextNumber } from "./business";
import { getDb, type Tx } from "./db";
import { UserError } from "./errors";
import { cop } from "../money";
import { loadMenu, priceItem, type ChosenItem, type Menu } from "./menu";

export interface Mod {
  name: string;
  price: number;
  /** Opción de la carta: con ella se edita y se repite el pedido (las líneas viejas no la traen) */
  id?: string;
  /** Grupo de la opción ("Adiciones", "Salsa") */
  group?: string;
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
  /** Alergia o intolerancia: barra y cocina la ven en rojo; la nota dice a qué */
  allergy: boolean;
  /** Retenido: no sale con el envío; se manda después (el plato fuerte, el postre) */
  held: boolean;
  /** Puesto en la mesa (1, 2, 3…): quién se lo come */
  seat: number | null;
  voided_at: string | null;
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
  status: "open" | "bill" | "paid" | "void" | "merged";
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
  /** Cuenta aparte en la misma mesa: apunta a la cuenta principal */
  split_of: string | null;
  /** Cuenta que se unió a otra: a cuál */
  merged_into: string | null;
}

/** Abierta o con pre-cuenta: todo lo demás (pagada, descartada, unida a otra) ya no se toca. */
export function isClosed(status: string) {
  return status !== "open" && status !== "bill";
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
  // Una cuenta aparte lleva su nombre ("Mesa 4 · Cuenta 2"); la principal de la mesa, no
  if (c.kind === "mesa") return c.name ? `Mesa ${c.table_name ?? "?"} · ${c.name}` : `Mesa ${c.table_name ?? "?"}`;
  if (c.kind === "domicilio") return [CHANNEL_SHORT[c.channel ?? "propio"] ?? "Domicilio", c.delivery?.code, c.name].filter(Boolean).join(" · ");
  if (c.kind === "barra") return c.name ? `Barra · ${c.name}` : `Barra #${c.number}`;
  return c.name ? `Para llevar · ${c.name}` : `Para llevar #${c.number}`;
}

const CHECK_SELECT = `
  select c.id, c.number, c.table_id, t.name as table_name, c.kind, c.channel, c.delivery, c.name, c.guests, c.status, c.opened_by,
         s.name as waiter_name, s.color as waiter_color, c.opened_at, c.closed_at, c.customer_id, c.discount_pct,
         c.discount_reason, c.tip_answer, c.updated_at, c.split_of, c.merged_into
    from checks c
    left join floor_tables t on t.id = c.table_id
    left join staff s on s.id = c.opened_by`;

const ITEM_SELECT = `select id, product_id, name, unit_price, qty, modifiers, note, station, tax_rate, status, round, courtesy, source,
  sent_at, ready_at, delivered_at, void_reason, created_at, allergy, held, seat, voided_at from check_items`;

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
  /** Retenidos: esperan a que el mesero los mande */
  held: number;
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
      held: mine.filter((i) => i.status === "draft" && i.held).reduce((n, i) => n + i.qty, 0),
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
  /** Cuentas aparte de la misma mesa */
  splits: CheckSummary[];
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
    db.query<Omit<TableView, "check" | "splits">>("select id, name, seats, x, y, shape, zone_id, qr_token from floor_tables where business_id = $1 and active order by zone_id, name", [bizId]),
    openChecks(bizId),
    pendingRequests(bizId),
  ]);
  // Cada mesa: su cuenta principal y, si las hay, las cuentas aparte
  const atTable = new Map<string, CheckSummary[]>();
  for (const c of checks) if (c.table_id) atTable.set(c.table_id, [...(atTable.get(c.table_id) ?? []), c]);
  const view = (t: Omit<TableView, "check" | "splits">): TableView => {
    const list = atTable.get(t.id) ?? [];
    const main = list.find((c) => !c.split_of) ?? list[0] ?? null;
    return { ...t, check: main, splits: list.filter((c) => c !== main) };
  };
  return {
    zones,
    tables: tables.map(view),
    others: checks.filter((c) => !c.table_id && c.kind !== "domicilio"),
    deliveries: checks.filter((c) => c.kind === "domicilio").length,
    checks,
    requests,
  };
}

interface LockedCheck {
  id: string;
  status: string;
  number: number;
  discount_pct: number;
  discount_reason: string | null;
  kind: CheckRow["kind"];
  table_id: string | null;
  split_of: string | null;
  opened_by: string | null;
  guests: number;
  name: string;
  customer_id: string | null;
}

const LOCKED_COLUMNS = "id, status, number, discount_pct, discount_reason, kind, table_id, split_of, opened_by, guests, name, customer_id";

async function editableCheck(tx: Tx, bizId: string, checkId: string) {
  if (!UUID.test(String(checkId))) throw new UserError("Cuenta no encontrada");
  const check = await tx.one<LockedCheck>(`select ${LOCKED_COLUMNS} from checks where id = $1 and business_id = $2 for update`, [checkId, bizId]);
  if (!check) throw new UserError("Cuenta no encontrada");
  if (check.status === "merged") throw new UserError("Esta cuenta se unió a otra");
  if (isClosed(check.status)) throw new UserError("Esta cuenta ya está cerrada");
  return check;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function insertCheck(
  tx: Tx,
  bizId: string,
  c: { table_id: string | null; kind: CheckRow["kind"]; name: string; guests: number; opened_by: string | null; split_of: string | null; discount_pct?: number; discount_reason?: string | null },
) {
  const row = await tx.one<LockedCheck>(
    `insert into checks (business_id, number, table_id, kind, name, guests, opened_by, split_of, discount_pct, discount_reason)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning ${LOCKED_COLUMNS}`,
    [bizId, await nextNumber(tx, bizId, "check"), c.table_id, c.kind, c.name, c.guests, c.opened_by, c.split_of, c.discount_pct ?? 0, c.discount_reason ?? null],
  );
  return row!;
}

/**
 * La cuenta principal de una mesa se cerró (pagada, descartada o unida a otra) y quedan cuentas aparte: la más antigua
 * pasa a ser la principal y las demás quedan colgadas de ella. Se llama después de cerrar, en la misma transacción.
 */
export async function promoteSplit(tx: Tx, checkId: string): Promise<string | null> {
  const kids = await tx.query<{ id: string }>("select id from checks where split_of = $1 and status in ('open','bill') order by opened_at, id", [checkId]);
  const [first, ...rest] = kids;
  if (!first) return null;
  await tx.query("update checks set split_of = null, name = case when kind = 'mesa' then '' else name end where id = $1", [first.id]);
  if (rest.length) await tx.query("update checks set split_of = $1 where id = any($2::uuid[])", [first.id, rest.map((k) => k.id)]);
  // La mesa sigue ocupada: lo que pidieron desde el QR y aún espera pasa a la cuenta que queda
  await tx.query("update requests set check_id = $2 where check_id = $1 and status = 'pending'", [checkId, first.id]);
  return first.id;
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
      const existing = await tx.one<{ id: string }>("select id from checks where table_id = $1 and status in ('open','bill') and split_of is null", [input.tableId]);
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
        "select id, qty from check_items where check_id = $1 and status = 'draft' and product_id = $2 and modifiers = $3::jsonb and note = $4 and unit_price = $5 and not held and not allergy and seat is null",
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

export interface DraftPatch {
  qty?: number;
  note?: string;
  allergy?: boolean;
  seat?: number | null;
  held?: boolean;
  /** Opciones elegidas otra vez (ids de la carta): se recalcula el precio */
  modifierIds?: string[];
}

/** Cambia un producto que aún no se envía: cantidad, nota, alergia, puesto, retenido u opciones. Cantidad 0 lo quita. */
export async function changeDraft(staff: Staff, itemId: string, patch: DraftPatch) {
  // La carta se carga antes de la transacción: adentro solo se usa tx (PGlite tiene una sola conexión)
  const menu = Array.isArray(patch.modifierIds) ? await loadMenu(staff.business_id) : null;
  const db = await getDb();
  await db.tx(async (tx) => {
    if (!UUID.test(String(itemId))) throw new UserError("Ítem no encontrado");
    // Primero la cuenta y después el producto, en el mismo orden que enviar o anular: dos tablets a la vez no se traban
    const owner = await tx.one<{ check_id: string }>("select check_id from check_items where id = $1 and business_id = $2", [itemId, staff.business_id]);
    if (!owner) throw new UserError("Ítem no encontrado");
    await editableCheck(tx, staff.business_id, owner.check_id);
    const item = await tx.one<{ check_id: string; status: string; product_id: string | null; note: string; allergy: boolean; held: boolean }>(
      "select check_id, status, product_id, note, allergy, held from check_items where id = $1 and check_id = $2 for update",
      [itemId, owner.check_id],
    );
    if (!item) throw new UserError("Ese producto ya cambió de cuenta: vuelve a intentarlo");
    if (item.status !== "draft") throw new UserError("Ya se envió: para quitarlo, anúlalo");
    if (patch.qty !== undefined && patch.qty <= 0) {
      await tx.query("delete from check_items where id = $1", [itemId]);
      if (item.held) await bump(tx, staff.business_id);
      return;
    }
    const note = patch.note !== undefined ? String(patch.note).trim().slice(0, 140) : item.note;
    const allergy = patch.allergy !== undefined ? !!patch.allergy : item.allergy;
    if (allergy && note.length < 3) throw new UserError("Escribe en la nota a qué es la alergia: así barra y cocina saben qué cuidar");
    const seat = patch.seat === undefined || patch.seat === null ? null : Math.floor(Number(patch.seat));
    if (seat !== null && !(seat >= 1 && seat <= 40)) throw new UserError("El puesto va del 1 al 40");
    const sets: string[] = [];
    const values: unknown[] = [itemId];
    const set = (column: string, value: unknown, cast = "") => {
      values.push(value);
      sets.push(`${column} = $${values.length}${cast}`);
    };
    if (patch.qty !== undefined) set("qty", Math.min(99, Math.max(1, Math.floor(Number(patch.qty) || 1))));
    if (patch.note !== undefined) set("note", note);
    if (patch.allergy !== undefined) set("allergy", allergy);
    if (patch.seat !== undefined) set("seat", seat);
    if (patch.held !== undefined) set("held", !!patch.held);
    if (menu) {
      if (!item.product_id) throw new UserError("Ese producto ya no está en la carta");
      const line = priceItem(menu, { productId: item.product_id, qty: 1, modifierIds: patch.modifierIds!.map(String), note });
      set("modifiers", JSON.stringify(line.modifiers), "::jsonb");
      set("unit_price", line.product.price);
    }
    if (sets.length) await tx.query(`update check_items set ${sets.join(", ")} where id = $1`, values);
    await tx.query("update checks set updated_at = now() where id = $1", [item.check_id]);
    // Lo retenido se ve en el salón: si cambia, las otras tablets se enteran
    if (patch.held !== undefined && !!patch.held !== item.held) await bump(tx, staff.business_id);
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

/**
 * Envía la ronda: lo que estaba en borrador pasa a barra y cocina y descuenta inventario. Lo retenido se queda;
 * con { held: true } se manda solo lo retenido, como su propia ronda (el plato fuerte después de la entrada).
 */
export async function sendRound(staff: Staff, checkId: string, opts: { held?: boolean } = {}) {
  const held = !!opts.held;
  const db = await getDb();
  return db.tx(async (tx) => {
    const check = await editableCheck(tx, staff.business_id, checkId);
    const drafts = await tx.query<{ id: string; product_id: string | null; qty: number; station: string }>(
      "select id, product_id, qty, station from check_items where check_id = $1 and status = 'draft' and held = $2",
      [checkId, held],
    );
    if (!drafts.length) throw new UserError(held ? "No hay nada retenido" : "No hay nada nuevo para enviar");
    const round = await tx.one<{ r: number }>("select coalesce(max(round), 0) + 1 as r from check_items where check_id = $1", [checkId]);
    await tx.query("update check_items set status = 'sent', held = false, round = $2, sent_at = now() where id = any($1::uuid[])", [drafts.map((d) => d.id), round!.r]);
    await tx.query("update checks set status = 'open', updated_at = now() where id = $1", [checkId]);
    await moveStock(tx, staff.business_id, drafts, -1, "venta", `Cuenta ${check.number}`, staff.id);
    await bump(tx, staff.business_id);
    const stations = [...new Set(drafts.map((d) => d.station))];
    return { count: drafts.length, stations, round: round!.r };
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
    // voided_at: barra y cocina lo ven en rojo hasta marcarlo como visto (si aún no se había entregado)
    await tx.query("update check_items set status = 'void', void_reason = $2, void_by = $3, void_waste = $4, voided_at = now() where id = $1", [itemId, reason, who.id, input.waste]);
    if (!input.waste) await moveStock(tx, staff.business_id, [item], 1, "anulacion", `Cuenta ${check.number}`, staff.id);
    await assertNotOverpaid(tx, staff.business_id, item.check_id);
    await reopenBag(tx, staff.business_id, item.check_id, staff.id);
    await audit(tx, staff.business_id, staff.id, "void", { item: item.name, qty: item.qty, check: check.number, reason, authorizedBy: who.name, waste: input.waste }, amount);
    await bump(tx, staff.business_id);
    return { alert: amount >= biz.settings.alerts.voidLimit };
  });
}

/** Da o quita una cortesía. Darla pide el motivo (de la lista del local o escrito) y la autoriza el dueño o la administración. */
export async function toggleCourtesy(staff: Staff, itemId: string, input: { reason?: string; auth?: AuthInput | null } = {}) {
  const reason = (input.reason ?? "").trim().slice(0, 120);
  const authorizedBy = await verifyAuthorizer(staff, input.auth, "manage");
  const db = await getDb();
  await db.tx(async (tx) => {
    const item = await tx.one<{ check_id: string; courtesy: boolean; name: string; unit_price: number; qty: number; status: string; modifiers: Mod[] }>(
      "select check_id, courtesy, name, unit_price, qty, status, modifiers from check_items where id = $1 and business_id = $2",
      [itemId, staff.business_id],
    );
    if (!item || item.status === "void") throw new UserError("Ítem no encontrado");
    // El motivo va antes que la autorización: nadie pone su PIN para que después falte el motivo
    if (!item.courtesy && reason.length < 3) throw new UserError("Elige o escribe el motivo de la cortesía");
    const check = await editableCheck(tx, staff.business_id, item.check_id);
    const who = requireAuth(!can.manage(staff), staff, authorizedBy, "manage");
    await tx.query("update check_items set courtesy = not courtesy where id = $1", [itemId]);
    await assertNotOverpaid(tx, staff.business_id, item.check_id);
    const amount = (item.unit_price + item.modifiers.reduce((s, m) => s + m.price, 0)) * item.qty;
    await audit(
      tx,
      staff.business_id,
      staff.id,
      item.courtesy ? "courtesy_off" : "courtesy",
      { checkId: item.check_id, item: item.name, check: check.number, authorizedBy: who.name, ...(item.courtesy ? {} : { reason }) },
      amount,
    );
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
    await audit(tx, staff.business_id, staff.id, "discount", { checkId, check: check.number, pct, from: before, reason, authorizedBy: who.name }, after?.totals.discount ?? 0);
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
    if (patch.tableId && patch.tableId !== current.table_id) {
      if (current.kind === "domicilio") throw new UserError("Un domicilio no se puede pasar a una mesa");
      if (!UUID.test(patch.tableId)) throw new UserError("Mesa no encontrada");
      const table = await tx.one<{ name: string }>("select name from floor_tables where id = $1 and business_id = $2 and active for update", [patch.tableId, staff.business_id]);
      if (!table) throw new UserError("Mesa no encontrada");
      const busy = await tx.one("select 1 from checks where table_id = $1 and status in ('open','bill') and split_of is null and id <> $2", [patch.tableId, checkId]);
      if (busy) throw new UserError("Esa mesa ya tiene una cuenta abierta: para juntarlas, usa Unir otra cuenta");
      const before = current.table_id ? await tx.one<{ name: string }>("select name from floor_tables where id = $1", [current.table_id]) : null;
      if (current.split_of) {
        // Una cuenta aparte que se va a otra mesa queda como la cuenta de esa mesa
        await tx.query("update checks set table_id = $2, kind = 'mesa', split_of = null, name = '' where id = $1", [checkId, patch.tableId]);
      } else {
        await tx.query("update checks set table_id = $2, kind = 'mesa' where id = $1", [checkId, patch.tableId]);
        // Las cuentas aparte de la mesa se van con ella
        await tx.query("update checks set table_id = $2 where split_of = $1 and status in ('open','bill')", [checkId, patch.tableId]);
      }
      await audit(tx, staff.business_id, staff.id, "table_changed", { checkId, check: current.number, from: before?.name ?? null, to: table.name });
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
    // Si quedan cuentas aparte en la mesa, la más antigua la toma junto con lo que espera del QR; si no, eso se da por atendido
    await promoteSplit(tx, checkId);
    await tx.query("update requests set status = 'done', handled_by = $2, handled_at = now() where check_id = $1 and status = 'pending'", [checkId, staff.id]);
    await audit(tx, staff.business_id, staff.id, "discard", { check: check.number, drafts: drafts.length });
    await bump(tx, staff.business_id);
  });
}

/* ---------- Acciones de la cuenta: repetir, mover, separar, unir y cambiar de mesero ---------- */

/** La opción guardada, al precio y nombre de hoy si sigue en la carta. */
function currentMods(menu: Menu, mods: Mod[]): Mod[] {
  return mods.map((m) => {
    const option = m.id ? Object.values(menu.groups).flatMap((g) => g.options.map((o) => ({ ...o, group: g.name }))).find((o) => o.id === m.id) : null;
    return option ? { name: option.name, price: option.price, id: option.id, group: option.group } : m;
  });
}

/** Otra ronda igual: lo de esa ronda (sin lo anulado) vuelve a "Por enviar" al precio de hoy, para revisarlo y enviarlo. */
export async function repeatRound(staff: Staff, checkId: string, round: number) {
  if (!Number.isInteger(Number(round)) || Number(round) < 1) throw new UserError("Elige una ronda enviada");
  const menu = await loadMenu(staff.business_id);
  const db = await getDb();
  return db.tx(async (tx) => {
    await editableCheck(tx, staff.business_id, checkId);
    const lines = await tx.query<{ product_id: string | null; name: string; qty: number; modifiers: Mod[]; note: string; allergy: boolean; seat: number | null }>(
      "select product_id, name, qty, modifiers, note, allergy, seat from check_items where check_id = $1 and round = $2 and status in ('sent','ready','delivered') order by created_at, id",
      [checkId, Math.floor(Number(round))],
    );
    if (!lines.length) throw new UserError("Esa ronda no tiene productos para repetir");
    let units = 0;
    const missing: string[] = [];
    for (const l of lines) {
      const p = l.product_id ? menu.products.find((x) => x.id === l.product_id) : undefined;
      if (!p || p.soldOut) {
        missing.push(l.name);
        continue;
      }
      await tx.query(
        `insert into check_items (business_id, check_id, product_id, name, unit_price, qty, modifiers, note, station, tax_rate, added_by, allergy, seat)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13)`,
        [staff.business_id, checkId, p.id, p.name, p.price, l.qty, JSON.stringify(currentMods(menu, l.modifiers)), l.note, p.station, p.taxRate, staff.id, l.allergy, l.seat],
      );
      units += l.qty;
    }
    if (!units) throw new UserError(`No se puede repetir: ${missing.join(", ")} ya no ${missing.length > 1 ? "están" : "está"} disponible${missing.length > 1 ? "s" : ""}`);
    await tx.query("update checks set updated_at = now() where id = $1", [checkId]);
    // Un domicilio ya empacado que recibe algo más se revisa otra vez
    await reopenBag(tx, staff.business_id, checkId, staff.id);
    return { units, missing };
  });
}

/** A dónde van los productos: otra cuenta abierta, una mesa libre o una cuenta aparte en la misma mesa. */
export type MoveTarget = { checkId: string } | { tableId: string } | { split: true };

/**
 * Mueve productos (todos o parte de una línea) a otra cuenta. Lo enviado no vuelve a barra y cocina: llega a la otra
 * cuenta como rondas nuevas (o con su número, si la cuenta es nueva) y el inventario no se toca. Si la cuenta de origen
 * queda vacía y sin pagos, se cierra sola; si era la principal de la mesa, la reemplaza la cuenta aparte más antigua.
 */
export async function moveItems(staff: Staff, fromId: string, input: { items: { id: string; qty: number }[]; to: MoveTarget }) {
  const wanted = new Map<string, number>();
  for (const it of (Array.isArray(input?.items) ? input.items : []).slice(0, 80)) {
    const qty = Math.floor(Number(it?.qty));
    if (typeof it?.id === "string" && UUID.test(it.id) && qty > 0) wanted.set(it.id, Math.min(99, (wanted.get(it.id) ?? 0) + qty));
  }
  if (!wanted.size) throw new UserError("Elige qué productos mover");
  const target = (input?.to && typeof input.to === "object" ? input.to : {}) as MoveTarget;
  const fromKey = String(fromId).toLowerCase();
  const targetKey = "checkId" in target ? String(target.checkId).toLowerCase() : null;
  if (!UUID.test(fromKey) || (targetKey !== null && !UUID.test(targetKey))) throw new UserError("Cuenta no encontrada");
  const db = await getDb();
  return db.tx(async (tx) => {
    // Orden de bloqueo: la principal de la familia primero (como al cobrarla) y después las cuentas por id.
    // Así dos movimientos al revés, o uno mientras se cobra la principal, no se traban.
    const peek = await tx.one<{ split_of: string | null }>("select split_of from checks where id = $1 and business_id = $2", [fromKey, staff.business_id]);
    if (!peek) throw new UserError("Cuenta no encontrada");
    if (peek.split_of && "split" in target) await tx.query("select id from checks where id = $1 for update", [peek.split_of]);
    const locked = new Map<string, LockedCheck>();
    for (const id of [...new Set([fromKey, ...(targetKey ? [targetKey] : [])])].sort()) locked.set(id, await editableCheck(tx, staff.business_id, id));
    const from = locked.get(fromKey)!;
    if (from.split_of !== peek.split_of) throw new UserError("La cuenta cambió mientras tanto: vuelve a intentarlo");
    if (from.kind === "domicilio") throw new UserError("Los productos de un domicilio no se pasan a otra cuenta");
    const rows = await tx.query<{ id: string; name: string; qty: number; round: number }>(
      "select id, name, qty, round from check_items where check_id = $1 and id = any($2::uuid[]) and status <> 'void' order by created_at, id for update",
      [from.id, [...wanted.keys()]],
    );
    if (rows.length !== wanted.size) throw new UserError("Algunos productos ya no están en esta cuenta: revisa y vuelve a intentar");
    for (const r of rows) if (wanted.get(r.id)! > r.qty) throw new UserError(`De ${r.name} solo hay ${r.qty}`);

    let to: LockedCheck;
    let fresh = false;
    if (targetKey) {
      to = locked.get(targetKey)!;
      if (to.id === from.id) throw new UserError("Elige otra cuenta");
      if (to.kind === "domicilio") throw new UserError("A un domicilio no se le pasan productos del salón");
      // Un descuento no se gana ni se pierde pasando productos: las dos cuentas deben tener el mismo
      if (to.discount_pct !== from.discount_pct) {
        throw new UserError(`Las cuentas tienen descuentos distintos (${from.discount_pct} % y ${to.discount_pct} %): ponles el mismo antes de pasar productos`);
      }
    } else if ("tableId" in target) {
      if (!UUID.test(String(target.tableId))) throw new UserError("Mesa no encontrada");
      const table = await tx.one("select 1 from floor_tables where id = $1 and business_id = $2 and active for update", [target.tableId, staff.business_id]);
      if (!table) throw new UserError("Mesa no encontrada");
      if (await tx.one("select 1 from checks where table_id = $1 and status in ('open','bill') and split_of is null", [target.tableId])) {
        throw new UserError("Esa mesa ya tiene cuenta: elígela en Otra cuenta");
      }
      to = await insertCheck(tx, staff.business_id, {
        table_id: target.tableId,
        kind: "mesa",
        name: "",
        guests: 1,
        opened_by: from.opened_by ?? staff.id,
        split_of: null,
        // El descuento autorizado viaja con los productos
        discount_pct: from.discount_pct,
        discount_reason: from.discount_reason,
      });
      fresh = true;
    } else if ("split" in target && target.split) {
      // La cuenta aparte cuelga de la principal de la mesa y lleva el siguiente número libre (Cuenta 2, Cuenta 3…)
      const root = from.split_of ?? from.id;
      const family = await tx.query<{ name: string }>("select name from checks where id = $1 or split_of = $1", [root]);
      const n = Math.max(1, ...family.map((f) => Number(/(?:Cuenta |\()(\d+)\)?$/.exec(f.name)?.[1] ?? 1))) + 1;
      const base = from.name.replace(/ \(\d+\)$/, "");
      const name = from.kind === "mesa" ? `Cuenta ${n}` : `${base || "Cuenta"} (${n})`.slice(0, 40);
      to = await insertCheck(tx, staff.business_id, {
        table_id: from.table_id,
        kind: from.kind,
        name,
        guests: 1,
        opened_by: from.opened_by ?? staff.id,
        split_of: root,
        // El descuento de la mesa (cliente frecuente, convenio) sigue en cada parte
        discount_pct: from.discount_pct,
        discount_reason: from.discount_reason,
      });
      fresh = true;
    } else throw new UserError("Elige a dónde mover los productos");

    // En una cuenta que ya existe, lo enviado entra como rondas nuevas: barra y cocina no mezclan tiquetes de dos cuentas
    const rounds = [...new Set(rows.filter((r) => r.round > 0).map((r) => r.round))].sort((a, b) => a - b);
    const top = fresh ? 0 : ((await tx.one<{ r: number }>("select coalesce(max(round), 0) as r from check_items where check_id = $1", [to.id]))?.r ?? 0);
    const roundOf = new Map(rounds.map((r, i) => [r, fresh ? r : top + i + 1]));
    for (const r of rows) {
      const qty = wanted.get(r.id)!;
      const round = r.round > 0 ? roundOf.get(r.round)! : 0;
      if (qty === r.qty) {
        await tx.query("update check_items set check_id = $2, round = $3 where id = $1", [r.id, to.id, round]);
      } else {
        await tx.query("update check_items set qty = qty - $2 where id = $1", [r.id, qty]);
        await tx.query(
          `insert into check_items (business_id, check_id, product_id, name, unit_price, qty, modifiers, note, station, tax_rate, status, round, courtesy, source,
                                    added_by, sent_at, ready_at, delivered_at, allergy, held, seat, created_at)
           select business_id, $2, product_id, name, unit_price, $3, modifiers, note, station, tax_rate, status, $4, courtesy, source,
                  added_by, sent_at, ready_at, delivered_at, allergy, held, seat, created_at
             from check_items where id = $1`,
          [r.id, to.id, qty, round],
        );
      }
    }
    await assertNotOverpaid(tx, staff.business_id, from.id);
    // La pre-cuenta de las dos ya no sirve: el total cambió
    await tx.query("update checks set status = 'open', updated_at = now() where id = any($1::uuid[])", [[from.id, to.id]]);

    const empty = !(await tx.one("select 1 from check_items where check_id = $1 and status <> 'void'", [from.id]));
    const paid = await tx.one("select 1 from payments where check_id = $1 and status in ('ok','pending')", [from.id]);
    const closed = empty && !paid;
    if (closed) {
      await tx.query("update checks set status = 'void', closed_at = now(), closed_by = $2 where id = $1", [from.id, staff.id]);
      // Si quedan cuentas aparte, la más antigua toma la mesa (y lo que esperaba del QR); si no, lo pendiente va con los productos
      if (!(await promoteSplit(tx, from.id))) {
        await tx.query("update requests set check_id = $2, table_id = coalesce($3, table_id) where check_id = $1 and status = 'pending'", [from.id, to.id, to.table_id]);
      }
    }
    await audit(tx, staff.business_id, staff.id, "items_moved", {
      checkId: from.id,
      toId: to.id,
      check: from.number,
      to: to.number,
      split: "split" in target,
      items: rows.map((r) => `${wanted.get(r.id)} ${r.name}`),
    });
    await bump(tx, staff.business_id);
    return { id: to.id, number: to.number, name: to.name, closed };
  });
}

/**
 * Une otra cuenta a esta: sus productos llegan como rondas nuevas, se suman las personas y la otra queda unida
 * (ya no se cobra). No se unen cuentas con pagos ni con descuentos distintos.
 */
export async function mergeChecks(staff: Staff, intoId: string, fromId: string) {
  const intoKey = String(intoId).toLowerCase();
  const fromKey = String(fromId).toLowerCase();
  if (intoKey === fromKey) throw new UserError("Elige otra cuenta");
  const db = await getDb();
  await db.tx(async (tx) => {
    // Siempre en el mismo orden: dos tablets uniendo al revés no se traban
    const locked = new Map<string, LockedCheck>();
    for (const id of [intoKey, fromKey].sort()) locked.set(id, await editableCheck(tx, staff.business_id, id));
    const into = locked.get(intoKey)!;
    const from = locked.get(fromKey)!;
    if (into.id === from.id) throw new UserError("Elige otra cuenta");
    if (into.kind === "domicilio" || from.kind === "domicilio") throw new UserError("Los domicilios no se unen con otras cuentas");
    if (await tx.one("select 1 from payments where check_id = $1 and status in ('ok','pending')", [from.id])) {
      throw new UserError(`La cuenta #${from.number} ya tiene pagos: cóbrala aparte o quita esos pagos antes de unirla`);
    }
    // Un descuento no se extiende ni se pierde al unir: las dos cuentas deben tener el mismo
    if (from.discount_pct !== into.discount_pct) {
      throw new UserError(`Las cuentas tienen descuentos distintos (${into.discount_pct} % y ${from.discount_pct} %): ponles el mismo antes de unirlas`);
    }
    const top = (await tx.one<{ r: number }>("select coalesce(max(round), 0) as r from check_items where check_id = $1", [into.id]))!.r;
    const moved = await tx.query<{ id: string }>(
      "update check_items set check_id = $2, round = case when round > 0 then round + $3 else 0 end where check_id = $1 returning id",
      [from.id, into.id, top],
    );
    await tx.query("update checks set guests = least(40, guests + $2), customer_id = coalesce(customer_id, $3), status = 'open', updated_at = now() where id = $1", [
      into.id,
      from.guests,
      from.customer_id,
    ]);
    await tx.query("update checks set status = 'merged', merged_into = $2, closed_at = now(), closed_by = $3, updated_at = now() where id = $1", [from.id, into.id, staff.id]);
    // Si la otra era la principal de su mesa y quedan cuentas aparte allá, la más antigua toma esa mesa y lo que esperaba del QR;
    // si no, lo pendiente del QR viene con los productos a esta cuenta
    if (!(await promoteSplit(tx, from.id))) {
      await tx.query("update requests set check_id = $2, table_id = coalesce($3, table_id) where check_id = $1 and status = 'pending'", [from.id, into.id, into.table_id]);
    }
    await audit(tx, staff.business_id, staff.id, "checks_merged", { checkId: into.id, fromId: from.id, check: into.number, from: from.number, items: moved.length });
    await bump(tx, staff.business_id);
  });
}

/** Personas que pueden llevar una cuenta (todos menos barra y cocina). */
export async function staffOptions(bizId: string) {
  const db = await getDb();
  return db.query<{ id: string; name: string; role: string; color: string }>(
    "select id, name, role, color from staff where business_id = $1 and active and role <> 'bar' order by name",
    [bizId],
  );
}

/** Pasa la cuenta a otra persona (fin de turno, cambio de zona). Quien la lleva o el encargado lo hacen; si no, autoriza el encargado. */
export async function changeWaiter(staff: Staff, checkId: string, input: { staffId: string; auth?: AuthInput | null }) {
  const authorizedBy = await verifyAuthorizer(staff, input.auth, "manage");
  const db = await getDb();
  await db.tx(async (tx) => {
    const check = await editableCheck(tx, staff.business_id, checkId);
    if (!UUID.test(String(input.staffId))) throw new UserError("Elige a alguien del equipo de esta sede");
    const next = await tx.one<{ id: string; name: string }>("select id, name from staff where id = $1 and business_id = $2 and active and role <> 'bar'", [
      input.staffId,
      staff.business_id,
    ]);
    if (!next) throw new UserError("Elige a alguien del equipo de esta sede");
    if (next.id === check.opened_by) return;
    const who = requireAuth(!can.manage(staff) && check.opened_by !== staff.id, staff, authorizedBy, "manage");
    const before = check.opened_by ? await tx.one<{ name: string }>("select name from staff where id = $1", [check.opened_by]) : null;
    await tx.query("update checks set opened_by = $2, updated_at = now() where id = $1", [checkId, next.id]);
    await audit(tx, staff.business_id, staff.id, "waiter_changed", { checkId, check: check.number, from: before?.name ?? null, to: next.name, authorizedBy: who.name });
    await bump(tx, staff.business_id);
  });
}

/* ---------- Pantalla de barra y cocina ---------- */

export interface TicketItem {
  id: string;
  name: string;
  qty: number;
  modifiers: Mod[];
  note: string;
  status: string;
  source: string;
  ficha: string | null;
  allergy: boolean;
  seat: number | null;
}

export interface Ticket {
  key: string;
  checkId: string;
  label: string;
  waiter: string | null;
  round: number;
  station: string;
  sentAt: string;
  items: TicketItem[];
  /** mesa, barra, llevar o domicilio: el borde del tiquete cambia con el tipo */
  kind: CheckRow["kind"];
  /** Pedido de domicilio: canal para el color del tiquete */
  channel: string | null;
  /** Domicilio: cuándo llega el domiciliario, para que la cocina priorice */
  riderAt: string | null;
  /** La cuenta ya se pagó (mostrador, plataforma): no hay que esperar a que pague para entregar */
  paid: boolean;
  guests: number;
  /** Lo que esa cuenta tiene retenido en esta estación: sale después, pero ya se puede ir alistando */
  held: { name: string; qty: number }[];
  /** La cuenta cambió de mesa hace poco: de cuál venía, para que nadie lleve el plato a la mesa vieja */
  movedFrom: string | null;
}

/** Algo que barra o cocina ya tenía en pantalla y se anuló: se ve en rojo hasta que alguien lo marca como visto. */
export interface VoidNotice {
  id: string;
  checkId: string;
  label: string;
  station: string;
  round: number;
  name: string;
  qty: number;
  modifiers: Mod[];
  reason: string;
  by: string | null;
  at: string;
  /** Ya estaba listo en el pase: hay que retirarlo */
  wasReady: boolean;
}

const GRAMS = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });

export async function kdsBoard(bizId: string, station: string | null) {
  const db = await getDb();
  const params = station ? [bizId, station] : [bizId];
  const [rows, heldRows, voidRows, avg, moves] = await Promise.all([
    db.query<
      CheckItem & {
        check_id: string;
        kind: CheckRow["kind"];
        channel: string;
        delivery: Delivery | null;
        check_status: CheckRow["status"];
        guests: number;
        table_name: string | null;
        check_name: string;
        number: number;
        waiter: string | null;
        ficha: { q: number; u: string; n: string }[] | null;
      }
    >(
      `select i.id, i.check_id, i.name, i.qty, i.modifiers, i.note, i.status, i.round, i.station, i.sent_at, i.ready_at, i.source, i.allergy, i.seat,
              c.kind, c.channel, c.delivery, c.status as check_status, c.guests, t.name as table_name, c.name as check_name, c.number, s.name as waiter,
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
        -- Dentro del tiquete, por puesto: así se arma el plato de cada quien
        order by i.sent_at, i.round, i.seat nulls last, i.created_at, i.id`,
      params,
    ),
    db.query<{ check_id: string; station: string; name: string; qty: number }>(
      `select i.check_id, i.station, i.name, sum(i.qty)::int as qty
         from check_items i join checks c on c.id = i.check_id
        where i.business_id = $1 and i.status = 'draft' and i.held and c.status in ('open','bill') ${station ? "and i.station = $2" : ""}
        group by i.check_id, i.station, i.name
        order by i.name`,
      params,
    ),
    // Lo anulado que barra o cocina ya tenía (enviado y sin entregar) y nadie ha marcado como visto
    db.query<{
      id: string;
      check_id: string;
      round: number;
      station: string;
      name: string;
      qty: number;
      modifiers: Mod[];
      void_reason: string | null;
      voided_at: string;
      ready_at: string | null;
      by_name: string | null;
      kind: CheckRow["kind"];
      channel: string;
      delivery: Delivery | null;
      table_name: string | null;
      check_name: string;
      number: number;
    }>(
      `select i.id, i.check_id, i.round, i.station, i.name, i.qty, i.modifiers, i.void_reason, i.voided_at, i.ready_at, v.name as by_name,
              c.kind, c.channel, c.delivery, t.name as table_name, c.name as check_name, c.number
         from check_items i
         join checks c on c.id = i.check_id
         left join floor_tables t on t.id = c.table_id
         left join staff v on v.id = i.void_by
        where i.business_id = $1 and i.status = 'void' and i.voided_at > now() - interval '3 hours' and i.void_seen_at is null
          and i.sent_at is not null and i.delivered_at is null ${station ? "and i.station = $2" : ""}
        order by i.voided_at desc
        limit 20`,
      params,
    ),
    db.one<{ m: number | null }>(
      `select round(avg(extract(epoch from (ready_at - sent_at)) / 60)::numeric, 1) as m from check_items
        where business_id = $1 and ready_at > now() - interval '3 hours' and sent_at is not null ${station ? "and station = $2" : ""}`,
      params,
    ),
    // Cambios de mesa de los últimos 20 minutos: el tiquete dice de qué mesa venía
    db.query<{ check_id: string; from_table: string | null }>(
      `select distinct on (detail->>'checkId') detail->>'checkId' as check_id, detail->>'from' as from_table
         from audit_log
        where business_id = $1 and action = 'table_changed' and created_at > now() - interval '20 minutes'
        order by detail->>'checkId', created_at desc`,
      [bizId],
    ),
  ]);
  const movedFrom = new Map(moves.filter((m) => m.from_table).map((m) => [m.check_id, m.from_table]));
  const tickets = new Map<string, Ticket>();
  for (const r of rows) {
    const key = `${r.check_id}:${r.round}:${r.station}`;
    const t = tickets.get(key) ?? {
      key,
      checkId: r.check_id,
      label: checkLabel({ kind: r.kind, table_name: r.table_name, name: r.check_name, number: r.number, channel: r.channel, delivery: r.delivery }),
      kind: r.kind,
      channel: r.kind === "domicilio" ? r.channel : null,
      riderAt: r.kind === "domicilio" ? (r.delivery?.riderAt ?? null) : null,
      paid: r.check_status === "paid",
      guests: r.guests,
      waiter: r.waiter,
      round: r.round,
      station: r.station,
      sentAt: r.sent_at!,
      items: [],
      held: [],
      movedFrom: movedFrom.get(r.check_id) ?? null,
    };
    // Los gramajes se escriben aquí y no en SQL: 22,5 g sale como 22,5 (no como 23)
    const ficha = r.ficha?.length ? r.ficha.map((x) => `${GRAMS.format(Number(x.q))} ${x.u} ${x.n}`).join(" · ") : null;
    t.items.push({ id: r.id, name: r.name, qty: r.qty, modifiers: r.modifiers, note: r.note, status: r.status, source: r.source, ficha, allergy: r.allergy, seat: r.seat });
    tickets.set(key, t);
  }
  const all = [...tickets.values()];
  // Lo retenido va en el último tiquete de esa cuenta en la estación que aún se ve (en preparación o listo)
  for (const h of heldRows) {
    const last = all
      .filter((t) => t.checkId === h.check_id && t.station === h.station && t.items.some((i) => i.status !== "delivered"))
      .sort((a, b) => b.round - a.round)[0];
    last?.held.push({ name: h.name, qty: h.qty });
  }
  const active = all.filter((t) => t.items.some((i) => i.status === "sent"));
  const ready = all.filter((t) => !t.items.some((i) => i.status === "sent") && t.items.some((i) => i.status === "ready"));
  const done = all.filter((t) => t.items.every((i) => i.status === "delivered"));
  const voids: VoidNotice[] = voidRows.map((v) => ({
    id: v.id,
    checkId: v.check_id,
    label: checkLabel({ kind: v.kind, table_name: v.table_name, name: v.check_name, number: v.number, channel: v.channel, delivery: v.delivery }),
    station: v.station,
    round: v.round,
    name: v.name,
    qty: v.qty,
    modifiers: v.modifiers,
    reason: v.void_reason ?? "",
    by: v.by_name,
    at: iso(v.voided_at)!,
    wasReady: !!v.ready_at,
  }));
  return { active, ready, done, voids, avgMinutes: avg?.m ? Number(avg.m) : null };
}

/** Barra o cocina vio la anulación: sale de la pantalla (queda en el historial de la cuenta). */
export async function kdsAckVoids(staff: Staff, itemIds: string[]) {
  const ids = (Array.isArray(itemIds) ? itemIds : []).filter((x) => typeof x === "string" && UUID.test(x)).slice(0, 50);
  if (!ids.length) return;
  const db = await getDb();
  await db.tx(async (tx) => {
    await tx.query("update check_items set void_seen_at = now() where id = any($1::uuid[]) and business_id = $2 and status = 'void' and void_seen_at is null", [ids, staff.business_id]);
    await bump(tx, staff.business_id);
  });
}

export interface KdsDetailItem {
  id: string;
  name: string;
  qty: number;
  modifiers: Mod[];
  note: string;
  station: string;
  status: CheckItem["status"];
  allergy: boolean;
  seat: number | null;
  source: string;
  voidReason: string | null;
  voidBy: string | null;
}

export interface KdsDetail {
  id: string;
  number: number;
  label: string;
  kind: CheckRow["kind"];
  channel: string;
  status: CheckRow["status"];
  waiter: string | null;
  guests: number;
  openedAt: string;
  /** Domicilio: código, notas del cliente y cuándo llega el domiciliario (sin celular ni dirección: la cocina no los necesita) */
  delivery: { code: string; notes: string | null; riderAt: string | null } | null;
  rounds: { round: number; sentAt: string | null; items: KdsDetailItem[] }[];
  held: KdsDetailItem[];
  events: { at: string; text: string; tone: "red" | "green" | null }[];
}

const STATION_IN: Record<string, string> = { barra: "en barra", cocina: "en cocina" };

/** Fecha de la base (Date o texto) a texto ISO. */
function iso(d: unknown): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : new Date(String(d)).toISOString();
}

/** Todo lo de una cuenta para barra y cocina: rondas, notas, alergias, puestos, lo retenido y lo que ha pasado. */
export async function kdsDetail(bizId: string, checkId: string): Promise<KdsDetail | null> {
  if (!UUID.test(String(checkId))) return null;
  const db = await getDb();
  const check = await db.one<CheckRow>(`${CHECK_SELECT} where c.id = $1 and c.business_id = $2`, [checkId, bizId]);
  if (!check) return null;
  const [items, log] = await Promise.all([
    db.query<{
      id: string;
      name: string;
      qty: number;
      modifiers: Mod[];
      note: string;
      station: string;
      status: CheckItem["status"];
      round: number;
      allergy: boolean;
      seat: number | null;
      held: boolean;
      source: string;
      sent_at: string | null;
      ready_at: string | null;
      delivered_at: string | null;
      voided_at: string | null;
      void_reason: string | null;
      void_by: string | null;
    }>(
      `select i.id, i.name, i.qty, i.modifiers, i.note, i.station, i.status, i.round, i.allergy, i.seat, i.held, i.source,
              i.sent_at, i.ready_at, i.delivered_at, i.voided_at, i.void_reason, v.name as void_by
         from check_items i left join staff v on v.id = i.void_by
        where i.check_id = $1 and i.business_id = $2 and (i.status <> 'draft' or i.held)
        order by i.round, i.seat nulls last, i.created_at, i.id`,
      [checkId, bizId],
    ),
    db.query<{ action: string; detail: Record<string, unknown>; created_at: string; who: string | null }>(
      `select a.action, a.detail, a.created_at, s.name as who from audit_log a left join staff s on s.id = a.staff_id
        where a.business_id = $1 and a.action = any($2::text[]) and a.created_at >= $3::timestamptz - interval '1 minute'
          and (a.detail->>'checkId' = $4 or a.detail->>'toId' = $4 or a.detail->>'fromId' = $4)
        order by a.created_at`,
      [bizId, ["items_moved", "checks_merged", "waiter_changed", "table_changed", "discount", "courtesy"], check.opened_at, checkId],
    ),
  ]);
  // pg y PGlite devuelven las fechas como Date: aquí se pasan a texto ISO para ordenarlas y compararlas
  for (const i of items) for (const k of ["sent_at", "ready_at", "delivered_at", "voided_at"] as const) i[k] = iso(i[k]);
  for (const a of log) a.created_at = iso(a.created_at)!;
  check.opened_at = iso(check.opened_at)!;
  check.closed_at = iso(check.closed_at);
  const toItem = (i: (typeof items)[number]): KdsDetailItem => ({
    id: i.id,
    name: i.name,
    qty: i.qty,
    modifiers: i.modifiers,
    note: i.note,
    station: i.station,
    status: i.status,
    allergy: i.allergy,
    seat: i.seat,
    source: i.source,
    voidReason: i.void_reason,
    voidBy: i.void_by,
  });
  const rounds = new Map<number, (typeof items)[number][]>();
  for (const i of items) if (i.status !== "draft") rounds.set(i.round, [...(rounds.get(i.round) ?? []), i]);

  const events: KdsDetail["events"] = [{ at: check.opened_at, text: check.waiter_name ? `Abrió ${check.waiter_name}` : "Se abrió desde el QR de la mesa", tone: null }];
  const latest = (xs: (string | null)[]) => xs.filter((x): x is string => !!x).sort().pop() ?? null;
  for (const [round, list] of [...rounds].sort((a, b) => a[0] - b[0])) {
    const live = list.filter((i) => i.status !== "void");
    const sentAt = list.map((i) => i.sent_at).filter((x): x is string => !!x).sort()[0];
    const units = list.reduce((n, i) => n + i.qty, 0);
    if (sentAt) events.push({ at: sentAt, text: `Ronda ${round} enviada${list.some((i) => i.source === "qr") ? " por QR" : ""}: ${units} ${units === 1 ? "producto" : "productos"}`, tone: null });
    for (const st of [...new Set(live.map((i) => i.station))]) {
      const mine = live.filter((i) => i.station === st);
      if (mine.every((i) => i.ready_at)) events.push({ at: latest(mine.map((i) => i.ready_at))!, text: `Ronda ${round} lista ${STATION_IN[st] ?? `en ${st}`}`, tone: "green" });
    }
    if (live.length && live.every((i) => i.status === "delivered")) events.push({ at: latest(live.map((i) => i.delivered_at)) ?? sentAt ?? check.opened_at, text: `Ronda ${round} entregada`, tone: null });
    for (const v of list.filter((i) => i.status === "void" && i.voided_at)) {
      events.push({ at: v.voided_at!, text: `Anulado ${v.qty} ${v.name}${v.void_reason ? `: ${v.void_reason}` : ""}${v.void_by ? ` (${v.void_by})` : ""}`, tone: "red" });
    }
  }
  for (const a of log) {
    const d = a.detail;
    const who = a.who ?? "Alguien";
    const items = Array.isArray(d.items) ? (d.items as string[]).join(", ") : "";
    if (a.action === "items_moved" && d.checkId === checkId) events.push({ at: a.created_at, text: `${who} pasó ${items} a la cuenta #${d.to}`, tone: null });
    else if (a.action === "items_moved") events.push({ at: a.created_at, text: `Llegó de la cuenta #${d.check}: ${items}`, tone: null });
    else if (a.action === "checks_merged" && d.checkId === checkId) events.push({ at: a.created_at, text: `${who} unió aquí la cuenta #${d.from}`, tone: null });
    else if (a.action === "checks_merged") events.push({ at: a.created_at, text: `Se unió a la cuenta #${d.check}`, tone: null });
    else if (a.action === "waiter_changed") events.push({ at: a.created_at, text: `Ahora la atiende ${d.to}`, tone: null });
    else if (a.action === "table_changed") events.push({ at: a.created_at, text: `Pasó a la mesa ${d.to}`, tone: null });
    else if (a.action === "discount" && Number(d.pct) > 0) events.push({ at: a.created_at, text: `Descuento del ${d.pct} %${d.reason ? `: ${d.reason}` : ""}`, tone: null });
    else if (a.action === "courtesy") events.push({ at: a.created_at, text: `Cortesía: ${d.item}${d.reason ? ` (${d.reason})` : ""}`, tone: "green" });
  }
  if (check.status === "paid" && check.closed_at) events.push({ at: check.closed_at, text: "Pagada", tone: "green" });
  if (check.status === "merged" && check.closed_at) events.push({ at: check.closed_at, text: "Se unió a otra cuenta", tone: null });
  events.sort((a, b) => a.at.localeCompare(b.at));

  return {
    id: check.id,
    number: check.number,
    label: checkLabel(check),
    kind: check.kind,
    channel: check.channel,
    status: check.status,
    waiter: check.waiter_name,
    guests: check.guests,
    openedAt: check.opened_at,
    delivery: check.kind === "domicilio" && check.delivery ? { code: check.delivery.code, notes: check.delivery.notes ?? null, riderAt: check.delivery.riderAt ?? null } : null,
    rounds: [...rounds].sort((a, b) => a[0] - b[0]).map(([round, list]) => ({ round, sentAt: list.map((i) => i.sent_at).filter((x): x is string => !!x).sort()[0] ?? null, items: list.map(toItem) })),
    held: items.filter((i) => i.status === "draft").map(toItem),
    events,
  };
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
    if (!check || check.status === "void" || check.status === "merged") throw new UserError("Esa cuenta ya no está");
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
