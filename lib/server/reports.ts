import "server-only";
import { JORNADA_CUTOFF_HOUR, jornadaKey } from "../core/time";
import { getDb } from "./db";

// Hora de Bogotá a partir de un timestamptz, sin depender de la zona horaria de la sesión
const BOGOTA = (col: string) => `((${col} at time zone 'UTC') - interval '5 hours')`;
// Jornada: lo de antes de las 5:00 a. m. cuenta para el día anterior
const JORNADA = (col: string) => `(((${col} at time zone 'UTC') - interval '${5 + JORNADA_CUTOFF_HOUR} hours')::date)`;

export interface DayReport {
  dayKey: string;
  sales: number;
  tips: number;
  checks: number;
  guests: number;
  avgTicket: number;
  byHour: { hour: number; sales: number }[];
  byMethod: { method: string; amount: number; n: number }[];
  topProducts: { name: string; qty: number; revenue: number }[];
  byWaiter: { name: string; color: string | null; sales: number; checks: number; tips: number }[];
  voids: { n: number; amount: number; items: { detail: Record<string, unknown>; amount: number; staff: string | null; created_at: string }[] };
  courtesies: number;
  qrShare: number;
  openNow: { n: number; amount: number };
}

export async function dayReport(bizId: string, dayKey = jornadaKey()): Promise<DayReport> {
  const db = await getDb();
  const day = [bizId, dayKey];
  const [totals, byHour, byMethod, top, waiters, voids, courtesy, qr, open] = await Promise.all([
    db.one<{ sales: number; tips: number; checks: number; guests: number }>(
      `select coalesce(sum(p.amount), 0)::int as sales, coalesce(sum(p.tip), 0)::int as tips,
              count(distinct c.id)::int as checks, coalesce((select sum(guests) from checks c2 where c2.business_id = $1 and c2.status = 'paid' and ${JORNADA("c2.closed_at")} = $2::date), 0)::int as guests
         from checks c join payments p on p.check_id = c.id and p.status = 'ok'
        where c.business_id = $1 and c.status = 'paid' and ${JORNADA("c.closed_at")} = $2::date`,
      day,
    ),
    db.query<{ hour: number; sales: number }>(
      `select extract(hour from ${BOGOTA("c.closed_at")})::int as hour, coalesce(sum(p.amount), 0)::int as sales
         from checks c join payments p on p.check_id = c.id and p.status = 'ok'
        where c.business_id = $1 and c.status = 'paid' and ${JORNADA("c.closed_at")} = $2::date group by 1 order by 1`,
      day,
    ),
    db.query<{ method: string; amount: number; n: number }>(
      `select p.method, sum(p.amount)::int as amount, count(*)::int as n from payments p join checks c on c.id = p.check_id
        where c.business_id = $1 and c.status = 'paid' and p.status = 'ok' and ${JORNADA("c.closed_at")} = $2::date group by 1 order by 2 desc`,
      day,
    ),
    db.query<{ name: string; qty: number; revenue: number }>(
      `select i.name, sum(i.qty)::int as qty,
              sum((i.unit_price + coalesce((select sum((m->>'price')::int) from jsonb_array_elements(i.modifiers) m), 0)) * i.qty)::int as revenue
         from check_items i join checks c on c.id = i.check_id
        where c.business_id = $1 and c.status = 'paid' and i.status <> 'void' and not i.courtesy and ${JORNADA("c.closed_at")} = $2::date
        group by i.name order by revenue desc limit 8`,
      day,
    ),
    db.query<{ name: string; color: string | null; sales: number; checks: number; tips: number }>(
      `select s.name, s.color, coalesce(sum(p.amount), 0)::int as sales, count(distinct c.id)::int as checks, coalesce(sum(p.tip), 0)::int as tips
         from checks c join staff s on s.id = c.opened_by join payments p on p.check_id = c.id and p.status = 'ok'
        where c.business_id = $1 and c.status = 'paid' and ${JORNADA("c.closed_at")} = $2::date group by s.name, s.color order by 3 desc`,
      day,
    ),
    db.query<{ detail: Record<string, unknown>; amount: number; staff: string | null; created_at: string }>(
      `select a.detail, a.amount, s.name as staff, a.created_at from audit_log a left join staff s on s.id = a.staff_id
        where a.business_id = $1 and a.action = 'void' and ${JORNADA("a.created_at")} = $2::date order by a.created_at desc`,
      day,
    ),
    db.one<{ amount: number }>(
      `select coalesce(sum(amount), 0)::int as amount from audit_log where business_id = $1 and action in ('courtesy','reward') and ${JORNADA("created_at")} = $2::date`,
      day,
    ),
    db.one<{ qr: number; total: number }>(
      `select coalesce(sum(i.qty) filter (where i.source = 'qr'), 0)::int as qr, coalesce(sum(i.qty), 0)::int as total
         from check_items i join checks c on c.id = i.check_id
        where c.business_id = $1 and i.status <> 'void' and ${JORNADA("i.created_at")} = $2::date`,
      day,
    ),
    db.query<{ unit_price: number; qty: number; modifiers: { price: number }[] }>(
      `select i.unit_price, i.qty, i.modifiers from check_items i join checks c on c.id = i.check_id
        where c.business_id = $1 and c.status in ('open','bill') and i.status <> 'void' and not i.courtesy`,
      [bizId],
    ),
  ]);
  const openChecks = await db.one<{ n: number }>("select count(*)::int as n from checks where business_id = $1 and status in ('open','bill')", [bizId]);
  const sales = totals?.sales ?? 0;
  const checks = totals?.checks ?? 0;
  // Horas en el orden de la jornada (de 7 a. m. a 11 p. m., más la madrugada si hubo ventas)
  const hours = new Map(byHour.map((h) => [h.hour, h.sales]));
  const order = (h: number) => (h - JORNADA_CUTOFF_HOUR + 24) % 24;
  const shownHours = [...new Set([...Array.from({ length: 17 }, (_, i) => i + 7), ...byHour.filter((h) => h.sales > 0).map((h) => h.hour)])].sort((a, b) => order(a) - order(b));
  return {
    dayKey,
    sales,
    tips: totals?.tips ?? 0,
    checks,
    guests: totals?.guests ?? 0,
    avgTicket: checks ? Math.round(sales / checks) : 0,
    byHour: shownHours.map((hour) => ({ hour, sales: hours.get(hour) ?? 0 })),
    byMethod,
    topProducts: top,
    byWaiter: waiters,
    voids: { n: voids.length, amount: voids.reduce((s, v) => s + v.amount, 0), items: voids.slice(0, 6) },
    courtesies: courtesy?.amount ?? 0,
    qrShare: qr && qr.total ? Math.round((qr.qr / qr.total) * 100) : 0,
    openNow: { n: openChecks?.n ?? 0, amount: open.reduce((s, i) => s + (i.unit_price + i.modifiers.reduce((a, m) => a + (m.price ?? 0), 0)) * i.qty, 0) },
  };
}

export async function dailySales(bizId: string, days = 14) {
  const db = await getDb();
  const rows = await db.query<{ day: string; sales: number; checks: number }>(
    `select to_char(${JORNADA("c.closed_at")}, 'YYYY-MM-DD') as day, coalesce(sum(p.amount), 0)::int as sales, count(distinct c.id)::int as checks
       from checks c join payments p on p.check_id = c.id and p.status = 'ok'
      where c.business_id = $1 and c.status = 'paid' and c.closed_at > now() - make_interval(days => $2::int + 1)
      group by 1 order by 1`,
    [bizId, days],
  );
  const map = new Map(rows.map((r) => [r.day, r]));
  const today = Date.parse(`${jornadaKey()}T12:00:00Z`);
  return Array.from({ length: days }, (_, i) => {
    const key = new Date(today - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return { day: key, sales: map.get(key)?.sales ?? 0, checks: map.get(key)?.checks ?? 0 };
  });
}

/** Ventas de una jornada. Con `until`, solo lo cerrado hasta ese momento (para comparar "a esta hora"). */
export async function salesOn(bizId: string, dayKey: string, until?: Date) {
  const db = await getDb();
  const row = await db.one<{ sales: number }>(
    `select coalesce(sum(p.amount), 0)::int as sales from checks c join payments p on p.check_id = c.id and p.status = 'ok'
      where c.business_id = $1 and c.status = 'paid' and ${JORNADA("c.closed_at")} = $2::date and ($3::timestamptz is null or c.closed_at <= $3::timestamptz)`,
    [bizId, dayKey, until ? until.toISOString() : null],
  );
  return row?.sales ?? 0;
}
