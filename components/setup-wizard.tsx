"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setupAction } from "@/app/alta/actions";
import { btn } from "@/components/ui";
import { cn } from "@/lib/utils";
import { report, toast } from "./toast";

const KINDS = [
  ["cafe", "Café"],
  ["bar", "Bar"],
  ["restaurante", "Restaurante"],
] as const;
const TAXES = [
  ["consumo", "Impuesto al consumo (8 %)"],
  ["iva", "IVA (19 %)"],
  ["ninguno", "No cobro impuesto"],
] as const;
const field = "mt-1 h-12 w-full rounded-xl border border-linea-2 bg-papel px-3 outline-none focus:border-tinto";

/** Tres pasos: el local, el salón y el dueño. Al terminar, esta tablet queda enrolada y el dueño adentro. */
export function SetupWizard({ code }: { code: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [step, setStep] = useState(0);
  const [f, setF] = useState({
    token: code,
    kind: "cafe" as (typeof KINDS)[number][0],
    name: "",
    legalName: "",
    nit: "",
    city: "",
    address: "",
    phone: "",
    sede: "",
    tax: "consumo" as (typeof TAXES)[number][0],
    tables: 6,
    barSeats: 0,
    owner: "",
    pin: "",
    pin2: "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const next = () => {
    if (step === 0 && (f.token.trim().length < 12 || f.name.trim().length < 2)) return toast(f.token.trim().length < 12 ? "Escribe el código de instalación" : "Escribe el nombre del local", { tone: "error" });
    if (step === 1 && !f.tables && !f.barSeats) return toast("Pon al menos una mesa o una silla de barra", { tone: "error" });
    setStep(step + 1);
  };
  const finish = () => {
    if (f.owner.trim().length < 2) return toast("Escribe tu nombre", { tone: "error" });
    if (!/^\d{6}$/.test(f.pin)) return toast("El PIN es de 6 números", { tone: "error" });
    if (f.pin !== f.pin2) return toast("Los dos PIN no coinciden", { tone: "error" });
    start(async () => {
      const { pin2: _repeat, ...input } = f;
      void _repeat;
      if (report(await setupAction(input))) router.replace("/panel");
    });
  };
  const stepper = (k: "tables" | "barSeats", label: string, hint: string) => (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-papel p-4 ring-1 ring-linea">
      <span>
        <span className="block font-semibold">{label}</span>
        <span className="text-sm text-humo">{hint}</span>
      </span>
      <span className="flex items-center gap-2">
        <button className={btn("soft", "md", "w-12")} onClick={() => set(k, Math.max(0, f[k] - 1))} aria-label={`${label}: una menos`}>
          −
        </button>
        <span className="w-8 text-center text-2xl font-bold tnum">{f[k]}</span>
        <button className={btn("soft", "md", "w-12")} onClick={() => set(k, Math.min(11, f[k] + 1))} aria-label={`${label}: una más`}>
          +
        </button>
      </span>
    </div>
  );
  return (
    <div className="mt-6">
      <ol className="flex gap-2 text-sm font-semibold" aria-label="Pasos">
        {["El local", "El salón", "Tu acceso"].map((s, i) => (
          <li key={s} className={cn("flex-1 rounded-full px-3 py-1.5 text-center", i === step ? "bg-tinto text-cal" : i < step ? "bg-puerta/15 text-puerta-2" : "bg-tinto/6 text-humo")} aria-current={i === step ? "step" : undefined}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <div className="mt-5 space-y-3">
          <label className="block">
            <span className="text-sm font-semibold text-humo">Código de instalación</span>
            <input className={cn(field, "font-mono")} value={f.token} onChange={(e) => set("token", e.target.value)} autoComplete="off" placeholder="El SETUP_TOKEN del servidor" />
          </label>
          <div>
            <span className="text-sm font-semibold text-humo">¿Qué es?</span>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {KINDS.map(([k, l]) => (
                <button key={k} onClick={() => set("kind", k)} className={cn("h-12 rounded-xl font-semibold ring-1", f.kind === k ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}>
                  {l}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[13px] text-humo">Con eso se crean unas categorías de ejemplo para la carta; las cambias cuando quieras.</p>
          </div>
          <label className="block">
            <span className="text-sm font-semibold text-humo">Nombre del local</span>
            <input className={field} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Como lo conocen tus clientes" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-sm font-semibold text-humo">Razón social</span>
              <input className={field} value={f.legalName} onChange={(e) => set("legalName", e.target.value)} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-humo">NIT</span>
              <input className={cn(field, "tnum")} value={f.nit} onChange={(e) => set("nit", e.target.value)} placeholder="900123456-7" />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-humo">Ciudad</span>
              <input className={field} value={f.city} onChange={(e) => set("city", e.target.value)} placeholder="Pereira, Risaralda" />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-humo">Celular del local</span>
              <input inputMode="tel" className={cn(field, "tnum")} value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="3001234567" />
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-semibold text-humo">Dirección</span>
            <input className={field} value={f.address} onChange={(e) => set("address", e.target.value)} />
          </label>
          <div>
            <span className="text-sm font-semibold text-humo">Impuesto en tus precios</span>
            <div className="mt-1 grid gap-2">
              {TAXES.map(([k, l]) => (
                <button key={k} onClick={() => set("tax", k)} className={cn("h-12 rounded-xl px-4 text-left font-semibold ring-1", f.tax === k ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}>
                  {l}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[13px] text-humo">Si no estás seguro, pregúntale a tu contador. Se puede cambiar después en Ajustes.</p>
          </div>
        </div>
      ) : step === 1 ? (
        <div className="mt-5 space-y-3">
          {stepper("tables", "Mesas", "De 4 puestos; luego cambias puestos, forma y lugar en el plano")}
          {stepper("barSeats", "Sillas de barra", "Un puesto cada una. Solo barra = modo mostrador")}
          <label className="block">
            <span className="text-sm font-semibold text-humo">Nombre de la sede (si vas a tener varias)</span>
            <input className={field} value={f.sede} onChange={(e) => set("sede", e.target.value)} placeholder="Ej. Centro" />
          </label>
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          <label className="block">
            <span className="text-sm font-semibold text-humo">Tu nombre</span>
            <input className={field} value={f.owner} onChange={(e) => set("owner", e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-sm font-semibold text-humo">PIN de dueño (6 números)</span>
              <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} className={cn(field, "tnum tracking-[0.4em]")} value={f.pin} onChange={(e) => set("pin", e.target.value.replace(/\D/g, ""))} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-humo">Repítelo</span>
              <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} className={cn(field, "tnum tracking-[0.4em]")} value={f.pin2} onChange={(e) => set("pin2", e.target.value.replace(/\D/g, ""))} />
            </label>
          </div>
          <p className="text-[13px] text-humo">Con este PIN autorizas anulaciones, cortesías y descuentos. No lo compartas. Esta tablet queda enrolada para entrar.</p>
        </div>
      )}

      <div className="mt-6 flex gap-2">
        {step ? (
          <button className={btn("soft", "lg")} onClick={() => setStep(step - 1)} disabled={pending}>
            Atrás
          </button>
        ) : null}
        {step < 2 ? (
          <button className={btn("primary", "lg", "flex-1")} onClick={next}>
            Siguiente
          </button>
        ) : (
          <button className={btn("primary", "lg", "flex-1")} onClick={finish} disabled={pending}>
            {pending ? "Creando…" : "Crear el local"}
          </button>
        )}
      </div>
    </div>
  );
}
