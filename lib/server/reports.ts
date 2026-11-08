import "server-only";
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
