import { AlertTriangle, ChevronRight, MessageCircle, PackageOpen, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BarList, ColumnChart } from "@/components/charts";
import { btn, Empty, Pill } from "@/components/ui";
import { methodsFor } from "@/lib/core/cash";
import { addDays, bogotaParts, jornadaKey, weekdayOf } from "@/lib/core/time";
import { fmtDay, fmtShort, fmtTime } from "@/lib/format";
import { can, requireStaff } from "@/lib/server/auth";
import { getBusiness } from "@/lib/server/business";
import { formatStock, ingredientsView, needsBuying } from "@/lib/server/inventory";
import { laborToday } from "@/lib/server/labor";
import { setupProgress } from "@/lib/server/setup";
import { dailySales, dayReport, salesOn } from "@/lib/server/reports";
import { cop } from "@/lib/money";
import { METHOD_LABEL } from "@/lib/settings";
import { missingSessionSecret } from "@/lib/session";
import { ownerSummary } from "@/lib/summary";

export const metadata: Metadata = { title: "Panel" };

const WEEKDAY = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

export default async function PanelHome({ searchParams }: { searchParams: Promise<{ dia?: string }> }) {
  const staff = await requireStaff();
  const { dia } = await searchParams;
  const today = jornadaKey();
  const yesterday = addDays(today, -1);
  // Cualquier jornada de los últimos 90 días; por defecto, la de hoy
  const day = dia && /^\d{4}-\d{2}-\d{2}$/.test(dia) && dia <= today && dia >= addDays(today, -90) ? dia : today;
  const isToday = day === today;
  const weekday = WEEKDAY[weekdayOf(day)] ?? "";
  const showLabor = isToday && can.manage(staff);
  const settings = (await getBusiness(staff.business_id)).settings;
  const [report, daily, lastWeek, ingredients, biz, labor, steps] = await Promise.all([
    dayReport(staff.business_id, day, settings.alerts.voidLimit),
    dailySales(staff.business_id, 14),
    // Hoy se compara con el mismo día de la semana pasada a esta misma hora; un día cerrado, completo
    salesOn(staff.business_id, addDays(day, -7), isToday ? new Date(Date.now() - 7 * 86_400_000) : undefined),
    ingredientsView(staff.business_id),
    getBusiness(staff.business_id),
    showLabor ? laborToday(staff.business_id) : null,
    can.manage(staff) ? setupProgress(staff.business_id) : null,
  ]);
  const low = ingredients.filter(needsBuying);
  const delta = lastWeek ? Math.round(((report.net - lastWeek) / lastWeek) * 100) : null;
  const dayLabel = fmtDay(`${day}T12:00:00-05:00`);
  const before = daily.find((d) => d.day === yesterday);
  // Arqueo a ciegas: quien cuenta el cajón (caja) no ve cuánto entró en efectivo, ni en «Cómo pagaron» ni en el resumen para WhatsApp
  const blind = !can.seeExpected(staff);
  const methods = methodsFor(report.byMethod, !blind);
  const text = ownerSummary({
    business: biz.name,
    dayLabel,
    sales: report.net,
    gross: report.gross,
    checks: report.checks,
    avgTicket: report.avgTicket,
    tips: report.tips,
    lastWeek,
    weekday,
    partial: isToday,
    top: report.topProducts,
    methods,
    cashHidden: blind,
    voids: report.voids,
    courtesies: report.courtesies,
    discounts: report.discounts,
    removed: report.removed,
    lowStock: low.map((i) => i.name),
    open: isToday ? report.openNow : { n: 0, amount: 0 },
  });
  const wa = biz.settings.alerts.ownerWhatsapp ? `https://wa.me/57${biz.settings.alerts.ownerWhatsapp}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
  const tab = (active: boolean) => `rounded-xl px-4 py-2 text-[15px] font-semibold ${active ? "bg-tinto text-cal" : "text-tinto-2 hover:bg-tinto/6"}`;

  return (
    <div className="space-y-4">
      {staff.role === "owner" && missingSessionSecret() ? (
        <p className="rounded-2xl bg-cereza-soft px-4 py-3 text-sm font-semibold text-cereza">
          Falta SESSION_SECRET en el servidor: ponlo en las variables de entorno (32 caracteres al azar) antes de usar el sistema con datos reales.
        </p>
      ) : null}
      {steps ? (
        <section className="rounded-3xl bg-papel p-5 ring-1 ring-linea">
          <h2 className="font-bold">Para empezar a vender</h2>
          <p className="text-sm text-humo">
            Van {steps.filter((s) => s.done).length} de {steps.length}. Esta lista se va cuando esté lo necesario para vender.
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {steps.map((s) => (
              <li key={s.label}>
                <Link href={s.href} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 ring-1 ring-linea hover:ring-tinto">
                  <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${s.done ? "bg-puerta text-white" : "ring-2 ring-linea-2"}`} aria-hidden>
                    {s.done ? "✓" : ""}
                  </span>
                  <span className={s.done ? "text-humo line-through" : "font-semibold"}>{s.label}</span>
                  <ChevronRight size={16} className="ml-auto shrink-0 text-humo" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{dayLabel}</h1>
          <p className="text-humo">{isToday ? `Jornada en curso · cuentas cerradas hasta las ${fmtTime(new Date())}` : "Jornada completa, hasta las 5:00 a. m. del día siguiente"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <nav className="flex rounded-2xl bg-papel p-1 ring-1 ring-linea" aria-label="Día">
            <Link href="/panel" className={tab(isToday)} aria-current={isToday ? "page" : undefined}>
              Hoy
            </Link>
            <Link href={`/panel?dia=${yesterday}`} className={tab(day === yesterday)} aria-current={day === yesterday ? "page" : undefined}>
              Ayer
            </Link>
            {!isToday && day !== yesterday ? <span className={tab(true)}>{fmtShort(`${day}T12:00:00-05:00`)}</span> : null}
          </nav>
          <a href={wa} target="_blank" rel="noopener" className={btn("send", "md")}>
            <MessageCircle size={18} /> Enviarme el resumen
          </a>
        </div>
      </div>

      {isToday && !report.checks && before?.sales ? (
        <Link href={`/panel?dia=${yesterday}`} className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-fachada/25 px-5 py-4 ring-1 ring-fachada">
          <span>
            <span className="block font-bold">Hoy todavía no hay cuentas cerradas</span>
            <span className="text-tinto-2">
              Ayer vendiste {cop(before.sales)} netos en {before.checks} cuentas.
            </span>
          </span>
          <span className={btn("dark", "sm")}>Ver cómo cerró ayer</span>
        </Link>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="rounded-3xl bg-tinto p-5 text-cal sm:col-span-2 lg:col-span-1">
          <p className="text-cal/75">{isToday ? "Ventas netas de hoy" : `Ventas netas del ${weekday}`}</p>
          <p className="mt-1 text-5xl font-bold tracking-tight tnum [font-stretch:105%]">{cop(report.net)}</p>
          <p className="text-sm text-cal/70">Sin impuesto ni propina · con impuesto {cop(report.gross)}</p>
          <p className="mt-2 text-[15px] text-cal/80">
            {delta === null ? "Sin datos del mismo día de la semana anterior" : `${delta >= 0 ? "+" : ""}${delta} % frente al ${weekday} anterior${isToday ? " a esta hora" : ""} (${cop(lastWeek)})`}
          </p>
        </div>
        <Stat label="Cuentas" value={String(report.checks)} sub={`${report.guests} personas`} />
        <Stat label="Ticket promedio" value={cop(report.avgTicket)} sub={`Sin impuesto · ${report.qrShare} % pedido por QR`} />
        <Stat
          label="Propinas (aparte)"
          value={cop(report.tips)}
          sub={isToday ? (report.openNow.n ? `${report.openNow.n} cuentas abiertas · ${cop(report.openNow.amount)}` : "Sin cuentas abiertas") : report.net ? `${Math.round((report.tips / report.net) * 1000) / 10} % sobre las ventas netas`.replace(".", ",") : "Sin ventas"}
        />
      </section>

      {labor ? (
        <Link href="/panel/rentabilidad?rango=hoy" className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-3xl px-5 py-4 ring-1 ${labor.pct !== null && labor.pct * 100 > labor.alertPct ? "bg-cereza-soft ring-cereza/30" : "bg-papel ring-linea"}`}>
          <Users size={22} className="shrink-0" />
          <span className="flex-1">
            <span className="block font-bold">
              {labor.pct === null ? "Equipo de hoy" : `El equipo va en el ${Math.round(labor.pct * 100)} % de las ventas netas de hoy`}
            </span>
            <span className="text-tinto-2">
              {labor.onShift} en turno ahora · costo de hoy {cop(labor.labor)}
              {labor.pctWithOpen !== null && labor.openNet ? ` · con lo abierto: ${Math.round(labor.pctWithOpen * 100)} %` : ""}
              {labor.pct !== null && labor.pct * 100 > labor.alertPct ? ` · pasa del ${labor.alertPct} %` : ""}
            </span>
          </span>
          <span className="inline-flex items-center gap-1 font-semibold">
            Ver rentabilidad <ChevronRight size={18} />
          </span>
        </Link>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl bg-papel p-5 ring-1 ring-linea">
          <h2 className="font-bold">Ventas por hora</h2>
          <p className="mb-4 text-sm text-humo">Netas, por hora de cierre de la cuenta</p>
          <ColumnChart label="Ventas por hora" data={report.byHour.map((h) => ({ key: String(h.hour), label: `${h.hour}`, value: h.sales, sub: `de ${h.hour}:00 a ${h.hour}:59` }))} highlight={isToday ? String(bogotaParts().hour) : undefined} />
        </div>
        <div className="rounded-3xl bg-papel p-5 ring-1 ring-linea">
          <h2 className="font-bold">Últimos 14 días</h2>
          <p className="mb-4 text-sm text-humo">Ventas netas. Toca un día para ver su detalle</p>
          <ColumnChart
            label="Ventas de los últimos 14 días"
            data={daily.map((d) => ({ key: d.day, label: d.day.slice(8), value: d.sales, sub: `${fmtShort(`${d.day}T12:00:00-05:00`)} · ${d.checks} cuentas`, href: d.day === today ? "/panel" : `/panel?dia=${d.day}` }))}
            highlight={day}
          />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-3xl bg-papel p-5 ring-1 ring-linea">
          <h2 className="font-bold">{isToday ? "Lo más vendido hoy" : "Lo más vendido"}</h2>
          <p className="mb-3 text-sm text-humo">Sin impuesto</p>
          {report.topProducts.length ? <BarList rows={report.topProducts.map((p) => ({ label: p.name, value: p.revenue, sub: `· ${p.qty}` }))} /> : <Empty title={isToday ? "Todavía no hay ventas hoy" : "Ese día no hubo ventas"} />}
        </div>
        <div className="rounded-3xl bg-papel p-5 ring-1 ring-linea">
          <h2 className="font-bold">Cómo pagaron</h2>
          <p className="mb-3 text-sm text-humo">Con impuesto, sin propina</p>
          {methods.length ? <BarList rows={methods.map((m) => ({ label: METHOD_LABEL[m.method] ?? m.method, value: m.amount, sub: `· ${m.n}` }))} /> : blind ? null : <Empty title="Sin pagos" />}
          {blind ? <p className="mt-3 text-sm text-humo">El efectivo no aparece aquí: se cuenta en el arqueo de caja.</p> : null}
          <h2 className="mt-6 mb-3 font-bold">Por mesero (netas)</h2>
          {report.byWaiter.length ? <BarList rows={report.byWaiter.map((w) => ({ label: w.name, value: w.sales, sub: `· ${w.checks} cuentas` }))} /> : <Empty title="Sin ventas" />}
        </div>
        <div className="space-y-4">
          <div className="rounded-3xl bg-papel p-5 ring-1 ring-linea">
            <h2 className="flex items-center gap-2 font-bold">
              <AlertTriangle size={18} className="text-cereza" /> Controles del día
            </h2>
            <p className="mt-1 text-sm text-humo">
              {report.voids.n} anulaciones por {cop(report.voids.amount)}
              {report.voids.big ? ` (${report.voids.big} de ${cop(settings.alerts.voidLimit)} o más)` : ""} · cortesías y premios {cop(report.courtesies)} · {report.discounts.n} descuentos por {cop(report.discounts.amount)}
            </p>
            {report.removed.n ? (
              <div className="mt-3 rounded-2xl bg-cereza-soft px-3 py-2">
                <p className="text-sm font-bold text-cereza">
                  {report.removed.n} {report.removed.n === 1 ? "pago quitado" : "pagos quitados"} por {cop(report.removed.amount)}
                </p>
                <ul className="mt-1 space-y-0.5 text-[13px]">
                  {report.removed.items.map((r, i) => (
                    <li key={i}>
                      {fmtTime(r.at)} · {METHOD_LABEL[r.method] ?? r.method} {cop(r.amount)} · {r.reason} · {r.staff ?? "—"}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {report.discards.n ? (
              <p className="mt-2 text-[13px] text-humo">
                Cuentas descartadas: {report.discards.items.map((d) => `#${d.check} (${d.staff ?? "—"}, ${fmtTime(d.at)})`).join(" · ")}
              </p>
            ) : null}
            {report.voids.items.length ? (
              <ul className="mt-3 divide-y divide-linea">
                {report.voids.items.map((v, i) => (
                  <li key={i} className="py-2 text-[15px]">
                    <span className="font-semibold">{String(v.detail.item ?? "")}</span> · {cop(v.amount)}
                    {v.amount >= settings.alerts.voidLimit ? <Pill tone="red" className="ml-1">Grande</Pill> : null}
                    <span className="block text-[13px] text-humo">
                      {[fmtTime(v.created_at), String(v.detail.reason ?? ""), `lo anuló ${v.staff ?? "alguien del equipo"}`].filter(Boolean).join(" · ")}
                      {v.detail.authorizedBy && v.detail.authorizedBy !== v.staff ? `, autorizó ${String(v.detail.authorizedBy)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="rounded-3xl bg-papel p-5 ring-1 ring-linea">
            <h2 className="flex items-center gap-2 font-bold">
              <PackageOpen size={18} /> Por comprar
            </h2>
            {low.length ? (
              <ul className="mt-2 divide-y divide-linea">
                {low.slice(0, 6).map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                    <span>
                      <span className="font-semibold">{i.name}</span>
                      <span className="block text-[13px] text-humo">{formatStock(i)}</span>
                    </span>
                    {i.low ? <Pill tone="red">Bajo el mínimo</Pill> : <Pill tone="yellow">{i.daysLeft} días</Pill>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-humo">Todo el inventario está por encima del mínimo.</p>
            )}
            <Link href="/panel/inventario" className={btn("soft", "sm", "mt-3")}>
              Ver inventario
            </Link>
          </div>
        </div>
      </section>

      <section className="rounded-3xl bg-papel p-5 ring-1 ring-linea">
        <h2 className="font-bold">El resumen para WhatsApp</h2>
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-2xl bg-[#e7f6e9] p-4 font-sans text-[15px] leading-relaxed text-tinto">{text}</pre>
        <p className="mt-2 text-sm text-humo">El botón abre WhatsApp con el resumen listo para enviar. Que llegue solo cada noche es una integración con WhatsApp Business que se configura aparte.</p>
      </section>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-3xl bg-papel p-5 ring-1 ring-linea">
      <p className="text-humo">{label}</p>
      <p className="mt-1 text-3xl font-bold tnum">{value}</p>
      <p className="mt-1 text-sm text-humo">{sub}</p>
    </div>
  );
}
