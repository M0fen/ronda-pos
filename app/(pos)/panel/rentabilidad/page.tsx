import { AlertTriangle, CalendarDays, Info, Moon, UserX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CloseShift } from "@/components/panel/close-shift";
import { Avatar, Empty, Pill } from "@/components/ui";
import { dayLabel, fmtHours } from "@/lib/core/labor";
import { addDays, bogotaParts, clock, jornadaKey } from "@/lib/core/time";
import { fmtTime } from "@/lib/format";
import { cop } from "@/lib/money";
import { can, requireStaff } from "@/lib/server/auth";
import { profitReport, type ProfitRow } from "@/lib/server/labor";
import { ROLE_LABEL } from "@/lib/settings";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Rentabilidad" };

const WEEKDAY = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);
const profitOf = (r: ProfitRow) => r.net - r.cogs - r.labor;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default async function ProfitPage({ searchParams }: { searchParams: Promise<{ rango?: string }> }) {
  const staff = await requireStaff();
  if (!can.manage(staff)) redirect("/panel");
  const { rango } = await searchParams;
  const span = rango === "hoy" ? 1 : rango === "14" ? 14 : 7;
  const today = jornadaKey();
  // Hoy, en vivo; 7 y 14 días, las jornadas ya cerradas (hoy va en el bloque de arriba)
  const r = await profitReport(staff.business_id, span === 1 ? { from: today, to: today } : { from: addDays(today, -span), to: addDays(today, -1) });
  const t = r.totals;
  const profit = profitOf(t);
  const hours = t.minutes / 60;
  const laborPct = pct(t.labor, t.net);
  const cogsPct = pct(t.cogs, t.net);
  const tone = (labor: number, net: number) => (!net ? (labor ? "red" : "none") : pct(labor, net) > r.alertPct ? "red" : pct(labor, net) > 30 ? "yellow" : "green");
  const tab = (active: boolean) => `rounded-xl px-4 py-2 text-[15px] font-semibold ${active ? "bg-tinto text-cal" : "text-tinto-2 hover:bg-tinto/6"}`;
  const now = bogotaParts();
  const nowHHMM = `${String(now.hour).padStart(2, "0")}:${String(now.minutes % 60).padStart(2, "0")}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Rentabilidad</h1>
          <p className="text-humo">
            Lo que vendes sin impuesto ni propina, frente a los insumos de las recetas y lo que cuesta el equipo
            {span === 1 ? ", hoy." : `, en las últimas ${span} jornadas cerradas.`}
          </p>
        </div>
        <nav className="flex rounded-2xl bg-papel p-1 ring-1 ring-linea" aria-label="Periodo">
          <Link href="/panel/rentabilidad?rango=hoy" className={tab(span === 1)} aria-current={span === 1 ? "page" : undefined}>
            Hoy
          </Link>
          <Link href="/panel/rentabilidad" className={tab(span === 7)} aria-current={span === 7 ? "page" : undefined}>
            7 días
          </Link>
          <Link href="/panel/rentabilidad?rango=14" className={tab(span === 14)} aria-current={span === 14 ? "page" : undefined}>
            14 días
          </Link>
        </nav>
      </div>

      {r.live ? (
        <section className="grid gap-4 rounded-3xl bg-tinto p-5 text-cal lg:grid-cols-[1fr_1.2fr]">
          <div>
            <p className="text-cal/75">Ahora · mano de obra de hoy</p>
            {r.live.today.net ? (
              <p className={cn("mt-1 text-5xl font-bold tracking-tight tnum [font-stretch:105%]", pct(r.live.today.labor, r.live.today.net) > r.alertPct && "text-fachada")}>{pct(r.live.today.labor, r.live.today.net)} %</p>
            ) : (
              <p className="mt-1 text-3xl font-bold">Sin ventas todavía</p>
            )}
            <p className="mt-2 text-[15px] text-cal/80">
              El equipo va en {cop(r.live.today.labor)} y las ventas netas en {cop(r.live.today.net)}.{" "}
              {r.live.today.net && pct(r.live.today.labor, r.live.today.net) > r.alertPct ? `Pasa del ${r.alertPct} %: revisa si sobra gente en este turno.` : `La alerta salta sobre el ${r.alertPct} %.`}
            </p>
          </div>
          <div>
            <p className="text-cal/75">{r.live.onShift.length ? `${r.live.onShift.length} ${r.live.onShift.length === 1 ? "persona en turno" : "personas en turno"}` : "Nadie ha marcado entrada"}</p>
            <ul className="mt-2 divide-y divide-white/10">
              {r.live.onShift.map((p) => (
                <li key={p.shiftId} className="flex items-center gap-3 py-2">
                  <Avatar name={p.name} color={p.color} size={36} />
                  <span className="flex-1 leading-tight">
                    <span className="block font-semibold">{p.name}</span>
                    <span className="block text-sm text-cal/70">
                      Desde las {fmtTime(p.since)} · {fmtHours(p.minutes)} · {cop(p.cost)}
                    </span>
                  </span>
                  <CloseShift shiftId={p.shiftId} name={p.name} nowHHMM={nowHHMM} urgent={p.long} />
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm text-cal/60">Cada quien marca su entrada y su salida con su PIN en la pantalla de entrada (Marcar turno).</p>
          </div>
        </section>
      ) : null}

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Stat wide label="Ventas netas" value={cop(t.net)} sub={`${t.checks} cuentas · propinas aparte: ${cop(t.tips)}`} />
        <Stat label="Insumos" value={`${cogsPct} %`} sub={`${cop(t.cogs)} según las recetas`} />
        <Stat label="Equipo" value={`${laborPct} %`} sub={`${cop(t.labor)} · ${fmtHours(t.minutes)} trabajadas`} alert={laborPct > r.alertPct} />
        <Stat label="Utilidad bruta" value={cop(profit)} sub={`${pct(profit, t.net)} % de las ventas, antes de arriendo y servicios`} />
        <Stat label="Ventas por hora trabajada" value={hours ? cop(t.net / hours) : "—"} sub={hours ? `La hora del equipo cuesta en promedio ${cop(t.labor / hours)}` : "Nadie ha marcado turno"} />
      </section>

      {t.net ? (
        <section className="rounded-3xl bg-papel p-5 ring-1 ring-linea">
          <h2 className="font-bold">De cada $100 que vendes</h2>
          <p className="mt-1 text-tinto-2">
            ${cogsPct} se van en insumos, ${laborPct} en el equipo y te quedan ${Math.max(0, 100 - cogsPct - laborPct)} para arriendo, servicios y ganancia.
            {cogsPct + laborPct > 60 ? " Insumos y equipo juntos pasan de 60: es la señal para ajustar turnos o precios." : " Insumos y equipo juntos están por debajo de 60, un rango sano para un restaurante."}
          </p>
          <div className="relative mt-4 flex h-5 overflow-hidden rounded-full bg-cal" aria-hidden>
            <span className="bg-fachada" style={{ width: `${Math.min(100, cogsPct)}%` }} />
            <span className="bg-balcon" style={{ width: `${Math.min(100 - Math.min(100, cogsPct), laborPct)}%` }} />
            <span className="flex-1 bg-puerta" />
            <span className="absolute inset-y-0 w-0.5 bg-tinto" style={{ left: "60%" }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-humo">
            <Legend color="bg-fachada" label={`Insumos ${cogsPct} %`} />
            <Legend color="bg-balcon" label={`Equipo ${laborPct} %`} />
            <Legend color="bg-puerta" label={`Queda ${Math.max(0, 100 - cogsPct - laborPct)} %`} />
            <span>La raya marca el 60 %</span>
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
        <div className="min-w-0 rounded-3xl bg-papel p-5 ring-1 ring-linea">
          {span === 1 ? (
            <>
              <h2 className="font-bold">Turnos de hoy</h2>
              <p className="mb-3 text-sm text-humo">Ventas por la hora de cierre de la cuenta; el equipo, por las horas que trabajó en cada turno.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {r.turnos.map((tu, i) => {
                  const row = r.live?.byTurno[i];
                  return <TurnoCard key={tu.name} title={tu.name} sub={`Desde las ${clock(tu.from)}`} row={row} tone={row ? tone(row.labor, row.net) : "none"} />;
                })}
              </div>
            </>
          ) : (
            <>
              <h2 className="font-bold">Qué turnos se pagan solos</h2>
              <p className="mb-3 text-sm text-humo">
                Promedio de cada turno en las últimas {span} jornadas: utilidad después de insumos y equipo, y cuánto de lo vendido se va en el equipo.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] border-separate border-spacing-1.5 text-left">
                  <thead>
                    <tr className="text-sm text-humo">
                      <th className="font-semibold" />
                      {r.turnos.map((tu) => (
                        <th key={tu.name} className="px-2 font-semibold">
                          {tu.name} <span className="font-normal">· desde las {clock(tu.from)}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {r.grid.map((g) => (
                      <tr key={g.dow}>
                        <th className="pr-2 text-[15px] font-semibold">{WEEKDAY[g.dow]}</th>
                        {g.cells.map((c, i) => {
                          if (!c.n) return <td key={i} className="rounded-xl bg-cal px-3 py-2 text-humo">—</td>;
                          const avg = { net: c.net / c.n, labor: c.labor / c.n, cogs: c.cogs / c.n };
                          const tn = tone(avg.labor, avg.net);
                          return (
                            <td key={i} className={cn("rounded-xl px-3 py-2", tn === "red" ? "bg-cereza-soft" : tn === "yellow" ? "bg-fachada-soft" : "bg-puerta-soft")}>
                              <span className={cn("block text-lg font-bold tnum", avg.net - avg.cogs - avg.labor < 0 && "text-cereza")}>{cop(avg.net - avg.cogs - avg.labor)}</span>
                              <span className="block text-[13px] text-tinto-2">
                                Equipo {pct(avg.labor, avg.net)} % · vende {cop(avg.net)}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-sm text-humo">
                Verde: el equipo cuesta hasta el 30 % de lo que vende el turno. Amarillo: hasta el {r.alertPct} %. Rojo: más.
              </p>
            </>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <div className="rounded-3xl bg-papel p-5 ring-1 ring-linea">
            <h2 className="flex items-center gap-2 font-bold">
              <AlertTriangle size={18} className="text-cereza" /> Jornada y recargos
            </h2>
            {r.alerts.length || r.missingPay.length ? (
              <ul className="mt-2 divide-y divide-linea">
                {r.missingPay.length ? (
                  <li className="flex gap-2 py-2 text-[15px]">
                    <UserX size={18} className="mt-0.5 shrink-0 text-humo" />
                    <span>
                      Sin pago registrado: {r.missingPay.join(", ")}. Regístralo en{" "}
                      <Link href="/panel/equipo" className="font-semibold underline">
                        Equipo
                      </Link>{" "}
                      para que sus horas sumen al costo.
                    </span>
                  </li>
                ) : null}
                {r.alerts.map((a, i) => (
                  <li key={i} className="flex gap-2 py-2 text-[15px]">
                    {a.tone === "neutral" ? <CalendarDays size={18} className="mt-0.5 shrink-0 text-humo" /> : <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", a.tone === "red" ? "bg-cereza" : "bg-fachada")} />}
                    <span>{cap(a.text)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-humo">Nadie pasa de la jornada ni de las horas extra permitidas en este periodo.</p>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-3xl bg-papel p-5 ring-1 ring-linea">
        <h2 className="font-bold">Equipo</h2>
        <p className="mb-3 text-sm text-humo">Horas marcadas, lo que costaron con recargos y carga, y lo que vendió cada quien en las cuentas que abrió. Las propinas van aparte: no son salario.</p>
        {r.people.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-linea text-sm text-humo">
                  <th className="py-2 pr-3 font-semibold">Persona</th>
                  <th className="py-2 pr-3 font-semibold">Horas</th>
                  <th className="py-2 pr-3 text-right font-semibold">Costo</th>
                  <th className="py-2 pr-3 text-right font-semibold">Vendió</th>
                  <th className="py-2 text-right font-semibold">Propinas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linea">
                {r.people.map((p) => {
                  const h = p.minutes / 60;
                  const s = p.split;
                  const parts = [
                    s.night + s.restNight + s.extraNight + s.extraRestNight ? `${fmtHours(s.night + s.restNight + s.extraNight + s.extraRestNight)} de noche` : "",
                    s.rest + s.restNight + s.extraRest + s.extraRestNight ? `${fmtHours(s.rest + s.restNight + s.extraRest + s.extraRestNight)} domingo o festivo` : "",
                    s.extra + s.extraNight + s.extraRest + s.extraRestNight ? `${fmtHours(s.extra + s.extraNight + s.extraRest + s.extraRestNight)} extra` : "",
                  ].filter(Boolean);
                  return (
                    <tr key={p.id} className="align-top">
                      <td className="py-3 pr-3">
                        <span className="flex items-center gap-3">
                          <Avatar name={p.name} color={p.color} size={36} />
                          <span className="leading-tight">
                            <span className="block font-semibold">{p.name}</span>
                            <span className="block text-sm text-humo">
                              {ROLE_LABEL[p.role] ?? p.role} · {p.payAmount ? (p.payKind === "hora" ? `${cop(p.payAmount)} la hora` : `salario ${cop(p.payAmount)}`) : "sin pago registrado"}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="py-3 pr-3">
                        <span className="block font-semibold tnum">{p.minutes ? fmtHours(p.minutes) : "—"}</span>
                        {parts.length ? (
                          <span className="flex items-start gap-1 text-[13px] text-humo">
                            <Moon size={13} className="mt-0.5 shrink-0" />
                            {parts.join(" · ")}
                          </span>
                        ) : p.minutes ? (
                          <span className="text-[13px] text-humo">Todo de día y entre semana</span>
                        ) : (
                          <span className="text-[13px] text-humo">No marcó turno</span>
                        )}
                      </td>
                      <td className="py-3 pr-3 text-right">
                        <span className="block font-semibold tnum">{p.cost ? cop(p.cost) : "—"}</span>
                        {h && p.cost ? <span className="text-[13px] text-humo tnum">{cop(p.cost / h)} la hora</span> : null}
                      </td>
                      <td className="py-3 pr-3 text-right">
                        <span className="block font-semibold tnum">{p.net ? cop(p.net) : "—"}</span>
                        <span className="text-[13px] text-humo tnum">{p.net && h ? `${cop(p.net / h)} por hora · ${p.checks} cuentas` : p.net ? `${p.checks} cuentas` : "No abre cuentas"}</span>
                      </td>
                      <td className="py-3 text-right font-semibold tnum">{p.tips ? cop(p.tips) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Todavía nadie ha marcado turno">Cada persona marca su entrada y su salida con su PIN en la pantalla de entrada.</Empty>
        )}
      </section>

      {span > 1 ? (
        <section className="rounded-3xl bg-papel p-5 ring-1 ring-linea">
          <h2 className="mb-3 font-bold">Día por día</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead>
                <tr className="border-b border-linea text-sm text-humo">
                  <th className="py-2 pr-3 font-semibold">Jornada</th>
                  <th className="py-2 pr-3 text-right font-semibold">Ventas netas</th>
                  <th className="py-2 pr-3 text-right font-semibold">Insumos</th>
                  <th className="py-2 pr-3 text-right font-semibold">Equipo</th>
                  <th className="py-2 pr-3 text-right font-semibold">% equipo</th>
                  <th className="py-2 text-right font-semibold">Utilidad</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linea">
                {r.days.map((d) => {
                  const tn = tone(d.total.labor, d.total.net);
                  return (
                    <tr key={d.day}>
                      <td className="py-2.5 pr-3 font-semibold">
                        {cap(dayLabel(d.day))}
                      </td>
                      <td className="py-2.5 pr-3 text-right tnum">{cop(d.total.net)}</td>
                      <td className="py-2.5 pr-3 text-right tnum">{cop(d.total.cogs)}</td>
                      <td className="py-2.5 pr-3 text-right tnum">{cop(d.total.labor)}</td>
                      <td className="py-2.5 pr-3 text-right">
                        <Pill tone={tn === "red" ? "red" : tn === "yellow" ? "yellow" : "green"}>{d.total.net ? `${pct(d.total.labor, d.total.net)} %` : "—"}</Pill>
                      </td>
                      <td className={cn("py-2.5 text-right font-semibold tnum", profitOf(d.total) < 0 && "text-cereza")}>{cop(profitOf(d.total))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="flex gap-3 rounded-3xl bg-papel p-5 text-[15px] text-tinto-2 ring-1 ring-linea">
        <Info size={20} className="mt-0.5 shrink-0 text-humo" />
        <p>
          <span className="font-semibold text-tinto">Cómo se calcula. </span>
          La hora ordinaria es el salario dividido entre {r.rules.divisor} (jornada de {r.rules.weeklyHours} horas). Recargos de hoy: nocturno del {Math.round(r.rules.night * 100)} % desde las{" "}
          {clock(`${String(r.rules.nightFrom).padStart(2, "0")}:00`)}, dominical y festivo del {Math.round(r.rules.rest * 100)} %, extra del {Math.round(r.rules.extraDay * 100)} % de día y del{" "}
          {Math.round(r.rules.extraNight * 100)} % de noche; pasar de 9 horas en un día o de {r.rules.weeklyHours} en la semana cuenta como extra. Encima del salario va un {String(Math.round(r.load * 1000) / 10).replace(".", ",")} % de
          seguridad social, caja y prestaciones, y el auxilio de transporte ({cop(r.rules.transport)} al mes) para quien gana hasta dos mínimos. Quien cobra por horas cuesta lo pactado. Es una
          estimación para decidir turnos: la nómina la liquida tu contador.
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value, sub, alert, wide }: { label: string; value: string; sub: string; alert?: boolean; wide?: boolean }) {
  return (
    <div className={cn("min-w-0 rounded-3xl p-4 ring-1 sm:p-5", alert ? "bg-cereza-soft ring-cereza/30" : "bg-papel ring-linea", wide && "col-span-2 xl:col-span-1")}>
      <p className={alert ? "font-semibold text-cereza" : "text-humo"}>{label}</p>
      <p className="mt-1 text-2xl font-bold tnum sm:text-3xl">{value}</p>
      <p className="mt-1 text-sm text-humo">{sub}</p>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-3 rounded-sm", color)} /> {label}
    </span>
  );
}

function TurnoCard({ title, sub, row, tone }: { title: string; sub: string; row?: ProfitRow; tone: string }) {
  const profit = row ? profitOf(row) : 0;
  return (
    <div className={cn("rounded-2xl p-4 ring-1", tone === "red" ? "bg-cereza-soft ring-cereza/20" : tone === "yellow" ? "bg-fachada-soft ring-fachada/40" : "bg-cal ring-linea")}>
      <p className="font-bold">{title}</p>
      <p className="text-sm text-humo">{sub}</p>
      {row && (row.net || row.labor) ? (
        <dl className="mt-3 grid grid-cols-2 gap-y-1 text-[15px]">
          <dt className="text-humo">Ventas netas</dt>
          <dd className="text-right font-semibold tnum">{cop(row.net)}</dd>
          <dt className="text-humo">Insumos</dt>
          <dd className="text-right tnum">{cop(row.cogs)}</dd>
          <dt className="text-humo">Equipo · {fmtHours(row.minutes)}</dt>
          <dd className="text-right tnum">{cop(row.labor)}</dd>
          <dt className="font-semibold">Utilidad</dt>
          <dd className={cn("text-right font-bold tnum", profit < 0 && "text-cereza")}>{cop(profit)}</dd>
        </dl>
      ) : (
        <p className="mt-3 text-sm text-humo">Todavía sin movimiento.</p>
      )}
    </div>
  );
}
