"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { applyTaxAction, resetDemoAction, saveSettingsAction } from "@/app/(pos)/panel/actions";
import { btn } from "@/components/ui";
import type { Settings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { report } from "../toast";

const DAYS = ["L", "M", "X", "J", "V", "S", "D"];

export function SettingsForm({
  initial,
  demo,
  ephemeral,
  isOwner,
  canReset,
  lastInvoice,
}: {
  initial: Settings;
  demo: boolean;
  ephemeral: boolean;
  isOwner: boolean;
  canReset: boolean;
  lastInvoice: number;
}) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  // Lo que se escribe en los campos de números: vacío es un error, no un 0
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const up = <G extends keyof Settings, K extends keyof Settings[G]>(g: G, k: K, v: Settings[G][K]) => setS((x) => ({ ...x, [g]: { ...x[g], [k]: v } }));
  const text = <G extends keyof Settings>(g: G, k: keyof Settings[G], label: string, opts: { type?: string; hint?: string; disabled?: boolean } = {}) => {
    const key = `${String(g)}.${String(k)}`;
    const number = opts.type === "number";
    return (
      <label className="block">
        <span className="text-sm font-semibold text-humo">{label}</span>
        <input
          type={number ? "text" : (opts.type ?? "text")}
          inputMode={number ? "numeric" : undefined}
          disabled={opts.disabled}
          className={cn("mt-1 h-12 w-full rounded-xl border bg-papel px-3 outline-none focus:border-tinto disabled:opacity-50", number && raw[key] === "" ? "border-cereza" : "border-linea-2")}
          value={number ? (raw[key] ?? String(s[g][k] ?? "")) : String(s[g][k] ?? "")}
          onChange={(e) => {
            if (!number) return up(g, k, e.target.value as Settings[typeof g][typeof k]);
            const v = e.target.value.replace(/[^\d]/g, "").slice(0, 9);
            setRaw((r) => ({ ...r, [key]: v }));
            if (v !== "") up(g, k, Number(v) as Settings[typeof g][typeof k]);
          }}
        />
        {opts.hint ? <span className="mt-1 block text-[13px] text-humo">{opts.hint}</span> : null}
      </label>
    );
  };
  function save() {
    const empty = Object.entries(raw).find(([, v]) => v === "");
    if (empty) return report({ ok: false, error: "Hay un número vacío en los ajustes: escribe un valor (puede ser 0)" });
    start(async () => void (report(await saveSettingsAction(s)) && (setRaw({}), router.refresh())));
  }
  const left = s.invoice.rangeTo ? s.invoice.rangeTo - lastInvoice : null;
  const daysLeft = s.invoice.validTo ? Math.ceil((Date.parse(`${s.invoice.validTo}T23:59:59-05:00`) - Date.now()) / 86_400_000) : null;
  const toggle = <G extends keyof Settings>(g: G, k: keyof Settings[G], label: string, hint?: string) => (
    <label className="flex items-start gap-3 rounded-2xl bg-cal p-3">
      <input type="checkbox" className="mt-1 size-5 accent-[var(--color-balcon)]" checked={!!s[g][k]} onChange={(e) => up(g, k, e.target.checked as Settings[typeof g][typeof k])} />
      <span>
        <span className="block font-semibold">{label}</span>
        {hint ? <span className="block text-[13px] text-humo">{hint}</span> : null}
      </span>
    </label>
  );
  return (
    <div className="pb-24">
      <h1 className="text-2xl font-bold">Ajustes</h1>
      <p className="text-humo">Todo lo que cambia entre un local y otro se ajusta aquí, sin tocar código.</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="El local">
          {text("business", "name", "Nombre")}
          {text("business", "legalName", "Razón social")}
          <div className="grid grid-cols-2 gap-3">
            {text("business", "nit", "NIT")}
            {text("business", "phone", "Teléfono")}
          </div>
          {text("business", "address", "Dirección")}
          {text("business", "instagram", "Instagram")}
        </Card>
        <Card title="Marca">
          {toggle("theme", "whiteLabel", "Usar la marca del local en todo el sistema", "Cambia el nombre de Ronda por el del local y pone estos colores en todas las pantallas. El color principal lleva letra blanca: usa uno oscuro.")}
          <div className="grid grid-cols-2 gap-3">
            {(["primary", "accent"] as const).map((k) => (
              <label key={k} className="flex items-center gap-3 rounded-2xl bg-cal p-3">
                <input type="color" className="size-11 rounded-lg" value={s.theme[k]} onChange={(e) => up("theme", k, e.target.value)} />
                <span className="font-semibold">{k === "primary" ? "Color principal" : "Color de acento"}</span>
              </label>
            ))}
          </div>
          <div className="rounded-2xl p-4 text-white" style={{ background: s.theme.primary }}>
            <p className="text-sm text-white/80">Vista previa</p>
            <p className="text-xl font-bold">{s.business.name}</p>
            <span className="mt-2 inline-block rounded-md px-2 py-0.5 text-sm font-semibold text-tinto" style={{ background: s.theme.accent }}>
              Happy hour
            </span>
          </div>
        </Card>
        <Card title="Impuesto y propina">
          <div className="grid grid-cols-2 gap-3">
            {text("tax", "label", "Nombre del impuesto")}
            {text("tax", "rate", "Tarifa (%)", { type: "number", hint: "Restaurantes y bares: 8 % de impuesto al consumo. Los productos nuevos toman esta tarifa." })}
          </div>
          <button
            className={btn("soft", "sm")}
            disabled={pending}
            onClick={() => start(async () => void (report(await applyTaxAction(s.tax.rate)) && router.refresh()))}
          >
            Aplicar el {s.tax.rate} % a toda la carta
          </button>
          {toggle("tips", "enabled", "Propina voluntaria", "El cobro pregunta siempre si el cliente la incluye")}
          {text("tips", "suggestedPct", "Propina sugerida (%)", { type: "number", hint: "La ley no permite sugerir más del 10 %" })}
        </Card>
        <Card title="Medios de pago">
          <div className="grid grid-cols-2 gap-2">
            {(["efectivo", "tarjeta", "nequi", "breb", "daviplata"] as const).map((m) => (
              <label key={m} className="flex items-center gap-2 rounded-xl bg-cal px-3 py-2.5 font-semibold">
                <input type="checkbox" className="size-5" checked={s.payments[m]} onChange={(e) => up("payments", m, e.target.checked)} />
                {m === "breb" ? "Bre-B" : m.charAt(0).toUpperCase() + m.slice(1)}
              </label>
            ))}
          </div>
          {text("payments", "brebKey", "Llave Bre-B del local", { hint: "La que creaste en tu banco: celular, NIT o llave personalizada" })}
          {text("payments", "nequiPhone", "Celular de Nequi")}
        </Card>
        <Card title="Happy hour">
          {toggle("happyHour", "enabled", "Activar happy hour", "Los precios especiales se aplican solos en la caja y en la carta QR")}
          {text("happyHour", "label", "Nombre")}
          <div className="grid max-w-sm grid-cols-7 gap-1.5">
            {DAYS.map((d, i) => {
              const day = i + 1;
              const on = s.happyHour.days.includes(day);
              return (
                <button key={d} type="button" onClick={() => up("happyHour", "days", on ? s.happyHour.days.filter((x) => x !== day) : [...s.happyHour.days, day])} className={cn("h-11 rounded-xl font-bold ring-1", on ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}>
                  {d}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {text("happyHour", "from", "Desde", { type: "time" })}
            {text("happyHour", "to", "Hasta", { type: "time" })}
          </div>
        </Card>
        <Card title="Sellos y premios">
          {toggle("loyalty", "enabled", "Programa de sellos", "El cliente suma con su celular, sin descargar nada")}
          <div className="grid grid-cols-2 gap-3">
            {text("loyalty", "minPurchase", "Compra mínima por sello", { type: "number" })}
            {text("loyalty", "goal", "Sellos para el premio", { type: "number" })}
          </div>
          {text("loyalty", "reward", "Premio")}
          {text("loyalty", "rewardMax", "Valor máximo del premio", { type: "number" })}
        </Card>
        <Card title="Carta QR">
          {toggle("qr", "enabled", "Los clientes pueden pedir desde la mesa")}
          {toggle("qr", "requireApproval", "El mesero aprueba cada pedido antes de enviarlo")}
          {toggle("qr", "payAtTable", "Pagar desde la mesa con Bre-B o Nequi", "El pago queda por confirmar hasta que caja vea que llegó")}
        </Card>
        <Card title="Control y factura">
          <div className="grid grid-cols-2 gap-3">
            {text("alerts", "voidLimit", "Anulación grande desde ($)", { type: "number", hint: "Sale señalada en el panel y en el resumen del día" })}
            {text("alerts", "discountLimitPct", "Descuento sin autorización hasta (%)", { type: "number" })}
          </div>
          {text("alerts", "ownerWhatsapp", "WhatsApp del dueño", { hint: "El botón del resumen del día abre WhatsApp con este número" })}
          {text("security", "lockMinutes", "Bloquear la tablet tras estos minutos sin uso", { type: "number", hint: "Pide otra vez el PIN de quien tiene la sesión. 0 la deja sin bloqueo." })}
          {text("receipt", "footer", "Mensaje al final del recibo")}
        </Card>
        <Card title="Resolución de facturación (DIAN)">
          <div className="grid grid-cols-2 gap-3">
            {text("invoice", "prefix", "Prefijo", { hint: "Letras y números, hasta 4. Cada sede usa el suyo." })}
            {text("invoice", "provider", "Proveedor de facturación")}
          </div>
          {text("invoice", "resolution", "Número de la resolución")}
          <div className="grid grid-cols-2 gap-3">
            {text("invoice", "rangeFrom", "Rango desde", { type: "number" })}
            {text("invoice", "rangeTo", "Rango hasta", { type: "number" })}
            {text("invoice", "validFrom", "Vigente desde", { type: "date" })}
            {text("invoice", "validTo", "Vigente hasta", { type: "date" })}
          </div>
          {left !== null || daysLeft !== null ? (
            <p className={cn("rounded-xl px-3 py-2 text-sm font-semibold", (left !== null && left < 200) || (daysLeft !== null && daysLeft < 30) ? "bg-fachada-soft text-[#6b4b00]" : "bg-cal")}>
              {left !== null ? `Quedan ${Math.max(0, left).toLocaleString("es-CO")} números del rango (la última factura es la ${lastInvoice}). ` : ""}
              {daysLeft !== null ? (daysLeft < 0 ? "La resolución está vencida: no se puede facturar." : `Vence en ${daysLeft} días.`) : ""} Fuera del rango o de la vigencia, el cobro no deja facturar.
            </p>
          ) : (
            <p className="text-[13px] text-humo">Con el rango y la vigencia cargados, el sistema avisa antes de que se acaben y no factura por fuera de ellos.</p>
          )}
        </Card>
        <Card title="Domicilios">
          {toggle("channels", "rappi", "Rappi")}
          {text("channels", "rappiPct", "Comisión de Rappi (%)", { type: "number", disabled: !isOwner, hint: isOwner ? "La que tengas pactada: así la rentabilidad muestra lo que de verdad te queda por canal" : "La pone el dueño: con ella se comparan las sedes" })}
          {toggle("channels", "didi", "DiDi Food")}
          {text("channels", "didiPct", "Comisión de DiDi Food (%)", { type: "number", disabled: !isOwner })}
          {toggle("channels", "propio", "Domicilio propio", "Pedidos por WhatsApp o teléfono con tus domiciliarios")}
        </Card>
        <Card title="Costo del equipo">
          {isOwner ? (
            toggle("labor", "exonerated", "Exonerado de salud, SENA e ICBF", "Artículo 114-1 del Estatuto Tributario. Aplica a la mayoría de las S.A.S.; confírmalo con tu contador.")
          ) : (
            <p className="rounded-2xl bg-cal p-3 text-sm">
              {s.labor.exonerated ? "Exonerado" : "No exonerado"} de salud, SENA e ICBF y riesgo de ARL clase {s.labor.arlClass}: los pone el dueño, porque con ellos se comparan las sedes.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-semibold text-humo">Riesgo de la ARL</span>
              <select
                disabled={!isOwner}
                className="mt-1 h-12 w-full rounded-xl border border-linea-2 bg-papel px-3 outline-none focus:border-tinto disabled:opacity-50"
                value={s.labor.arlClass}
                onChange={(e) => up("labor", "arlClass", Number(e.target.value))}
              >
                {["I", "II", "III", "IV", "V"].map((c, i) => (
                  <option key={c} value={i + 1}>
                    Clase {c}
                  </option>
                ))}
              </select>
            </label>
            {text("labor", "alertPct", "Alerta de mano de obra (%)", { type: "number", hint: "Cuando el equipo pasa de este % de lo vendido" })}
          </div>
          <p className="text-sm font-semibold text-humo">Turnos del local</p>
          {s.labor.turnos.map((tu, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-2">
              <input
                aria-label="Nombre del turno"
                className="h-12 min-w-0 rounded-xl border border-linea-2 bg-papel px-3 outline-none focus:border-tinto"
                value={tu.name}
                onChange={(e) => up("labor", "turnos", s.labor.turnos.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              />
              <input
                type="time"
                aria-label={`Hora en que empieza ${tu.name}`}
                className="h-12 rounded-xl border border-linea-2 bg-papel px-3 outline-none focus:border-tinto"
                value={tu.from}
                onChange={(e) => up("labor", "turnos", s.labor.turnos.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))}
              />
              <button className={btn("ghost", "md")} disabled={s.labor.turnos.length <= 1} onClick={() => up("labor", "turnos", s.labor.turnos.filter((_, j) => j !== i))}>
                Quitar
              </button>
            </div>
          ))}
          {s.labor.turnos.length < 4 ? (
            <button className={btn("soft", "sm")} onClick={() => up("labor", "turnos", [...s.labor.turnos, { name: "Nuevo turno", from: "20:00" }])}>
              Agregar turno
            </button>
          ) : null}
          <p className="text-[13px] text-humo">Cada turno va desde su hora hasta que empieza el siguiente, y el último hasta el cierre. Rentabilidad compara lo que vende cada turno con lo que cuesta el equipo en esas horas.</p>
        </Card>
      </div>
      {demo && canReset ? (
        <div className="mt-4 rounded-3xl bg-papel p-5 ring-1 ring-linea">
          <p className="font-bold">Demo</p>
          <p className="text-sm text-humo">{ephemeral ? "Los datos viven en memoria y se reinician solos cuando el servidor descansa." : "Los datos de ejemplo están guardados en este equipo."}</p>
          <button
            className={btn("soft", "md", "mt-3")}
            disabled={pending}
            onClick={() =>
              start(async () => {
                if (report(await resetDemoAction())) router.push("/entrar");
              })
            }
          >
            <RotateCcw size={16} /> Volver a los datos de ejemplo
          </button>
        </div>
      ) : null}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-linea bg-cal/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] justify-end">
          <button className={btn("primary", "lg", "min-w-56")} disabled={pending} onClick={save}>
            Guardar ajustes
          </button>
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-3xl bg-papel p-5 ring-1 ring-linea">
      <h2 className="font-bold">{title}</h2>
      {children}
    </section>
  );
}
