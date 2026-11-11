import "server-only";
import { type AccountingDoc, inventoryVariance } from "../core/accounting";
import { CONSUMIDOR_FINAL } from "../core/dian";
import type { DishSales } from "../core/menu-engineering";
import { splitTips, type TipSplit } from "../core/tips";
import { JORNADA_CUTOFF_HOUR, addDays, jornadaKey } from "../core/time";
import { totalsFor, type CheckItem } from "./checks";
import { getDb } from "./db";

// Hora de Bogotá a partir de un timestamptz, sin depender de la zona horaria de la sesión
const BOGOTA = (col: string) => `((${col} at time zone 'UTC') - interval '5 hours')`;
// Jornada: lo de antes de las 5:00 a. m. cuenta para el día anterior
export const JORNADA = (col: string) => `(((${col} at time zone 'UTC') - interval '${5 + JORNADA_CUTOFF_HOUR} hours')::date)`;

/** Inicio y fin de una jornada como instantes: los reportes filtran por rango y así usan los índices. */
export function jornadaRange(dayKey: string, days = 1) {
  const hh = String(JORNADA_CUTOFF_HOUR).padStart(2, "0");
  return { from: `${dayKey}T${hh}:00:00-05:00`, to: `${addDays(dayKey, days)}T${hh}:00:00-05:00` };
}

/**
 * Resumen de una jornada. Todas las cifras de ventas son netas (sin impuesto ni propina), igual que en
 * Rentabilidad y Cadena; el total con impuesto y las propinas van aparte y rotulados.
 */
export interface DayReport {
  dayKey: string;
  /** Ventas netas: sin impuesto ni propina (la base de las facturas) */
  net: number;
  /** Lo cobrado con impuesto, sin propina */
  gross: number;
  tax: number;
  tips: number;
  checks: number;
  guests: number;
  /** Ticket promedio sin impuesto */
  avgTicket: number;
  byHour: { hour: number; sales: number }[];
  /** Cómo pagaron: con impuesto (es lo que entra a cada medio) */
  byMethod: { method: string; amount: number; n: number }[];
  topProducts: { name: string; qty: number; revenue: number }[];
  byWaiter: { name: string; color: string | null; sales: number; checks: number; tips: number }[];
  voids: { n: number; amount: number; big: number; items: { detail: Record<string, unknown>; amount: number; staff: string | null; created_at: string }[] };
  courtesies: number;
  discounts: { n: number; amount: number };
  removed: { n: number; amount: number; items: { amount: number; method: string; reason: string | null; staff: string | null; at: string }[] };
  discards: { n: number; items: { check: number; staff: string | null; at: string }[] };
  qrShare: number;
  openNow: { n: number; amount: number };
}

export async function dayReport(bizId: string, dayKey = jornadaKey(), voidLimit = Number.POSITIVE_INFINITY): Promise<DayReport> {
  const db = await getDb();
  const { from, to } = jornadaRange(dayKey);
  const day = [bizId, from, to];
  const closed = "c.business_id = $1 and c.status = 'paid' and c.closed_at >= $2 and c.closed_at < $3";
  const totals = await db.one<{ net: number; gross: number; tax: number; tips: number; checks: number; guests: number }>(
    `select coalesce(sum(v.subtotal), 0)::int as net, coalesce(sum(v.total - v.tip), 0)::int as gross, coalesce(sum(v.tax), 0)::int as tax,
            coalesce(sum(v.tip), 0)::int as tips, count(distinct c.id)::int as checks, coalesce(sum(c.guests), 0)::int as guests
       from checks c left join invoices v on v.check_id = c.id and v.voided_at is null
      where ${closed}`,
    day,
  );
  const byHour = await db.query<{ hour: number; sales: number }>(
    `select extract(hour from ${BOGOTA("c.closed_at")})::int as hour, coalesce(sum(v.subtotal), 0)::int as sales
       from checks c join invoices v on v.check_id = c.id and v.voided_at is null
      where ${closed} group by 1 order by 1`,
    day,
  );
  const byMethod = await db.query<{ method: string; amount: number; n: number }>(
    `select p.method, sum(p.amount)::int as amount, count(*)::int as n from payments p join checks c on c.id = p.check_id
      where ${closed} and p.status = 'ok' group by 1 order by 2 desc`,
    day,
  );
  const top = await db.query<{ name: string; qty: number; revenue: number }>(
    `select i.name, sum(i.qty)::int as qty,
            round(sum((i.unit_price + coalesce((select sum((m->>'price')::int) from jsonb_array_elements(i.modifiers) m), 0)) * i.qty / (1 + i.tax_rate / 100)))::int as revenue
       from check_items i join checks c on c.id = i.check_id
      where ${closed} and i.status <> 'void' and not i.courtesy
      group by i.name order by revenue desc limit 8`,
    day,
  );
  const waiters = await db.query<{ name: string; color: string | null; sales: number; checks: number; tips: number }>(
    `select s.name, s.color, coalesce(sum(v.subtotal), 0)::int as sales, count(distinct c.id)::int as checks, coalesce(sum(v.tip), 0)::int as tips
       from checks c join staff s on s.id = c.opened_by left join invoices v on v.check_id = c.id and v.voided_at is null
      where ${closed} group by s.name, s.color order by 3 desc`,
    day,
  );
  const voids = await db.query<{ detail: Record<string, unknown>; amount: number; staff: string | null; created_at: string }>(
    `select a.detail, a.amount, s.name as staff, a.created_at from audit_log a left join staff s on s.id = a.staff_id
      where a.business_id = $1 and a.action = 'void' and a.created_at >= $2 and a.created_at < $3 order by a.created_at desc`,
    day,
  );
  // Cortesías y descuentos de lo que se cerró en la jornada (una cortesía que se quitó ya no suma)
  const items = await db.query<CheckItem & { check_id: string; discount_pct: number }>(
    `select i.check_id, i.unit_price, i.qty, i.modifiers, i.tax_rate, i.status, i.courtesy, c.discount_pct
       from check_items i join checks c on c.id = i.check_id where ${closed} and i.status <> 'void'`,
    day,
  );
  let courtesies = 0;
  const discounts = { n: 0, amount: 0 };
  const byCheck = new Map<string, typeof items>();
  for (const i of items) byCheck.set(i.check_id, [...(byCheck.get(i.check_id) ?? []), i]);
  for (const list of byCheck.values()) {
    courtesies += list.filter((i) => i.courtesy).reduce((s, i) => s + (i.unit_price + i.modifiers.reduce((a, m) => a + m.price, 0)) * i.qty, 0);
    const t = totalsFor(list, list[0]!.discount_pct);
    if (t.discount > 0) {
      discounts.n += 1;
      discounts.amount += t.discount;
    }
  }
  const removed = await db.query<{ amount: number; method: string; reason: string | null; staff: string | null; at: string }>(
    `select p.amount + p.tip as amount, p.method, p.removed_reason as reason, s.name as staff, p.removed_at as at
       from payments p left join staff s on s.id = p.removed_by
      where p.business_id = $1 and p.status = 'removed' and p.removed_at >= $2 and p.removed_at < $3 order by p.removed_at desc`,
    day,
  );
  const discards = await db.query<{ check: number; staff: string | null; at: string }>(
    `select (a.detail->>'check')::int as check, s.name as staff, a.created_at as at from audit_log a left join staff s on s.id = a.staff_id
      where a.business_id = $1 and a.action = 'discard' and a.created_at >= $2 and a.created_at < $3 order by a.created_at desc`,
    day,
  );
  const qr = await db.one<{ qr: number; total: number }>(
    `select coalesce(sum(i.qty) filter (where i.source = 'qr'), 0)::int as qr, coalesce(sum(i.qty), 0)::int as total
       from check_items i where i.business_id = $1 and i.status <> 'void' and i.created_at >= $2 and i.created_at < $3`,
    day,
  );
  const open = await db.query<CheckItem & { check_id: string; discount_pct: number }>(
    `select i.check_id, i.unit_price, i.qty, i.modifiers, i.tax_rate, i.status, i.courtesy, c.discount_pct from check_items i join checks c on c.id = i.check_id
      where c.business_id = $1 and c.status in ('open','bill') and i.status <> 'void'`,
    [bizId],
  );
  const openChecks = await db.one<{ n: number }>("select count(*)::int as n from checks where business_id = $1 and status in ('open','bill')", [bizId]);
  const openByCheck = new Map<string, typeof open>();
  for (const i of open) openByCheck.set(i.check_id, [...(openByCheck.get(i.check_id) ?? []), i]);
  const openAmount = [...openByCheck.values()].reduce((s, list) => s + totalsFor(list, list[0]!.discount_pct).total, 0);

  const net = totals?.net ?? 0;
  const checks = totals?.checks ?? 0;
  // Horas en el orden de la jornada (de 7 a. m. a 11 p. m., más la madrugada si hubo ventas)
  const hours = new Map(byHour.map((h) => [h.hour, h.sales]));
  const order = (h: number) => (h - JORNADA_CUTOFF_HOUR + 24) % 24;
  const shownHours = [...new Set([...Array.from({ length: 17 }, (_, i) => i + 7), ...byHour.filter((h) => h.sales > 0).map((h) => h.hour)])].sort((a, b) => order(a) - order(b));
  return {
    dayKey,
    net,
    gross: totals?.gross ?? 0,
    tax: totals?.tax ?? 0,
    tips: totals?.tips ?? 0,
    checks,
    guests: totals?.guests ?? 0,
    avgTicket: checks ? Math.round(net / checks) : 0,
    byHour: shownHours.map((hour) => ({ hour, sales: hours.get(hour) ?? 0 })),
    byMethod,
    topProducts: top,
    byWaiter: waiters,
    voids: { n: voids.length, amount: voids.reduce((s, v) => s + v.amount, 0), big: voids.filter((v) => v.amount >= voidLimit).length, items: voids.slice(0, 6) },
    courtesies,
    discounts,
    removed: { n: removed.length, amount: removed.reduce((s, r) => s + r.amount, 0), items: removed.slice(0, 6) },
    discards: { n: discards.length, items: discards.slice(0, 6) },
    qrShare: qr && qr.total ? Math.round((qr.qr / qr.total) * 100) : 0,
    openNow: { n: openChecks?.n ?? 0, amount: openAmount },
  };
}

/** Ventas netas de los últimos días, por jornada. */
export async function dailySales(bizId: string, days = 14) {
  const db = await getDb();
  const today = jornadaKey();
  const first = addDays(today, -(days - 1));
  const { from, to } = jornadaRange(first, days);
  const rows = await db.query<{ day: string; sales: number; checks: number }>(
    `select to_char(${JORNADA("c.closed_at")}, 'YYYY-MM-DD') as day, coalesce(sum(v.subtotal), 0)::int as sales, count(distinct c.id)::int as checks
       from checks c left join invoices v on v.check_id = c.id and v.voided_at is null
      where c.business_id = $1 and c.status = 'paid' and c.closed_at >= $2 and c.closed_at < $3
      group by 1 order by 1`,
    [bizId, from, to],
  );
  const map = new Map(rows.map((r) => [r.day, r]));
  return Array.from({ length: days }, (_, i) => {
    const key = addDays(first, i);
    return { day: key, sales: map.get(key)?.sales ?? 0, checks: map.get(key)?.checks ?? 0 };
  });
}

/** Ventas netas de una jornada. Con `until`, solo lo cerrado hasta ese momento (para comparar "a esta hora"). */
export async function salesOn(bizId: string, dayKey: string, until?: Date) {
  const db = await getDb();
  const { from, to } = jornadaRange(dayKey);
  const row = await db.one<{ sales: number }>(
    `select coalesce(sum(v.subtotal), 0)::int as sales from checks c join invoices v on v.check_id = c.id and v.voided_at is null
      where c.business_id = $1 and c.status = 'paid' and c.closed_at >= $2 and c.closed_at < $3 and ($4::timestamptz is null or c.closed_at <= $4::timestamptz)`,
    [bizId, from, to, until ? until.toISOString() : null],
  );
  return row?.sales ?? 0;
}

// ——— Reportes que ayudan a decidir: control, tiempos, ingeniería de menú y propina ———

const CONTROL_ACTIONS = ["void", "courtesy", "courtesy_off", "discount", "payment_removed", "sale_voided", "invoice_reissued"] as const;
export type ControlAction = "void" | "courtesy" | "discount" | "payment_removed" | "sale_voided" | "invoice_reissued";

export interface ControlEvent {
  at: string;
  action: string;
  who: string;
  authorizedBy: string | null;
  reason: string | null;
  item: string | null;
  check: number | null;
  amount: number;
}

/** Anulaciones, cortesías, descuentos, pagos quitados y ventas anuladas: cuántos, cuánto, quién los pidió, quién autorizó y por qué. */
export async function controlReport(bizId: string, from: string, to: string) {
  const db = await getDb();
  const rows = await db.query<{ action: string; amount: number; created_at: string; detail: Record<string, unknown>; who: string | null }>(
    `select a.action, a.amount, a.created_at, a.detail, s.name as who
       from audit_log a left join staff s on s.id = a.staff_id
      where a.business_id = $1 and a.action = any($2::text[]) and ${JORNADA("a.created_at")} between $3::date and $4::date
      order by a.created_at desc`,
    [bizId, [...CONTROL_ACTIONS], from, to],
  );
  const totals = new Map<ControlAction, { count: number; amount: number }>();
  const people = new Map<string, { name: string; count: number; amount: number; byAction: Partial<Record<ControlAction, number>> }>();
  const authorizers = new Map<string, { count: number; amount: number }>();
  const reasons = new Map<string, number>();
  for (const r of rows) {
    // Quitar una cortesía la descuenta de las cortesías
    const off = r.action === "courtesy_off";
    const action = (off ? "courtesy" : r.action) as ControlAction;
    const sign = off ? -1 : 1;
    const t = totals.get(action) ?? { count: 0, amount: 0 };
    t.count += sign;
    t.amount += sign * Number(r.amount);
    totals.set(action, t);
    const who = r.who ?? "Sin nombre";
    const p = people.get(who) ?? { name: who, count: 0, amount: 0, byAction: {} };
    p.count += sign;
    p.amount += sign * Number(r.amount);
    p.byAction[action] = (p.byAction[action] ?? 0) + sign;
    people.set(who, p);
    const by = typeof r.detail.authorizedBy === "string" ? r.detail.authorizedBy : null;
    if (by && !off) {
      const a = authorizers.get(by) ?? { count: 0, amount: 0 };
      a.count++;
      a.amount += Number(r.amount);
      authorizers.set(by, a);
    }
    const reason = typeof r.detail.reason === "string" ? r.detail.reason.trim() : "";
    if (reason && !off) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  const events: ControlEvent[] = rows
    .filter((r) => r.action !== "courtesy_off")
    .slice(0, 40)
    .map((r) => ({
      at: new Date(r.created_at).toISOString(),
      action: r.action,
      who: r.who ?? "Sin nombre",
      authorizedBy: typeof r.detail.authorizedBy === "string" ? r.detail.authorizedBy : null,
      reason: typeof r.detail.reason === "string" ? r.detail.reason : null,
      item: typeof r.detail.item === "string" ? r.detail.item : null,
      check: typeof r.detail.check === "number" ? r.detail.check : null,
      amount: Number(r.amount),
    }));
  return {
    totals: Object.fromEntries(totals) as Partial<Record<ControlAction, { count: number; amount: number }>>,
    people: [...people.values()].filter((p) => p.count > 0).sort((a, b) => b.amount - a.amount),
    authorizers: [...authorizers].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.count - a.count),
    reasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 8),
    events,
  };
}

/** Cuánto se demora barra y cocina: por estación, por plato y cuántos pasaron del rojo de su estación. */
export async function kitchenTimes(bizId: string, from: string, to: string, late: { barra: number; cocina: number }) {
  const db = await getDb();
  const rows = await db.query<{ station: string; name: string; mins: number; hour: number }>(
    `select i.station, i.name, extract(epoch from (i.ready_at - i.sent_at)) / 60.0 as mins,
            extract(hour from ${BOGOTA("i.sent_at")})::int as hour
       from check_items i
      where i.business_id = $1 and i.sent_at is not null and i.ready_at is not null and i.ready_at >= i.sent_at
        and i.status <> 'void' and ${JORNADA("i.sent_at")} between $2::date and $3::date`,
    [bizId, from, to],
  );
  const stations = (["barra", "cocina"] as const).map((st) => {
    const list = rows.filter((r) => r.station === st).map((r) => Number(r.mins));
    const sorted = [...list].sort((a, b) => a - b);
    return {
      station: st,
      count: list.length,
      avg: list.length ? list.reduce((s, x) => s + x, 0) / list.length : 0,
      p90: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))]! : 0,
      latePct: list.length ? Math.round((list.filter((x) => x > late[st]).length / list.length) * 100) : 0,
      lateAt: late[st],
    };
  });
  const byDish = new Map<string, { name: string; station: string; count: number; total: number; late: number }>();
  for (const r of rows) {
    const k = `${r.station}|${r.name}`;
    const d = byDish.get(k) ?? { name: r.name, station: r.station, count: 0, total: 0, late: 0 };
    d.count++;
    d.total += Number(r.mins);
    if (Number(r.mins) > (r.station === "cocina" ? late.cocina : late.barra)) d.late++;
    byDish.set(k, d);
  }
  const dishes = [...byDish.values()]
    .filter((d) => d.count >= 3)
    .map((d) => ({ ...d, avg: d.total / d.count }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 8);
  const byHour = new Map<number, { count: number; total: number }>();
  for (const r of rows) {
    const h = byHour.get(r.hour) ?? { count: 0, total: 0 };
    h.count++;
    h.total += Number(r.mins);
    byHour.set(r.hour, h);
  }
  const hours = [...byHour].map(([hour, h]) => ({ hour, count: h.count, avg: h.total / h.count })).sort((a, b) => a.hour - b.hour);
  return { stations, dishes, hours };
}

/** Ventas netas, unidades y costo de cada plato en cuentas cerradas: la materia prima de la ingeniería de menú. */
export async function dishSales(bizId: string, from: string, to: string): Promise<DishSales[]> {
  const db = await getDb();
  const rows = await db.query<{ product_id: string; name: string; units: number; net: number; cost: number }>(
    `with rc as (
       select r.product_id, sum(r.qty * g.cost)::float as unit_cost
         from recipe_items r join ingredients g on g.id = r.ingredient_id
        where r.business_id = $1 group by r.product_id
     ),
     mc as (
       select m.modifier_id::text as id, sum(m.qty * g.cost)::float as unit_cost
         from modifier_recipe_items m join ingredients g on g.id = m.ingredient_id
        where m.business_id = $1 group by m.modifier_id
     ),
     lines as (
       select i.product_id, i.name, i.qty, i.tax_rate, c.discount_pct,
              (i.unit_price + coalesce((select sum((m->>'price')::numeric) from jsonb_array_elements(i.modifiers) m), 0)) * i.qty as gross,
              (coalesce(rc.unit_cost, 0) + coalesce((select sum(mc.unit_cost) from jsonb_array_elements(i.modifiers) e join mc on mc.id = e->>'id'), 0)) * i.qty as cost
         from check_items i join checks c on c.id = i.check_id left join rc on rc.product_id = i.product_id
        where c.business_id = $1 and c.status = 'paid' and ${JORNADA("c.closed_at")} between $2::date and $3::date
          and i.status <> 'void' and not i.courtesy and i.product_id is not null
     )
     select product_id, max(name) as name, sum(qty)::int as units,
            sum(gross * (100 - discount_pct) / 100.0 / (1 + tax_rate / 100.0))::float as net,
            sum(cost)::float as cost
       from lines group by product_id`,
    [bizId, from, to],
  );
  return rows.map((r) => ({ id: r.product_id, name: r.name, units: Number(r.units), net: Math.round(Number(r.net)), cost: Math.round(Number(r.cost)) }));
}

/** La propina del período y lo que le toca a cada quien según lo que trabajó (marcado con PIN). */
export async function tipShares(bizId: string, from: string, to: string, rule: { split: TipSplit; roles: string[] }) {
  const db = await getDb();
  const [tip, shifts] = await Promise.all([
    db.one<{ total: number }>(
      `select coalesce(sum(p.tip), 0)::int as total from payments p
        where p.business_id = $1 and p.status = 'ok' and ${JORNADA("p.created_at")} between $2::date and $3::date`,
      [bizId, from, to],
    ),
    db.query<{ staff_id: string; name: string; role: string; minutes: number }>(
      `select s.staff_id, t.name, t.role, sum(extract(epoch from (coalesce(s.clock_out, now()) - s.clock_in)) / 60.0)::float as minutes
         from shifts s join staff t on t.id = s.staff_id
        where s.business_id = $1 and ${JORNADA("s.clock_in")} between $2::date and $3::date
        group by s.staff_id, t.name, t.role`,
      [bizId, from, to],
    ),
  ]);
  const people = shifts.filter((s) => rule.roles.includes(s.role)).map((s) => ({ id: s.staff_id, name: s.name, minutes: Math.round(Number(s.minutes)) }));
  return { total: tip?.total ?? 0, shares: splitTips(tip?.total ?? 0, people, rule.split).sort((a, b) => b.amount - a.amount) };
}

/**
 * Insumos en el período: lo que debió salir por las recetas de lo vendido, la merma registrada y lo que faltó o sobró
 * al contar (las diferencias de los conteos). Solo cuenta lo que se movió en esas jornadas.
 */
export async function stockVariance(bizId: string, from: string, to: string) {
  const db = await getDb();
  const rows = await db.query<{ id: string; name: string; unit: string; cost: number; venta: number; anulacion: number; merma: number; conteo: number; ajuste: number }>(
    `select i.id, i.name, i.unit, i.cost::float as cost,
            coalesce(sum(m.delta) filter (where m.reason = 'venta'), 0)::float as venta,
            coalesce(sum(m.delta) filter (where m.reason = 'anulacion'), 0)::float as anulacion,
            coalesce(sum(m.delta) filter (where m.reason = 'merma'), 0)::float as merma,
            coalesce(sum(m.delta) filter (where m.reason = 'conteo'), 0)::float as conteo,
            coalesce(sum(m.delta) filter (where m.reason = 'ajuste'), 0)::float as ajuste
       from ingredients i
       join stock_movements m on m.ingredient_id = i.id and m.business_id = i.business_id
        and ${JORNADA("m.created_at")} between $2::date and $3::date
      where i.business_id = $1
      group by i.id, i.name, i.unit, i.cost`,
    [bizId, from, to],
  );
  return inventoryVariance(rows.map((r) => ({ ...r, cost: Number(r.cost), venta: Number(r.venta), anulacion: Number(r.anulacion), merma: Number(r.merma), conteo: Number(r.conteo), ajuste: Number(r.ajuste) })));
}

/**
 * Los documentos de un rango de fechas para el contador: cada tiquete o factura emitido en el rango y cada nota que
 * anuló algo en el rango (en negativo). Los medios de pago son los del documento (los que quedaron congelados al emitirlo).
 */
export async function accountingDocs(bizId: string, from: string, to: string): Promise<AccountingDoc[]> {
  const db = await getDb();
  const rows = await db.query<{
    check_id: string;
    prefix: string;
    number: number;
    doc_type: "pos" | "fe";
    customer_doc: string | null;
    customer_name: string | null;
    subtotal: number;
    tax: number;
    tip: number;
    total: number;
    dian_status: string;
    cufe: string;
    issued: string | Date;
    voided_at: string | Date | null;
    void_reason: string | null;
    credit_note: number | null;
    note_code: string | null;
    note_status: string | null;
    pay: { method: string; amount: number }[] | null;
  }>(
    `select i.check_id, i.prefix, i.number, i.doc_type, i.customer_doc, i.customer_name, i.subtotal, i.tax, i.tip, i.total, i.dian_status, i.cufe,
            coalesce(i.issued_at, i.created_at) as issued, i.voided_at, i.void_reason, i.credit_note, i.note_code, i.note_status,
            i.payload->'payments' as pay
       from invoices i
      where i.business_id = $1
        and ((coalesce(i.issued_at, i.created_at) >= $2::timestamptz and coalesce(i.issued_at, i.created_at) < $3::timestamptz)
          or (i.voided_at >= $2::timestamptz and i.voided_at < $3::timestamptz))`,
    [bizId, from, to],
  );
  // Documentos de antes de guardar su contenido: los pagos se leen de la cuenta
  // (de una venta anulada, los que se quitaron al anularla)
  const missing = rows.filter((r) => !Array.isArray(r.pay));
  const byCheck = new Map<string, { method: string; amount: number }[]>();
  if (missing.length) {
    const voided = new Set(missing.filter((r) => r.voided_at).map((r) => r.check_id));
    for (const p of await db.query<{ check_id: string; method: string; amount: number; status: string }>(
      "select check_id, method, (amount + tip)::int as amount, status from payments where check_id = any($1::uuid[]) and status in ('ok', 'removed') order by created_at",
      [missing.map((r) => r.check_id)],
    ))
      if (p.status === "ok" || voided.has(p.check_id)) byCheck.set(p.check_id, [...(byCheck.get(p.check_id) ?? []), { method: p.method, amount: Number(p.amount) }]);
  }
  const iso = (d: string | Date) => (d instanceof Date ? d : new Date(d)).toISOString();
  const lo = new Date(from).getTime();
  const hi = new Date(to).getTime();
  const docs: AccountingDoc[] = [];
  for (const r of rows) {
    const number = `${r.prefix}${r.number}`;
    const customer = r.customer_name || "Consumidor final";
    const customerDoc = r.customer_doc || CONSUMIDOR_FINAL;
    const issued = iso(r.issued);
    if (new Date(issued).getTime() >= lo && new Date(issued).getTime() < hi)
      docs.push({
        at: issued,
        kind: r.doc_type,
        number,
        customer,
        customerDoc,
        base: Number(r.subtotal),
        tax: Number(r.tax),
        tip: Number(r.tip),
        total: Number(r.total),
        payments: (Array.isArray(r.pay) ? r.pay : (byCheck.get(r.check_id) ?? [])).map((p) => ({ method: p.method, amount: Number(p.amount) })),
        dian: r.dian_status,
        code: r.cufe,
        ref: "",
        reason: "",
      });
    if (r.voided_at) {
      const at = iso(r.voided_at);
      if (new Date(at).getTime() >= lo && new Date(at).getTime() < hi)
        docs.push({
          at,
          kind: r.doc_type === "fe" ? "credito" : "ajuste",
          number: `${r.doc_type === "fe" ? "NC" : "NA"}${r.prefix}${r.credit_note ?? ""}`,
          customer,
          customerDoc,
          base: -Number(r.subtotal),
          tax: -Number(r.tax),
          tip: -Number(r.tip),
          total: -Number(r.total),
          payments: [],
          dian: r.note_status ?? r.dian_status,
          code: r.note_code ?? "",
          ref: number,
          reason: r.void_reason ?? "",
        });
    }
  }
  return docs.sort((a, b) => a.at.localeCompare(b.at));
}
