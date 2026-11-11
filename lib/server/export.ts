import "server-only";
import { csvFilename, csvStamp, toCsv, type CsvCell } from "../core/csv";
import { addDays, jornadaKey } from "../core/time";
import { CHANNEL_LABEL, METHOD_LABEL } from "../settings";
import { can, type Staff } from "./auth";
import { getSedes } from "./business";
import { totalsFor, type CheckItem } from "./checks";
import { getDb } from "./db";
import { UserError } from "./errors";
import { JORNADA, jornadaRange } from "./reports";

/**
 * Exportar para el contador: ventas, impuestos, propinas, caja y compras por jornada y por sede, en CSV
 * que Excel abre bien (lib/core/csv.ts). Solo el dueño o la administración; el dueño puede sacar todas las sedes.
 */
export const EXPORT_KINDS = ["ventas", "impuestos", "propinas", "caja", "compras"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export interface ExportInput {
  kind: string;
  from: string;
  to: string;
  allSedes?: boolean;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const jornadaOf = (col: string) => `to_char(${JORNADA(col)}, 'YYYY-MM-DD')`;

export async function exportCsv(staff: Staff, input: ExportInput) {
  if (!can.manage(staff)) throw new UserError("Solo el dueño o el administrador exportan para el contador");
  const kind = input.kind as ExportKind;
  if (!EXPORT_KINDS.includes(kind)) throw new UserError("Elige qué exportar");
  const today = jornadaKey();
  const from = DAY.test(input.from ?? "") ? input.from : today;
  const to = DAY.test(input.to ?? "") ? input.to : today;
  if (from > to) throw new UserError("La fecha inicial es mayor que la final");
  if (addDays(from, 366) < to) throw new UserError("Exporta máximo un año por archivo");
  const all = !!input.allSedes && staff.role === "owner";
  const chain = await getSedes(staff.business_id);
  const sedes = all ? chain : chain.filter((s) => s.id === staff.business_id);
  if (!sedes.length) throw new UserError("Sede no encontrada");
  const ids = sedes.map((s) => s.id);
  const names = new Map(sedes.map((s) => [s.id, s.sede || s.name]));
  const sede = (id: string) => names.get(id) ?? "";
  const range = [ids, jornadaRange(from).from, jornadaRange(to).to] as const;
  const db = await getDb();
  let headers: string[] = [];
  let rows: CsvCell[][] = [];

  if (kind === "ventas") {
    const invoices = await db.query<{
      id: string;
      business_id: string;
      jornada: string;
      created_at: string;
      prefix: string;
      number: number;
      voided_at: string | null;
      void_reason: string | null;
      credit_note: number | null;
      kind: string;
      customer_doc: string | null;
      customer_name: string | null;
      subtotal: number;
      tax: number;
      tip: number;
      total: number;
      cufe: string;
      check_id: string;
      check_number: number;
      channel: string;
      guests: number;
      waiter: string | null;
    }>(
      `select v.id, v.business_id, ${jornadaOf("v.created_at")} as jornada, v.created_at, v.prefix, v.number, v.voided_at, v.void_reason, v.credit_note, v.kind,
              v.customer_doc, v.customer_name, v.subtotal, v.tax, v.tip, v.total, v.cufe, c.id as check_id, c.number as check_number, c.channel, c.guests, s.name as waiter
         from invoices v join checks c on c.id = v.check_id left join staff s on s.id = c.opened_by
        where v.business_id = any($1::uuid[]) and v.created_at >= $2 and v.created_at < $3
        order by v.business_id, v.created_at`,
      [...range],
    );
    const payments = invoices.length
      ? await db.query<{ check_id: string; method: string; amount: number }>(
          "select check_id, method, sum(amount + tip)::int as amount from payments where check_id = any($1::uuid[]) and status = 'ok' group by check_id, method order by check_id, method",
          [[...new Set(invoices.map((i) => i.check_id))]],
        )
      : [];
    const byCheck = new Map<string, string[]>();
    for (const p of payments) byCheck.set(p.check_id, [...(byCheck.get(p.check_id) ?? []), `${METHOD_LABEL[p.method] ?? p.method} ${p.amount}`]);
    headers = [
      "Jornada",
      "Fecha y hora",
      "Sede",
      "Documento",
      "Estado",
      "Nota crédito",
      "Motivo de anulación",
      "Cliente",
      "Documento del cliente",
      "Nombre del cliente",
      "Base gravable",
      "Impuesto",
      "Total con impuesto",
      "Propina",
      "Total pagado",
      "Medios de pago",
      "Cuenta",
      "Canal",
      "Personas",
      "Atendió",
      "CUFE",
    ];
    rows = invoices.map((v) => [
      v.jornada,
      csvStamp(v.created_at),
      sede(v.business_id),
      `${v.prefix}-${v.number}`,
      v.voided_at ? "Anulada" : "Vigente",
      v.credit_note ?? "",
      v.void_reason ?? "",
      v.kind === "nit" ? "Con NIT o cédula" : "Consumidor final",
      v.customer_doc ?? "",
      v.customer_name ?? "",
      v.subtotal,
      v.tax,
      v.total - v.tip,
      v.tip,
      v.total,
      (byCheck.get(v.check_id) ?? []).join(" + "),
      v.check_number,
      CHANNEL_LABEL[v.channel] ?? v.channel,
      v.guests,
      v.waiter ?? "",
      v.cufe,
    ]);
  }

  if (kind === "impuestos") {
    // Base e impuesto por tarifa, calculados línea por línea igual que en la factura (descuento incluido)
    const items = await db.query<CheckItem & { business_id: string; jornada: string; check_id: string; discount_pct: number }>(
      `select c.business_id, ${jornadaOf("c.closed_at")} as jornada, c.id as check_id, c.discount_pct, i.unit_price, i.qty, i.modifiers, i.tax_rate, i.status, i.courtesy
         from check_items i join checks c on c.id = i.check_id
        where c.business_id = any($1::uuid[]) and c.status = 'paid' and c.closed_at >= $2 and c.closed_at < $3 and i.status <> 'void'
        order by c.business_id, c.closed_at`,
      [...range],
    );
    const byCheck = new Map<string, typeof items>();
    for (const i of items) byCheck.set(i.check_id, [...(byCheck.get(i.check_id) ?? []), i]);
    const groups = new Map<string, { jornada: string; biz: string; rate: number; base: number; tax: number; checks: number }>();
    for (const list of byCheck.values()) {
      const first = list[0]!;
      for (const t of totalsFor(list, first.discount_pct).taxes) {
        if (!t.base && !t.tax) continue;
        const key = `${first.jornada}|${first.business_id}|${t.rate}`;
        const g = groups.get(key) ?? { jornada: first.jornada, biz: first.business_id, rate: t.rate, base: 0, tax: 0, checks: 0 };
        g.base += t.base;
        g.tax += t.tax;
        g.checks += 1;
        groups.set(key, g);
      }
    }
    headers = ["Jornada", "Sede", "Tarifa %", "Base gravable", "Impuesto", "Total con impuesto", "Cuentas"];
    rows = [...groups.values()]
      .sort((a, b) => a.jornada.localeCompare(b.jornada) || sede(a.biz).localeCompare(sede(b.biz)) || b.rate - a.rate)
      .map((g) => [g.jornada, sede(g.biz), g.rate, g.base, g.tax, g.base + g.tax, g.checks]);
  }

  if (kind === "propinas") {
    const tips = await db.query<{ business_id: string; jornada: string; waiter: string | null; n: number; tips: number; net: number }>(
      `select v.business_id, ${jornadaOf("c.closed_at")} as jornada, s.name as waiter, count(*)::int as n, coalesce(sum(v.tip), 0)::int as tips, coalesce(sum(v.subtotal), 0)::int as net
         from invoices v join checks c on c.id = v.check_id left join staff s on s.id = c.opened_by
        where v.business_id = any($1::uuid[]) and v.voided_at is null and c.closed_at >= $2 and c.closed_at < $3
        group by 1, 2, 3 order by 1, 2, 3`,
      [...range],
    );
    headers = ["Jornada", "Sede", "Atendió", "Cuentas", "Ventas netas", "Propinas"];
    rows = tips.map((t) => [t.jornada, sede(t.business_id), t.waiter ?? "Sin asignar", t.n, t.net, t.tips]);
  }

  if (kind === "caja") {
    const sessions = await db.query<{
      id: string;
      business_id: string;
      opened_at: string;
      closed_at: string | null;
      opening: number;
      expected: number | null;
      counted: number | null;
      difference: number | null;
      note: string;
      opener: string | null;
      closer: string | null;
      cash: number;
      ins: number;
      outs: number;
      removed: number;
    }>(
      `select cs.id, cs.business_id, cs.opened_at, cs.closed_at, cs.opening, cs.expected, cs.counted, cs.difference, cs.note, o.name as opener, c.name as closer,
              coalesce((select sum(p.amount + p.tip) from payments p where p.cash_session_id = cs.id and p.status = 'ok' and p.method = 'efectivo'), 0)::int as cash,
              coalesce((select sum(m.amount) from cash_movements m where m.session_id = cs.id and m.kind = 'in'), 0)::int as ins,
              coalesce((select sum(m.amount) from cash_movements m where m.session_id = cs.id and m.kind = 'out'), 0)::int as outs,
              coalesce((select sum(p.amount + p.tip) from payments p where p.cash_session_id = cs.id and p.status = 'removed'), 0)::int as removed
         from cash_sessions cs left join staff o on o.id = cs.opened_by left join staff c on c.id = cs.closed_by
        where cs.business_id = any($1::uuid[]) and cs.opened_at >= $2 and cs.opened_at < $3
        order by cs.business_id, cs.opened_at`,
      [...range],
    );
    const byMethod = sessions.length
      ? await db.query<{ cash_session_id: string; method: string; amount: number }>(
          "select cash_session_id, method, sum(amount)::int as amount from payments where cash_session_id = any($1::uuid[]) and status = 'ok' group by 1, 2 order by 1, 2",
          [sessions.map((s) => s.id)],
        )
      : [];
    const sales = new Map<string, string[]>();
    for (const m of byMethod) sales.set(m.cash_session_id, [...(sales.get(m.cash_session_id) ?? []), `${METHOD_LABEL[m.method] ?? m.method} ${m.amount}`]);
    headers = [
      "Jornada",
      "Sede",
      "Abrió",
      "Cerró",
      "Quién abrió",
      "Quién cerró",
      "Base",
      "Efectivo cobrado (con propina)",
      "Entradas",
      "Salidas",
      "Esperado en el cajón",
      "Contado",
      "Diferencia",
      "Ventas por medio (sin propina)",
      "Pagos quitados",
      "Nota",
    ];
    rows = sessions.map((s) => [
      jornadaKey(new Date(s.opened_at)),
      sede(s.business_id),
      csvStamp(s.opened_at),
      csvStamp(s.closed_at),
      s.opener ?? "",
      s.closer ?? "",
      s.opening,
      s.cash,
      s.ins,
      s.outs,
      s.closed_at ? (s.expected ?? "") : s.opening + s.cash + s.ins - s.outs,
      s.counted ?? "",
      s.difference ?? "",
      (sales.get(s.id) ?? []).join(" + "),
      s.removed,
      s.closed_at ? s.note : "Caja abierta",
    ]);
  }

  if (kind === "compras") {
    const moves = await db.query<{ business_id: string; jornada: string; created_at: string; reason: string; name: string; unit: string; delta: number; cost: number; ref: string; staff: string | null }>(
      `select m.business_id, ${jornadaOf("m.created_at")} as jornada, m.created_at, m.reason, i.name, i.unit, m.delta, i.cost, m.ref, s.name as staff
         from stock_movements m join ingredients i on i.id = m.ingredient_id left join staff s on s.id = m.staff_id
        where m.business_id = any($1::uuid[]) and m.reason in ('compra', 'merma', 'conteo') and m.created_at >= $2 and m.created_at < $3
        order by m.business_id, m.created_at`,
      [...range],
    );
    const label: Record<string, string> = { compra: "Compra", merma: "Merma", conteo: "Ajuste por conteo" };
    headers = ["Jornada", "Fecha y hora", "Sede", "Movimiento", "Insumo", "Unidad", "Cantidad", "Costo promedio por unidad", "Valor estimado", "Nota", "Quién"];
    rows = moves.map((m) => {
      const qty = Number(m.delta);
      const cost = Number(m.cost);
      return [m.jornada, csvStamp(m.created_at), sede(m.business_id), label[m.reason] ?? m.reason, m.name, m.unit, Math.round(qty * 100) / 100, Math.round(cost * 100) / 100, Math.round(Math.abs(qty) * cost), m.ref, m.staff ?? ""];
    });
  }

  return { filename: csvFilename(kind, from, to, all ? "todas las sedes" : ""), content: toCsv(headers, rows), rows: rows.length };
}
