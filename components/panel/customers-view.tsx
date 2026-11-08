"use client";

import { Cake, Copy, MessageCircle, MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { deleteCustomerAction, withdrawConsentAction } from "@/app/(pos)/panel/actions";
import { btn, Pill } from "@/components/ui";
import { fmtShort } from "@/lib/format";
import { cop } from "@/lib/money";
import { cn, formatPhone } from "@/lib/utils";
import { Sheet } from "../sheet";
import { report, toast } from "../toast";

type Customer = {
  id: string;
  name: string;
  phone: string;
  stamps: number;
  visits: number;
  total_spent: number;
  last_visit: string | null;
  consent_at: string | null;
  consented: boolean;
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

export function CustomersView({
  customers,
  loyalty,
  business,
  canManage,
}: {
  customers: Customer[];
  loyalty: { goal: number; reward: string; minPurchase: number };
  business: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [seg, setSeg] = useState<(typeof SEGMENTS)[number]["key"]>("todos");
  const [manage, setManage] = useState<Customer | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const list = useMemo(
    () =>
      customers.filter((c) =>
        seg === "cerca" ? c.nearReward : seg === "frecuentes" ? c.frequent : seg === "inactivos" ? c.inactive : seg === "cumple" ? c.birthdayMonth : true,
      ),
    [customers, seg],
  );
  const message =
    seg === "inactivos"
      ? `¡Hola! Te extrañamos en ${business}. Esta semana tu próxima bebida va por cuenta de la casa. Muestra este mensaje en caja.`
      : seg === "cumple"
        ? `¡Feliz cumpleaños de parte de ${business}! Ven esta semana y te invitamos ${loyalty.reward.toLowerCase()}.`
        : seg === "cerca"
          ? `¡Ya casi! Te falta un sello para ${loyalty.reward.toLowerCase()} en ${business}.`
          : `¡Hola! Te contamos las novedades de ${business}.`;
  const consented = list.filter((c) => c.consented);
  const wa = (c: Customer) => `https://wa.me/57${c.phone}?text=${encodeURIComponent(message)}`;
  const act = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      if (report(await fn())) {
        setManage(null);
        router.refresh();
      }
    });
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
        <ul className="min-w-0 divide-y divide-linea rounded-3xl bg-papel px-4 ring-1 ring-linea">
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
              {!c.consented ? <Pill tone="neutral">Sin autorización</Pill> : null}
              {canManage ? (
                <button className="flex size-10 items-center justify-center rounded-xl hover:bg-tinto/6" aria-label={`Datos de ${c.name || c.phone}`} onClick={() => (setConfirmDelete(false), setManage(c))}>
                  <MoreHorizontal size={18} />
                </button>
              ) : null}
            </li>
          ))}
          {!list.length ? <li className="py-6 text-center text-humo">Nadie en este grupo todavía.</li> : null}
        </ul>
        <aside className="h-fit min-w-0 rounded-3xl bg-papel p-5 ring-1 ring-linea">
          <p className="font-bold">Mensaje para este grupo</p>
          <p className="mt-2 rounded-2xl bg-[#e7f6e9] p-3 text-[15px]">{message}</p>
          <p className="mt-3 text-sm text-humo">
            {consented.length} de {list.length} autorizaron mensajes: solo a ellos se les escribe (Ley 1581). Copia sus números para una lista de difusión o escríbeles uno por uno.
          </p>
          <button
            className={btn("soft", "md", "mt-3 w-full")}
            disabled={!consented.length}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(consented.map((c) => `57${c.phone}`).join(", "));
                toast(`${consented.length} números copiados para tu lista de difusión`);
              } catch {
                toast("No se pudieron copiar: escríbeles uno por uno abajo", { tone: "error" });
              }
            }}
          >
            <Copy size={16} /> Copiar los números
          </button>
          {/* WhatsApp abre un chat a la vez: un botón por cliente, ya con el mensaje */}
          <ul className="mt-3 max-h-80 space-y-1.5 overflow-y-auto">
            {consented.slice(0, 40).map((c) => (
              <li key={c.id}>
                <a className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 ring-1 ring-linea hover:ring-tinto" href={wa(c)} target="_blank" rel="noopener">
                  <span className="min-w-0 truncate text-[15px]">{c.name || formatPhone(c.phone)}</span>
                  <MessageCircle size={16} className="shrink-0 text-puerta" />
                </a>
              </li>
            ))}
          </ul>
        </aside>
      </div>
      <Sheet open={!!manage} onClose={() => setManage(null)} title={manage?.name || (manage ? formatPhone(manage.phone) : "")}>
        <p className="text-[15px]">Derechos del cliente (Ley 1581 de 2012): puede pedir que no le escriban más o que se borren sus datos. Queda en el registro.</p>
        <div className="mt-4 grid gap-2">
          {manage?.consented ? (
            <button className={btn("soft", "lg", "justify-start")} disabled={pending} onClick={() => act(() => withdrawConsentAction(manage.id))}>
              Quitar la autorización (no recibe más mensajes)
            </button>
          ) : (
            <p className="rounded-xl bg-cal px-3 py-2 text-sm">No tiene autorización vigente: no se le escriben mensajes. Si vuelve a autorizar en el cobro, sigue sumando sellos.</p>
          )}
          {confirmDelete ? (
            <button className={btn("danger", "lg")} disabled={pending} onClick={() => act(() => deleteCustomerAction(manage!.id))}>
              Sí, borrar sus datos y sus sellos
            </button>
          ) : (
            <button className={btn("soft", "lg", "justify-start text-cereza")} onClick={() => setConfirmDelete(true)}>
              Borrar sus datos
            </button>
          )}
          <p className="text-sm text-humo">Las facturas a su nombre se conservan: la ley obliga a guardarlas.</p>
        </div>
      </Sheet>
    </div>
  );
}
