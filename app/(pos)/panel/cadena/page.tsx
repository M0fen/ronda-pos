import { AlertTriangle, PackageOpen, Store } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { GoToSede } from "@/components/sede-picker";
import { Empty, Pill } from "@/components/ui";
import { addDays, jornadaKey } from "@/lib/core/time";
import { cop } from "@/lib/money";
import { can, requireStaff } from "@/lib/server/auth";
import { getBusiness } from "@/lib/server/business";
import { chainReport, type SedeSummary } from "@/lib/server/chain";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Cadena" };

const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);
const profitOf = (s: SedeSummary) => s.report.totals.net - s.report.totals.cogs - s.report.totals.labor - s.report.totals.commission;
const deliveredOf = (s: SedeSummary) => s.report.channels.filter((c) => c.key !== "local").reduce((a, c) => a + c.net, 0);

export default async function ChainPage({ searchParams }: { searchParams: Promise<{ rango?: string }> }) {
  const staff = await requireStaff();
  if (!can.chain(staff)) redirect("/panel");
  const { rango } = await searchParams;
  const span = rango === "hoy" ? 1 : rango === "14" ? 14 : 7;
  const today = jornadaKey();
  const range = span === 1 ? { from: today, to: today } : { from: addDays(today, -span), to: addDays(today, -1) };
  const [{ sedes, totals }, biz] = await Promise.all([chainReport(staff.business_id, range), getBusiness(staff.business_id)]);
  const profit = totals.net - totals.cogs - totals.labor - totals.commission;
  const ranked = [...sedes].sort((a, b) => pct(profitOf(b), b.report.totals.net) - pct(profitOf(a), a.report.totals.net));
  // Sin ventas no hay con qué comparar: nada de insignias (antes de abrir, todas quedarían "mejor" o "peor" por azar)
  const withSales = ranked.filter((s) => s.report.totals.net > 0);
  const best = withSales.length > 1 ? withSales[0] : undefined;
  const worst = withSales.length > 1 ? withSales[withSales.length - 1] : undefined;
  const laborPill = (s: SedeSummary, labor: number) =>
    s.report.totals.net > 0 ? <Pill tone={labor > s.report.alertPct ? "red" : labor > 30 ? "yellow" : "green"}>{labor} %</Pill> : <Pill tone="neutral">Sin ventas aún</Pill>;
  const maxNet = Math.max(1, ...sedes.map((s) => s.report.totals.net));
  const tab = (active: boolean) => `rounded-xl px-4 py-2 text-[15px] font-semibold ${active ? "bg-tinto text-cal" : "text-tinto-2 hover:bg-tinto/6"}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {biz.name} · {sedes.length} sedes
          </h1>
          <p className="text-humo">Todas las sedes en una sola pantalla: ventas sin impuesto ni propina, insumos, equipo, comisiones de las plataformas y lo que queda{span === 1 ? ", hoy." : `, en las últimas ${span} jornadas cerradas.`}</p>
        </div>
        <nav className="flex rounded-2xl bg-papel p-1 ring-1 ring-linea" aria-label="Periodo">
          <Link href="/panel/cadena?rango=hoy" className={tab(span === 1)}>
            Hoy
          </Link>
          <Link href="/panel/cadena" className={tab(span === 7)}>
            7 días
          </Link>
          <Link href="/panel/cadena?rango=14" className={tab(span === 14)}>
            14 días
          </Link>
        </nav>
      </div>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Kpi wide label="Ventas netas de la cadena" value={cop(totals.net)} sub={`${totals.checks} cuentas · ticket promedio ${cop(totals.net / Math.max(1, totals.checks))}`} dark />
        <Kpi label="Lo que queda" value={cop(profit)} sub={`${pct(profit, totals.net)} % de lo vendido, después de insumos, equipo y comisiones: para arriendo, servicios y ganancia`} />
        <Kpi label="Domicilios" value={`${pct(totals.delivered, totals.net)} %`} sub={`de las ventas · comisiones ${cop(totals.commission)}`} />
        <Kpi label="Equipo" value={totals.net ? `${pct(totals.labor, totals.net)} %` : "Sin ventas aún"} sub={totals.net ? `de las ventas · insumos ${pct(totals.cogs, totals.net)} %` : `costo hasta ahora ${cop(totals.labor)}`} />
        <Kpi label="En turno ahora" value={String(totals.onShift)} sub={`personas en ${sedes.filter((s) => s.report.live?.onShift.length).length} sedes`} />
      </section>

      <section className="rounded-3xl bg-papel p-5 ring-1 ring-linea">
        <h2 className="font-bold">Sedes lado a lado</h2>
        <p className="mb-3 text-sm text-humo">Ordenadas por lo que deja cada peso vendido. Toca una sede para pasar esta tablet allá.</p>
        {/* En el celular, una tarjeta por sede */}
        <ul className="divide-y divide-linea lg:hidden">
          {ranked.map((s) => {
            const t = s.report.totals;
            const labor = pct(t.labor, t.net);
            return (
              <li key={s.id} className="py-3">
                <div className="flex items-start justify-between gap-2">
                  <span>
                    <span className="flex items-center gap-2 font-bold">
                      <Store size={18} /> {s.sede}
                    </span>
                    {s === best ? <Pill tone="green">La que más deja</Pill> : s === worst ? <Pill tone="yellow">Para revisar</Pill> : null}
                  </span>
                  <span className="text-right">
                    <span className={cn("block font-bold tnum", profitOf(s) < 0 && "text-cereza")}>{cop(profitOf(s))}</span>
                    <span className="block text-[13px] text-humo">queda el {pct(profitOf(s), t.net)} %</span>
                  </span>
                </div>
                <p className="mt-2 text-sm text-tinto-2">
                  Vendió <b className="tnum">{cop(t.net)}</b> · ticket {cop(t.net / Math.max(1, t.checks))}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-humo">
                  <span>Domicilios {pct(deliveredOf(s), t.net)} %</span>
                  <span>Insumos {pct(t.cogs, t.net)} %</span>
                  <span>
                    Equipo {laborPill(s, labor)}
                  </span>
                </p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-humo">
                    {s.report.live?.onShift.length ?? 0} en turno · {s.open} {s.open === 1 ? "cuenta abierta" : "cuentas abiertas"} · {s.delivery} {s.delivery === 1 ? "domicilio" : "domicilios"}
                  </span>
                  {s.id === staff.business_id ? <Pill tone="green">Esta tablet</Pill> : <GoToSede id={s.id} label={`Ir a ${s.sede}`} />}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="table-scroll hidden lg:block">
          <table className="w-full min-w-[880px] text-left">
            <thead>
              <tr className="border-b border-linea text-sm text-humo">
                <th className="py-2 pr-3 font-semibold">Sede</th>
                <th className="py-2 pr-3 font-semibold">Ventas netas</th>
                <th className="py-2 pr-3 text-right font-semibold">Ticket</th>
                <th className="py-2 pr-3 text-right font-semibold">Domicilios</th>
                <th className="py-2 pr-3 text-right font-semibold">Insumos</th>
                <th className="py-2 pr-3 text-right font-semibold">Equipo</th>
                <th className="py-2 pr-3 text-right font-semibold">Queda</th>
                <th className="py-2 font-semibold">Ahora</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-linea">
              {ranked.map((s) => {
                const t = s.report.totals;
                const labor = pct(t.labor, t.net);
                return (
                  <tr key={s.id} className="align-middle">
                    <td className="py-3 pr-3">
                      <span className="flex items-center gap-2 font-bold">
                        <Store size={18} /> {s.sede}
                      </span>
                      {s === best ? <Pill tone="green">La que más deja</Pill> : s === worst ? <Pill tone="yellow">Para revisar</Pill> : null}
                    </td>
                    <td className="py-3 pr-3">
                      <span className="block font-semibold tnum">{cop(t.net)}</span>
                      <span className="mt-1 block h-2 w-40 overflow-hidden rounded-full bg-tinto/8">
                        <span className="block h-full rounded-full bg-balcon" style={{ width: `${(t.net / maxNet) * 100}%` }} />
                      </span>
                    </td>
                    <td className="py-3 pr-3 text-right tnum">{cop(t.net / Math.max(1, t.checks))}</td>
                    <td className="py-3 pr-3 text-right tnum">{pct(deliveredOf(s), t.net)} %</td>
                    <td className="py-3 pr-3 text-right tnum">{pct(t.cogs, t.net)} %</td>
                    <td className="py-3 pr-3 text-right">
                      {laborPill(s, labor)}
                    </td>
                    <td className={cn("py-3 pr-3 text-right font-bold tnum", profitOf(s) < 0 && "text-cereza")}>
                      {cop(profitOf(s))}
                      <span className="block text-[13px] font-normal text-humo">{pct(profitOf(s), t.net)} %</span>
                    </td>
                    <td className="py-3 text-sm">
                      <span className="block">
                        {s.report.live?.onShift.length ?? 0} en turno · {s.open} {s.open === 1 ? "cuenta abierta" : "cuentas abiertas"}
                      </span>
                      <span className="block text-humo">{s.delivery === 1 ? "1 domicilio en curso" : `${s.delivery} domicilios en curso`}</span>
                      <span className="mt-1 inline-block">
                        {s.id === staff.business_id ? <Pill tone="green">Esta tablet</Pill> : <GoToSede id={s.id} label={`Ir a ${s.sede}`} />}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl bg-papel p-5 ring-1 ring-linea">
          <h2 className="flex items-center gap-2 font-bold">
            <AlertTriangle size={18} className="text-cereza" /> Alertas por sede
          </h2>
          <ul className="mt-2 divide-y divide-linea">
            {sedes.map((s) => {
              const red = s.report.alerts.filter((a) => a.tone === "red");
              return (
                <li key={s.id} className="py-2.5">
                  <span className="font-semibold">{s.sede}</span>{" "}
                  <span className="text-sm text-humo">
                    · {red.length} {red.length === 1 ? "alerta" : "alertas"} de jornada · equipo hoy {s.report.live?.today.net ? `${pct(s.report.live.today.labor, s.report.live.today.net)} %` : "sin ventas aún"}
                  </span>
                  {red[0] ? <span className="mt-0.5 block text-[15px]">{red[0].text}</span> : <span className="mt-0.5 block text-[15px] text-humo">Sin alertas rojas.</span>}
                </li>
              );
            })}
          </ul>
        </div>
        <div className="rounded-3xl bg-papel p-5 ring-1 ring-linea">
          <h2 className="flex items-center gap-2 font-bold">
            <PackageOpen size={18} /> Por comprar en cada sede
          </h2>
          {sedes.some((s) => s.low.length) ? (
            <ul className="mt-2 divide-y divide-linea">
              {sedes
                .filter((s) => s.low.length)
                .map((s) => (
                  <li key={s.id} className="py-2.5">
                    <span className="font-semibold">{s.sede}</span>
                    <span className="block text-[15px] text-tinto-2">{s.low.map((l) => l.name).join(" · ")}</span>
                  </li>
                ))}
            </ul>
          ) : (
            <Empty title="Todas las sedes están por encima del mínimo" />
          )}
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value, sub, wide, dark }: { label: string; value: string; sub: string; wide?: boolean; dark?: boolean }) {
  return (
    <div className={cn("min-w-0 rounded-3xl p-4 ring-1 sm:p-5", dark ? "bg-tinto text-cal ring-tinto" : "bg-papel ring-linea", wide && "col-span-2 xl:col-span-1")}>
      <p className={dark ? "text-cal/75" : "text-humo"}>{label}</p>
      <p className="mt-1 text-2xl font-bold tnum sm:text-3xl">{value}</p>
      <p className={cn("mt-1 text-sm", dark ? "text-cal/70" : "text-humo")}>{sub}</p>
    </div>
  );
}
