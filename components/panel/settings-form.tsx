"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { resetDemoAction, saveSettingsAction } from "@/app/(pos)/panel/actions";
import { btn } from "@/components/ui";
import type { Settings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { report } from "../toast";

const DAYS = ["L", "M", "X", "J", "V", "S", "D"];

export function SettingsForm({ initial, demo, ephemeral }: { initial: Settings; demo: boolean; ephemeral: boolean }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [pending, start] = useTransition();
  const up = <G extends keyof Settings, K extends keyof Settings[G]>(g: G, k: K, v: Settings[G][K]) => setS((x) => ({ ...x, [g]: { ...x[g], [k]: v } }));
  const text = <G extends keyof Settings>(g: G, k: keyof Settings[G], label: string, opts: { type?: string; hint?: string } = {}) => (
    <label className="block">
      <span className="text-sm font-semibold text-humo">{label}</span>
      <input
        type={opts.type ?? "text"}
        className="mt-1 h-12 w-full rounded-xl border border-linea-2 bg-papel px-3 outline-none focus:border-tinto"
        value={String(s[g][k] ?? "")}
        onChange={(e) => up(g, k, (opts.type === "number" ? Number(e.target.value) : e.target.value) as Settings[typeof g][typeof k])}
      />
      {opts.hint ? <span className="mt-1 block text-[13px] text-humo">{opts.hint}</span> : null}
    </label>
  );
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
        <Card title="Marca en la carta QR">
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
            {text("tax", "rate", "Tarifa (%)", { type: "number", hint: "Restaurantes y bares: 8 % de impuesto al consumo" })}
          </div>
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
            {text("alerts", "voidLimit", "Avisar anulaciones desde ($)", { type: "number" })}
            {text("alerts", "discountLimitPct", "Descuento sin autorización hasta (%)", { type: "number" })}
          </div>
          {text("alerts", "ownerWhatsapp", "WhatsApp del dueño", { hint: "Para el resumen del día" })}
          <div className="grid grid-cols-2 gap-3">
            {text("invoice", "prefix", "Prefijo de factura")}
            {text("invoice", "provider", "Proveedor de facturación")}
          </div>
          {text("invoice", "resolution", "Resolución DIAN")}
          {text("receipt", "footer", "Mensaje al final del recibo")}
        </Card>
      </div>
      {demo ? (
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
          <button className={btn("primary", "lg", "min-w-56")} disabled={pending} onClick={() => start(async () => void (report(await saveSettingsAction(s)) && router.refresh()))}>
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
