import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Empty } from "@/components/ui";
import { engineerMenu, MENU_CLASS, type MenuClass } from "@/lib/core/menu-engineering";
import { addDays, jornadaKey } from "@/lib/core/time";
import { fmtNum, fmtShort, fmtTime } from "@/lib/format";
import { cop } from "@/lib/money";
import { can, requireStaff } from "@/lib/server/auth";
import { getBusiness } from "@/lib/server/business";
import { type ControlAction, controlReport, dishSales, kitchenTimes, tipShares } from "@/lib/server/reports";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Reportes" };

const ACTION: Record<ControlAction, string> = {
  void: "Anulaciones",
  courtesy: "Cortesías",
  discount: "Descuentos",
  payment_removed: "Pagos quitados",
  sale_voided: "Ventas anuladas",
  invoice_reissued: "Refacturadas",
};
const ONE: Record<string, string> = {
  void: "Anuló",
  courtesy: "Cortesía",
  discount: "Descuento",
  payment_removed: "Quitó un pago",
  sale_voided: "Anuló la venta",
  invoice_reissued: "Refacturó",
};
const mins = (n: number) => `${Math.round(n)} min`;
const hourLabel = (h: number) => `${((h + 11) % 12) + 1} ${h < 12 ? "a. m." : "p. m."}`;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ rango?: string }> }) {
  const staff = await requireStaff();
  if (!can.manage(staff)) redirect("/panel");
  const { rango } = await searchParams;
  const span = rango === "hoy" ? 1 : rango === "14" ? 14 : rango === "30" ? 30 : 7;
  const today = jornadaKey();
  const from = addDays(today, -(span - 1));
  const biz = await getBusiness(staff.business_id);
  const s = biz.settings;
  const [control, kitchen, dishes, tips] = await Promise.all([
    controlReport(staff.business_id, from, today),
    kitchenTimes(staff.business_id, from, today, { barra: s.kds.barraLate, cocina: s.kds.cocinaLate }),
    dishSales(staff.business_id, from, today),
    tipShares(staff.business_id, from, today, s.tips),
  ]);
  const menu = engineerMenu(dishes);
  const tab = (active: boolean) => cn("rounded-xl px-4 py-2.5 text-[15px] font-semibold", active ? "bg-tinto text-cal" : "text-tinto-2 hover:bg-tinto/6");
  const slowHour = kitchen.hours.filter((h) => h.count >= 5).sort((a, b) => b.avg - a.avg)[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Reportes</h1>
          <p className="text-humo">{span === 1 ? "Hoy, en lo que va de la jornada." : `Las últimas ${span} jornadas, con hoy (desde el ${fmtShort(`${from}T12:00:00-05:00`)}).`}</p>
        </div>
        <nav className="flex gap-1 rounded-2xl bg-papel p-1 ring-1 ring-linea" aria-label="Período">
          {(
            [
              ["hoy", "Hoy"],
              ["7", "7 días"],
              ["14", "14 días"],
              ["30", "30 días"],
            ] as const
          ).map(([k, label]) => (
            <Link key={k} href={`/panel/reportes?rango=${k}`} className={tab((k === "hoy" ? 1 : Number(k)) === span)}>
              {label}
            </Link>
          ))}
        </nav>
      </div>

      <section className="rounded-3xl bg-papel p-5 ring-1 ring-linea">
        <h2 className="font-bold">Control</h2>
        <p className="text-sm text-humo">Lo que se quitó o se regaló: cuánto, quién lo pidió, quién autorizó y por qué.</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {(["void", "courtesy", "discount", "payment_removed", "sale_voided"] as const).map((a) => {
            const t = control.totals[a];
            return (
              <div key={a} className={cn("rounded-2xl p-3 ring-1", t?.count ? "bg-cal ring-linea" : "ring-linea")}>
                <p className="text-sm text-humo">{ACTION[a]}</p>
                <p className="text-xl font-bold tnum">{cop(t?.amount ?? 0)}</p>
                <p className="text-sm text-humo">{t?.count ?? 0} en el período</p>
              </div>
            );
          })}
        </div>
        {control.people.length ? (
          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
            <div className="min-w-0">
              <h3 className="mb-2 text-sm font-semibold text-humo">Por persona (quien lo pidió)</h3>
              <div className="table-scroll">
                <table className="w-full min-w-[480px] text-left text-[15px]">
                  <thead>
                    <tr className="border-b border-linea text-sm text-humo">
                      <th className="py-2 pr-3 font-semibold">Persona</th>
                      <th className="py-2 pr-3 text-right font-semibold">Anuló</th>
                      <th className="py-2 pr-3 text-right font-semibold">Cortesías</th>
                      <th className="py-2 pr-3 text-right font-semibold">Descuentos</th>
                      <th className="py-2 text-right font-semibold">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {control.people.map((p) => (
                      <tr key={p.name} className="border-b border-linea last:border-0">
                        <td className="py-2 pr-3 font-semibold">{p.name}</td>
                        <td className="py-2 pr-3 text-right tnum">{p.byAction.void ?? 0}</td>
                        <td className="py-2 pr-3 text-right tnum">{p.byAction.courtesy ?? 0}</td>
                        <td className="py-2 pr-3 text-right tnum">{p.byAction.discount ?? 0}</td>
                        <td className="py-2 text-right font-semibold tnum">{cop(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="space-y-4">
              {control.authorizers.length ? (
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-humo">Quién autorizó</h3>
                  <ul className="space-y-1">
                    {control.authorizers.map((a) => (
                      <li key={a.name} className="flex justify-between gap-3 rounded-xl bg-cal px-3 py-2">
                        <span className="font-semibold">{a.name}</span>
                        <span className="tnum text-humo">
                          {a.count} · {cop(a.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {control.reasons.length ? (
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-humo">Motivos más usados</h3>
                  <ul className="flex flex-wrap gap-1.5">
                    {control.reasons.map((r) => (
                      <li key={r.reason} className="rounded-full bg-cal px-3 py-1.5 text-sm">
                        {r.reason} <b className="tnum">{r.count}</b>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="mt-3 rounded-2xl bg-cal px-4 py-3 text-humo">Nada anulado, regalado ni descontado en el período.</p>
        )}
        {control.events.length ? (
          <details className="mt-4">
            <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-balcon">Ver lo último ({control.events.length})</summary>
            <ul className="mt-2 divide-y divide-linea">
              {control.events.map((e, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-[15px]">
                  <span className="w-28 shrink-0 text-sm text-humo">
                    {fmtShort(e.at)} {fmtTime(e.at)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <b>{ONE[e.action] ?? e.action}</b>
                    {e.item ? ` ${e.item}` : ""}
                    {e.check ? ` · cuenta #${e.check}` : ""} · {e.who}
                    {e.authorizedBy && e.authorizedBy !== e.who ? `, autorizó ${e.authorizedBy}` : ""}
                    {e.reason ? <span className="block text-sm text-humo">{e.reason}</span> : null}
                  </span>
                  <span className="font-semibold tnum">{cop(e.amount)}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section className="rounded-3xl bg-papel p-5 ring-1 ring-linea">
        <h2 className="font-bold">Tiempos de barra y cocina</h2>
        <p className="text-sm text-humo">Desde que se envía hasta que sale listo. Tarde es pasar del rojo de cada pantalla (Ajustes → Barra y cocina).</p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {kitchen.stations.map((st) => (
            <div key={st.station} className="rounded-2xl bg-cal p-4">
              <p className="font-semibold">{st.station === "barra" ? "Barra" : "Cocina"}</p>
              {st.count ? (
                <>
                  <p className="mt-1 text-2xl font-bold tnum">{mins(st.avg)} en promedio</p>
                  <p className="text-sm text-humo">
                    9 de cada 10 en {mins(st.p90)} o menos ·{" "}
                    <span className={cn("font-semibold", st.latePct > 15 ? "text-cereza" : "text-tinto")}>
                      {st.latePct} % pasó de {st.lateAt} min
                    </span>{" "}
                    · {st.count} productos
                  </p>
                </>
              ) : (
                <p className="mt-1 text-humo">Sin productos marcados como listos en el período.</p>
              )}
            </div>
          ))}
        </div>
        {slowHour ? <p className="mt-2 text-sm text-humo">La hora más lenta: {hourLabel(slowHour.hour)}, con {mins(slowHour.avg)} en promedio.</p> : null}
        {kitchen.dishes.length ? (
          <>
            <h3 className="mb-2 mt-4 text-sm font-semibold text-humo">Los que más se demoran (3 o más pedidos)</h3>
            <div className="table-scroll">
              <table className="w-full min-w-[440px] text-left text-[15px]">
                <thead>
                  <tr className="border-b border-linea text-sm text-humo">
                    <th className="py-2 pr-3 font-semibold">Plato</th>
                    <th className="py-2 pr-3 font-semibold">Dónde</th>
                    <th className="py-2 pr-3 text-right font-semibold">Promedio</th>
                    <th className="py-2 text-right font-semibold">Tarde</th>
                  </tr>
                </thead>
                <tbody>
                  {kitchen.dishes.map((d) => (
                    <tr key={`${d.station}${d.name}`} className="border-b border-linea last:border-0">
                      <td className="py-2 pr-3 font-semibold">{d.name}</td>
                      <td className="py-2 pr-3 text-humo">{d.station === "barra" ? "Barra" : "Cocina"}</td>
                      <td className="py-2 pr-3 text-right tnum">{mins(d.avg)}</td>
                      <td className="py-2 text-right tnum">
                        {d.late} de {d.count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>

      <section className="rounded-3xl bg-papel p-5 ring-1 ring-linea">
        <h2 className="font-bold">Ingeniería de menú</h2>
        <p className="text-sm text-humo">
          Cada plato según cuánto se pide y cuánto deja (venta sin impuesto menos lo que cuestan sus insumos).
          {menu.dishes.length ? ` Popular: desde ${fmtNum(menu.popularityLine * 100)} % de lo pedido. Deja bien: desde ${cop(Math.round(menu.marginLine))} por unidad.` : ""}
        </p>
        {menu.dishes.length ? (
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
            {(["estrella", "caballo", "enigma", "perro"] as MenuClass[]).map((cls) => {
              const list = menu.dishes.filter((d) => d.cls === cls);
              const tone = cls === "estrella" ? "bg-puerta-soft" : cls === "perro" ? "bg-cereza-soft" : "bg-fachada-soft";
              return (
                <div key={cls} className={cn("rounded-2xl p-4", tone)}>
                  <p className="font-bold">
                    {MENU_CLASS[cls].label} · {list.length}
                  </p>
                  <p className="text-sm">
                    {MENU_CLASS[cls].what} {MENU_CLASS[cls].todo}
                  </p>
                  {list.length ? (
                    <ul className="mt-2 space-y-1">
                      {list.slice(0, 8).map((d) => (
                        <li key={d.id} className="flex justify-between gap-3 rounded-xl bg-papel/70 px-3 py-1.5 text-[15px]">
                          <span className="min-w-0 truncate font-semibold">{d.name}</span>
                          <span className="shrink-0 text-sm tnum text-tinto-2">
                            {d.units} · deja {cop(Math.round(d.unitMargin))}
                          </span>
                        </li>
                      ))}
                      {list.length > 8 ? <li className="px-3 text-sm text-tinto-2">y {list.length - 8} más</li> : null}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <Empty title="Sin ventas cerradas en el período">Cuando haya cuentas cobradas, aquí sale cada plato en su cuadrante.</Empty>
        )}
        {dishes.some((d) => d.units && !d.cost) ? <p className="mt-2 text-sm text-humo">Los platos sin receta salen como si no costaran nada: ponles receta en Carta para que el margen sea real.</p> : null}
      </section>

      <section className="rounded-3xl bg-papel p-5 ring-1 ring-linea">
        <h2 className="font-bold">Propina por repartir</h2>
        <p className="text-sm text-humo">
          {cop(tips.total)} en el período, {s.tips.split === "horas" ? "repartida por las horas que cada quien marcó con su PIN" : "en partes iguales entre quienes trabajaron"}. Ley 1935: es de quienes atienden y se
          reparte al menos cada mes. Cómo y entre quiénes, en Ajustes → Propina.
        </p>
        {tips.shares.length ? (
          <div className="table-scroll mt-3">
            <table className="w-full min-w-[360px] text-left text-[15px]">
              <thead>
                <tr className="border-b border-linea text-sm text-humo">
                  <th className="py-2 pr-3 font-semibold">Persona</th>
                  <th className="py-2 pr-3 text-right font-semibold">Horas</th>
                  <th className="py-2 text-right font-semibold">Le toca</th>
                </tr>
              </thead>
              <tbody>
                {tips.shares.map((p) => (
                  <tr key={p.id} className="border-b border-linea last:border-0">
                    <td className="py-2 pr-3 font-semibold">{p.name}</td>
                    <td className="py-2 pr-3 text-right tnum">{fmtNum(p.minutes / 60)}</td>
                    <td className="py-2 text-right font-bold tnum">{cop(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 rounded-2xl bg-cal px-4 py-3 text-humo">{tips.total ? "Nadie de los cargos que reciben propina marcó turno en el período." : "Sin propinas en el período."}</p>
        )}
      </section>
    </div>
  );
}
