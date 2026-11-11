import "server-only";
import {
  costShifts,
  jornadaOf,
  laborAlerts,
  laborRules,
  loadRate,
  LONG_OPEN_MINUTES,
  MAX_OPEN_MINUTES,
  sortTurnos,
  turnoAt,
  weekOf,
  type LaborAlert,
  type LaborRules,
  type MinuteSplit,
  type PayKind,
  type Turno,
} from "../core/labor";
import { addDays, bogotaParts, jornadaKey, weekdayOf } from "../core/time";
import { CHANNEL_LABEL, channelPct } from "../settings";
import { can, verifyPin, type Staff } from "./auth";
import { audit, bump, getBusiness } from "./business";
import { openNetSales } from "./checks";
import { getDb } from "./db";
import { UserError } from "./errors";
import { JORNADA } from "./reports";

/* ---------- Marcar entrada y salida ---------- */

/**
 * Marca la entrada o la salida de alguien del equipo con su PIN, sin abrir sesión.
 * Un turno que lleva más de 16 horas se olvidó: se cierra "por revisar" (el dueño pone la hora real) y se abre el nuevo.
 */
export async function clockToggle(staffId: string, pin: string) {
  const person = await verifyPin(staffId, pin);
  const db = await getDb();
  return db.tx(async (tx) => {
    const now = new Date();
    const open = await tx.one<{ id: string; clock_in: string }>("select id, clock_in from shifts where staff_id = $1 and clock_out is null for update", [person.id]);
    let forgotten: string | null = null;
    if (open) {
      const minutes = Math.round((now.getTime() - new Date(open.clock_in).getTime()) / 60_000);
      if (minutes < 2) throw new UserError("Ya marcaste tu entrada hace un momento");
      if (minutes <= MAX_OPEN_MINUTES) {
        await tx.query("update shifts set clock_out = $2, closed_by = $3 where id = $1", [open.id, now.toISOString(), person.id]);
        await audit(tx, person.business_id, person.id, "clock_out", { minutes });
        await bump(tx, person.business_id);
        return { action: "out" as const, name: person.name, at: now.toISOString(), minutes, since: open.clock_in, forgotten };
      }
      const capped = new Date(new Date(open.clock_in).getTime() + MAX_OPEN_MINUTES * 60_000).toISOString();
      await tx.query("update shifts set clock_out = $2, closed_by = $3, review = true, note = 'Quedó abierto: falta la hora real de salida' where id = $1", [open.id, capped, person.id]);
      await audit(tx, person.business_id, person.id, "clock_forgotten", { since: open.clock_in, minutes });
      forgotten = open.clock_in;
    }
    const pay = await tx.one<{ pay_kind: PayKind; pay_amount: number }>("select pay_kind, pay_amount from staff where id = $1", [person.id]);
    await tx.query("insert into shifts (business_id, staff_id, clock_in, pay_kind, pay_amount) values ($1, $2, $3, $4, $5)", [
      person.business_id,
      person.id,
      now.toISOString(),
      pay?.pay_kind ?? "salario",
      pay?.pay_amount ?? 0,
    ]);
    await audit(tx, person.business_id, person.id, "clock_in", {});
    await bump(tx, person.business_id);
    return { action: "in" as const, name: person.name, at: now.toISOString(), minutes: 0, since: null as string | null, forgotten };
  });
}

/** Quién está en turno ahora (para la pantalla de entrada). */
export async function openShifts(bizId: string) {
  const db = await getDb();
  return db.query<{ staff_id: string; clock_in: string }>("select staff_id, clock_in from shifts where business_id = $1 and clock_out is null", [bizId]);
}

/**
 * El dueño o la administración ponen la hora real de salida: de un turno que sigue abierto,
 * de uno que quedó "por revisar" o de uno de los últimos 14 días que quedó mal. Queda en el registro.
 */
export async function closeShift(actor: Staff, shiftId: string, hhmm: string) {
  if (!can.manage(actor)) throw new UserError("Solo el dueño o el administrador corrigen turnos");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) throw new UserError("Escribe la hora de salida");
  const db = await getDb();
  await db.tx(async (tx) => {
    const s = await tx.one<{ id: string; clock_in: string; clock_out: string | null; name: string; review: boolean }>(
      `select s.id, s.clock_in, s.clock_out, p.name, s.review from shifts s join staff p on p.id = s.staff_id
        where s.id = $1 and s.business_id = $2 and (s.clock_out is null or s.review or s.clock_in > now() - interval '14 days') for update of s`,
      [shiftId, actor.business_id],
    );
    if (!s) throw new UserError("Ese turno ya no se puede corregir");
    const start = new Date(s.clock_in);
    // La hora es del día de la entrada; si queda antes de la entrada, es de la madrugada siguiente
    let out = Date.parse(`${bogotaParts(start).dayKey}T${hhmm}:00-05:00`);
    if (out <= start.getTime()) out += 86_400_000;
    if (out > Date.now()) throw new UserError("Esa hora todavía no llega");
    if (out - start.getTime() > MAX_OPEN_MINUTES * 60_000) throw new UserError("Revisa la hora: el turno quedaría de más de 16 horas");
    await tx.query("update shifts set clock_out = $2, closed_by = $3, review = false, note = '' where id = $1", [s.id, new Date(out).toISOString(), actor.id]);
    await audit(tx, actor.business_id, actor.id, "clock_fix", { staff: s.name, from: s.clock_out, out: new Date(out).toISOString(), review: s.review });
    await bump(tx, actor.business_id);
  });
}

/** Turnos que quedaron "por revisar": la alerta no se va hasta que alguien ponga la hora real. */
export async function shiftsToReview(bizId: string) {
  const db = await getDb();
  return db.query<{ id: string; name: string; clock_in: string; clock_out: string }>(
    "select s.id, p.name, s.clock_in, s.clock_out from shifts s join staff p on p.id = s.staff_id where s.business_id = $1 and s.review order by s.clock_in desc limit 20",
    [bizId],
  );
}

/* ---------- Rentabilidad ---------- */

export interface ProfitRow {
  /** Ventas sin impuesto ni propina */
  net: number;
  /** Insumos según las recetas */
  cogs: number;
  /** Costo del equipo */
  labor: number;
  /** Comisión de las plataformas de domicilios */
  commission: number;
  /** Minutos trabajados */
  minutes: number;
  checks: number;
}

export interface ProfitPerson {
  id: string;
  name: string;
  role: string;
  color: string;
  payKind: PayKind;
  payAmount: number;
  minutes: number;
  split: MinuteSplit;
  cost: number;
  shifts: number;
  /** Ventas sin impuesto de las cuentas que abrió, y sus propinas (aparte: no son salario) */
  net: number;
  checks: number;
  tips: number;
}

export interface ProfitReport {
  from: string;
  to: string;
  today: string;
  turnos: Turno[];
  totals: ProfitRow & { tips: number };
  days: { day: string; total: ProfitRow; byTurno: ProfitRow[] }[];
  /** Promedio por día de la semana y turno del local, solo con jornadas cerradas */
  grid: { dow: number; cells: (ProfitRow & { n: number })[] }[];
  people: ProfitPerson[];
  live: { today: ProfitRow; byTurno: ProfitRow[]; onShift: { shiftId: string; staffId: string; name: string; color: string; since: string; minutes: number; cost: number; long: boolean }[] } | null;
  alerts: LaborAlert[];
  rules: LaborRules;
  load: number;
  alertPct: number;
  missingPay: string[];
  /** Ventas por canal: en el local, Rappi, DiDi y domicilio propio, con la comisión de cada plataforma */
  channels: { key: string; label: string; pct: number; net: number; total: number; checks: number; commission: number }[];
  /** Lo vendido sin receta: su costo de insumos no se cuenta y el margen sale más alto de lo real */
  noRecipe: { net: number; pct: number; products: string[] };
}

const emptyRow = (): ProfitRow => ({ net: 0, cogs: 0, labor: 0, commission: 0, minutes: 0, checks: 0 });
const addRow = (a: ProfitRow, b: ProfitRow) => {
  a.net += b.net;
  a.cogs += b.cogs;
  a.labor += b.labor;
  a.commission += b.commission;
  a.minutes += b.minutes;
  a.checks += b.checks;
};

/**
 * Rentabilidad de las jornadas entre `from` y `to` (pueden ser solo jornadas cerradas) y, aparte,
 * lo de hoy en vivo: quién está en turno y cuánto va el equipo frente a lo vendido.
 */
export async function profitReport(bizId: string, range: { from: string; to: string }, now = new Date()): Promise<ProfitReport> {
  const db = await getDb();
  const biz = await getBusiness(bizId);
  const labor = biz.settings.labor;
  const turnos = sortTurnos(labor.turnos);
  const today = jornadaKey(now);
  const { from, to } = range;
  // Se consulta hasta hoy aunque el periodo termine antes: lo de hoy alimenta el bloque en vivo
  const until = to > today ? to : today;

  const [staff, shiftRows, checks, noRecipeTop] = await Promise.all([
    db.query<{ id: string; name: string; role: string; color: string; pay_kind: PayKind; pay_amount: number }>(
      "select id, name, role, color, pay_kind, pay_amount from staff where business_id = $1",
      [bizId],
    ),
    // Desde el lunes de la primera semana: las extras dependen de lo trabajado antes en la semana
    db.query<{ id: string; staff_id: string; clock_in: string; clock_out: string | null; pay_kind: PayKind; pay_amount: number }>(
      "select id, staff_id, clock_in, clock_out, pay_kind, pay_amount from shifts where business_id = $1 and clock_in >= $2 and clock_in < $3 order by clock_in",
      [bizId, `${weekOf(from)}T05:00:00-05:00`, `${addDays(until, 1)}T05:00:00-05:00`],
    ),
    db.query<{ id: string; opened_by: string | null; closed_at: string; channel: string; total: number; tip: number; base: number | null; cogs: number; mix_all: number; mix_nr: number }>(
      `with rc as (
         select r.product_id, sum(r.qty * g.cost)::float as unit_cost
           from recipe_items r join ingredients g on g.id = r.ingredient_id
          where r.business_id = $1 group by r.product_id
       ),
       -- Lo que gasta cada opción ("Tocineta" 30 g) también es costo de lo vendido
       mc as (
         select m.modifier_id::text as id, sum(m.qty * g.cost)::float as unit_cost
           from modifier_recipe_items m join ingredients g on g.id = m.ingredient_id
          where m.business_id = $1 group by m.modifier_id
       )
       select c.id, c.opened_by, c.closed_at, c.channel, coalesce(pay.total, 0)::int as total, coalesce(pay.tip, 0)::int as tip, inv.base::int as base, (coalesce(cg.cogs, 0) + coalesce(mg.cogs, 0))::float as cogs,
              coalesce(mix.all_, 0)::float as mix_all, coalesce(mix.nr, 0)::float as mix_nr
         from checks c
         left join lateral (select sum(p.amount) as total, sum(p.tip) as tip from payments p where p.check_id = c.id and p.status = 'ok') pay on true
         left join lateral (select sum(v.subtotal) as base from invoices v where v.check_id = c.id) inv on true
         left join lateral (select sum(i.qty * rc.unit_cost) as cogs from check_items i join rc on rc.product_id = i.product_id where i.check_id = c.id and i.status <> 'void') cg on true
         left join lateral (
           select sum(i.qty * mc.unit_cost) as cogs
             from check_items i cross join lateral jsonb_array_elements(i.modifiers) e join mc on mc.id = e->>'id'
            where i.check_id = c.id and i.status <> 'void'
         ) mg on true
         left join lateral (
           select sum(i.qty * i.unit_price) as all_, sum(i.qty * i.unit_price) filter (where rc.product_id is null) as nr
             from check_items i left join rc on rc.product_id = i.product_id
            where i.check_id = c.id and i.status <> 'void' and not i.courtesy
         ) mix on true
        where c.business_id = $1 and c.status = 'paid' and ${JORNADA("c.closed_at")} between $2::date and $3::date`,
      [bizId, from, until],
    ),
    db.query<{ name: string }>(
      `select i.name from check_items i join checks c on c.id = i.check_id
        where c.business_id = $1 and c.status = 'paid' and ${JORNADA("c.closed_at")} between $2::date and $3::date
          and i.status <> 'void' and not i.courtesy
          and not exists (select 1 from recipe_items r where r.product_id = i.product_id)
        group by i.name order by sum(i.qty * i.unit_price) desc limit 5`,
      [bizId, from, to],
    ),
  ]);

  const cost = costShifts(
    shiftRows.map((s) => ({ id: s.id, staffId: s.staff_id, start: s.clock_in, end: s.clock_out, payKind: s.pay_kind, payAmount: s.pay_amount })),
    { exonerated: labor.exonerated, arlClass: labor.arlClass, now, slot: (t) => `${jornadaOf(t)}|${turnoAt(t, turnos)}` },
  );

  // Ventas e insumos por jornada y turno del local (por la hora en que se cerró la cuenta)
  const sales = new Map<string, ProfitRow>();
  const byOpener = new Map<string, { net: number; checks: number; tips: number }>();
  const byChannel = new Map<string, { net: number; total: number; checks: number; commission: number }>();
  let tips = 0;
  let noRecipeNet = 0;
  for (const c of checks) {
    const net = c.base ?? Math.round(c.total / 1.08);
    const commission = (c.total * channelPct(biz.settings, c.channel)) / 100;
    const jornada = jornadaOf(c.closed_at);
    const key = `${jornada}|${turnoAt(c.closed_at, turnos)}`;
    const row = sales.get(key) ?? emptyRow();
    row.net += net;
    row.cogs += c.cogs;
    row.commission += commission;
    row.checks += 1;
    sales.set(key, row);
    if (jornada > to) continue;
    if (jornada >= from && c.mix_all > 0) noRecipeNet += (net * c.mix_nr) / c.mix_all;
    const ch = byChannel.get(c.channel) ?? { net: 0, total: 0, checks: 0, commission: 0 };
    ch.net += net;
    ch.total += c.total;
    ch.checks += 1;
    ch.commission += commission;
    byChannel.set(c.channel, ch);
    tips += c.tip;
    if (c.opened_by) {
      const o = byOpener.get(c.opened_by) ?? { net: 0, checks: 0, tips: 0 };
      o.net += net;
      o.checks += 1;
      o.tips += c.tip;
      byOpener.set(c.opened_by, o);
    }
  }

  const turnosOf = (day: string) =>
    turnos.map((_, i) => {
      const row = { ...(sales.get(`${day}|${i}`) ?? emptyRow()) };
      const slot = cost.slots.get(`${day}|${i}`);
      row.labor = slot?.cost ?? 0;
      row.minutes = slot?.minutes ?? 0;
      return row;
    });
  const sumRows = (rows: ProfitRow[]) => {
    const total = emptyRow();
    rows.forEach((r) => addRow(total, r));
    return total;
  };

  const totals = { ...emptyRow(), tips };
  const days: ProfitReport["days"] = [];
  const grid = Array.from({ length: 7 }, (_, i) => ({ dow: i + 1, cells: turnos.map(() => ({ ...emptyRow(), n: 0 })) }));
  for (let day = to; day >= from; day = addDays(day, -1)) {
    const byTurno = turnosOf(day);
    const total = sumRows(byTurno);
    addRow(totals, total);
    if (total.net || total.labor) days.push({ day, total, byTurno });
    if (day !== today) {
      const cells = grid[weekdayOf(day) - 1]!.cells;
      byTurno.forEach((r, i) => {
        if (!r.net && !r.labor) return;
        addRow(cells[i]!, r);
        cells[i]!.n += 1;
      });
    }
  }

  const names = new Map(staff.map((s) => [s.id, s.name]));
  const people: ProfitPerson[] = [];
  for (const s of staff) {
    const mine = cost.shifts.filter((x) => x.staffId === s.id && x.jornada >= from && x.jornada <= to);
    const sold = byOpener.get(s.id);
    if (!mine.length && !sold) continue;
    const split = mine.reduce(
      (acc, x) => {
        for (const k of Object.keys(acc) as (keyof MinuteSplit)[]) acc[k] += x.split[k];
        return acc;
      },
      { ordinary: 0, night: 0, rest: 0, restNight: 0, extra: 0, extraNight: 0, extraRest: 0, extraRestNight: 0 },
    );
    people.push({
      id: s.id,
      name: s.name,
      role: s.role,
      color: s.color,
      payKind: s.pay_kind,
      payAmount: s.pay_amount,
      minutes: mine.reduce((a, x) => a + x.minutes, 0),
      split,
      cost: mine.reduce((a, x) => a + x.total, 0),
      shifts: mine.length,
      net: sold?.net ?? 0,
      checks: sold?.checks ?? 0,
      tips: sold?.tips ?? 0,
    });
  }
  people.sort((a, b) => b.cost - a.cost || b.net - a.net);

  const todayByTurno = turnosOf(today);
  const live =
    until === today
      ? {
          today: sumRows(todayByTurno),
          byTurno: todayByTurno,
          onShift: cost.shifts
            .filter((x) => x.open)
            .map((x) => {
              const p = staff.find((s) => s.id === x.staffId);
              return {
                shiftId: x.id,
                staffId: x.staffId,
                name: p?.name ?? "Alguien del equipo",
                color: p?.color ?? "#6b6660",
                since: new Date(x.start).toISOString(),
                minutes: x.minutes,
                cost: x.total,
                long: x.capped || x.minutes >= LONG_OPEN_MINUTES,
              };
            })
            .sort((a, b) => (a.since < b.since ? -1 : 1)),
        }
      : null;

  return {
    from,
    to,
    today,
    turnos,
    totals,
    days,
    grid,
    people,
    live,
    alerts: laborAlerts(cost, { names, from, to: until, today, now: now.getTime() }),
    rules: laborRules(today),
    load: loadRate(labor),
    alertPct: labor.alertPct,
    // Se mira el pago con que quedó cada turno, no la ficha de hoy: un turno en $0 sigue avisando
    missingPay: [...new Set(shiftRows.filter((x) => x.pay_amount <= 0 && jornadaOf(x.clock_in) >= from && jornadaOf(x.clock_in) <= to).map((x) => names.get(x.staff_id) ?? "Alguien del equipo"))],
    channels: ["local", "rappi", "didi", "propio"]
      .filter((k) => byChannel.has(k))
      .map((k) => ({ key: k, label: CHANNEL_LABEL[k] ?? k, pct: channelPct(biz.settings, k), ...byChannel.get(k)! })),
    noRecipe: { net: Math.round(noRecipeNet), pct: totals.net ? Math.round((noRecipeNet / totals.net) * 100) : 0, products: noRecipeTop.map((r) => r.name) },
  };
}

/** Mano de obra de hoy para el resumen del panel: personas en turno, costo y porcentaje de las ventas. */
export async function laborToday(bizId: string) {
  const today = jornadaKey();
  const [r, open] = await Promise.all([profitReport(bizId, { from: today, to: today }), openNetSales(bizId)]);
  const row = r.live?.today ?? emptyRow();
  const withOpen = row.net + open;
  return {
    onShift: r.live?.onShift.length ?? 0,
    labor: row.labor,
    net: row.net,
    pct: row.net ? row.labor / row.net : null,
    /** Contando lo que se está consumiendo en las cuentas abiertas: en hora pico la alerta no salta sin razón */
    openNet: open,
    pctWithOpen: withOpen ? row.labor / withOpen : null,
    alertPct: r.alertPct,
  };
}
