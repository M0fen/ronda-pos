import "server-only";
import { getSedes } from "./business";
import { getDb } from "./db";
import { ingredientsView, needsBuying } from "./inventory";
import { profitReport, type ProfitReport } from "./labor";

export interface SedeSummary {
  id: string;
  sede: string;
  report: ProfitReport;
  low: { name: string }[];
  delivery: number;
  open: number;
}

/** La cadena de un vistazo: cada sede con sus ventas, márgenes, equipo, domicilios e inventario bajo. */
export async function chainReport(bizId: string, range: { from: string; to: string }) {
  const db = await getDb();
  const sedes = await getSedes(bizId);
  const rows: SedeSummary[] = [];
  // Una sede a la vez: en la demo la base es de una sola conexión
  for (const s of sedes) {
    const report = await profitReport(s.id, range);
    // El mismo criterio de "por comprar" del Resumen y de Inventario
    const low = (await ingredientsView(s.id)).filter(needsBuying).map((i) => ({ name: i.name }));
    const live = await db.one<{ delivery: number; open: number }>(
      "select count(*) filter (where kind = 'domicilio')::int as delivery, count(*)::int as open from checks where business_id = $1 and status in ('open','bill')",
      [s.id],
    );
    rows.push({ id: s.id, sede: s.sede || s.name, report, low, delivery: live?.delivery ?? 0, open: live?.open ?? 0 });
  }
  const sum = (f: (r: ProfitReport) => number) => rows.reduce((a, s) => a + f(s.report), 0);
  const totals = {
    net: sum((r) => r.totals.net),
    cogs: sum((r) => r.totals.cogs),
    labor: sum((r) => r.totals.labor),
    commission: sum((r) => r.totals.commission),
    checks: sum((r) => r.totals.checks),
    delivered: sum((r) => r.channels.filter((c) => c.key !== "local").reduce((a, c) => a + c.net, 0)),
    onShift: rows.reduce((a, s) => a + (s.report.live?.onShift.length ?? 0), 0),
  };
  return { sedes: rows, totals };
}
