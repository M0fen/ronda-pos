"use client";

import { Cake, Copy, MessageCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { btn, Pill } from "@/components/ui";
import { fmtShort } from "@/lib/format";
import { cop } from "@/lib/money";
import { cn, formatPhone } from "@/lib/utils";
import { toast } from "../toast";

type Customer = {
  id: string;
  name: string;
  phone: string;
  stamps: number;
  visits: number;
  total_spent: number;
  last_visit: string | null;
  consent_at: string | null;
  inactive: boolean;
  nearReward: boolean;
  birthdayMonth: boolean;
  frequent: boolean;
};

const SEGMENTS = [
  { key: "todos", label: "Todos" },
  { key: "cerca", label: "Cerca del premio" },
  { key: "frecuentes", label: "Frecuentes" },
  { key: "inactivos", label: "No vuelven hace 30 días" },
  { key: "cumple", label: "Cumplen este mes" },
] as const;

export function CustomersView({ customers, loyalty, business }: { customers: Customer[]; loyalty: { goal: number; reward: string; minPurchase: number }; business: string }) {
  const [seg, setSeg] = useState<(typeof SEGMENTS)[number]["key"]>("todos");
  const list = useMemo(
    () =>
      customers.filter((c) =>
        seg === "cerca" ? c.nearReward : seg === "frecuentes" ? c.frequent : seg === "inactivos" ? c.inactive : seg === "cumple" ? c.birthdayMonth : true,
      ),
    [customers, seg],
  );
  const message =
    seg === "inactivos"
      ? `¡Hola! Te extrañamos en ${business}. Esta semana tu próximo café va por cuenta de la casa. Muestra este mensaje en caja.`
      : seg === "cumple"
        ? `¡Feliz cumpleaños de parte de ${business}! Ven esta semana y te invitamos ${loyalty.reward.toLowerCase()}.`
        : seg === "cerca"
          ? `¡Ya casi! Te falta un sello para ${loyalty.reward.toLowerCase()} en ${business}.`
          : `¡Hola! Te contamos las novedades de ${business}.`;
  const consented = list.filter((c) => c.consent_at);
  return (
    <div>
      <h1 className="text-2xl font-bold">Clientes y sellos</h1>
      <p className="text-humo">
        Un sello por visita desde {cop(loyalty.minPurchase)}. Con {loyalty.goal} sellos: {loyalty.reward.toLowerCase()}. Sin app: solo el celular.
      </p>
      <div className="scrollbar-none mt-4 flex gap-2 overflow-x-auto">
        {SEGMENTS.map((s) => {
          const n = customers.filter((c) => (s.key === "cerca" ? c.nearReward : s.key === "frecuentes" ? c.frequent : s.key === "inactivos" ? c.inactive : s.key === "cumple" ? c.birthdayMonth : true)).length;
          return (
            <button key={s.key} onClick={() => setSeg(s.key)} className={cn("shrink-0 rounded-full px-4 py-2 text-[15px] font-semibold", seg === s.key ? "bg-tinto text-cal" : "bg-papel ring-1 ring-linea")}>
              {s.label} <span className="tnum opacity-70">{n}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_360px]">
        <ul className="divide-y divide-linea rounded-3xl bg-papel px-4 ring-1 ring-linea">
          {list.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {c.name || "Sin nombre"} {c.birthdayMonth ? <Cake size={15} className="inline text-cereza" aria-label="Cumple este mes" /> : null}
                </p>
                <p className="text-sm text-humo tnum">
                  {formatPhone(c.phone)} · {c.visits} visitas · {cop(c.total_spent)} · última {c.last_visit ? fmtShort(c.last_visit) : "—"}
                </p>
              </div>
              <div className="flex gap-1" aria-label={`${c.stamps} de ${loyalty.goal} sellos`}>
                {Array.from({ length: loyalty.goal }, (_, i) => (
                  <span key={i} className={cn("size-3.5 rounded-full", i < c.stamps ? "bg-puerta" : "bg-tinto/10")} />
                ))}
              </div>
              {c.inactive ? <Pill tone="yellow">Inactivo</Pill> : null}
            </li>
          ))}
        </ul>
        <aside className="h-fit rounded-3xl bg-papel p-5 ring-1 ring-linea">
          <p className="font-bold">Mensaje para este grupo</p>
          <p className="mt-2 rounded-2xl bg-[#e7f6e9] p-3 text-[15px]">{message}</p>
          <p className="mt-3 text-sm text-humo">
            {consented.length} de {list.length} autorizaron mensajes. Solo a ellos se les escribe (Ley 1581).
          </p>
          <div className="mt-3 grid gap-2">
            <button
              className={btn("soft", "md")}
              onClick={async () => {
                await navigator.clipboard.writeText(consented.map((c) => `57${c.phone}`).join(", "));
                toast(`${consented.length} números copiados para tu lista de difusión`);
              }}
            >
              <Copy size={16} /> Copiar números
            </button>
            <a className={btn("send", "md")} href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener">
              <MessageCircle size={16} /> Abrir en WhatsApp
            </a>
          </div>
        </aside>
      </div>
    </div>
  );
}
