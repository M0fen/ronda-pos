"use client";

import { BellRing, Check, ChevronRight, Clock, Receipt, ShoppingBag, Users, Utensils, Wine, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { approveRequestAction, openCheckAction, rejectRequestAction } from "@/app/(pos)/actions";
import { btn, Money, Pill } from "@/components/ui";
import type { CheckSummary, RequestView, TableView } from "@/lib/server/checks";
import { cop } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Sheet } from "./sheet";
import { report, toast } from "./toast";

type Floor = { zones: { id: string; name: string }[]; tables: TableView[]; others: CheckSummary[]; checks: CheckSummary[]; requests: RequestView[] };

const IDLE_MINUTES = 25;

export function Salon({ floor }: { floor: Floor }) {
  const router = useRouter();
  const [zone, setZone] = useState(floor.zones[0]?.id ?? "");
  const [opening, setOpening] = useState<TableView | null>(null);
  const [guests, setGuests] = useState(2);
  const [newTab, setNewTab] = useState<"barra" | "llevar" | null>(null);
  const [tabName, setTabName] = useState("");
  const [pending, start] = useTransition();
  const tables = floor.tables.filter((t) => t.zone_id === zone);
  const busy = floor.tables.filter((t) => t.check).length;

  function open(input: Parameters<typeof openCheckAction>[0]) {
    start(async () => {
      const r = await openCheckAction(input);
      if (r.ok && r.data) router.push(`/cuenta/${r.data}`);
      else report(r);
    });
  }

  return (
    <div className="mx-auto max-w-[1400px] px-3 py-4 sm:px-5">
      {floor.requests.length ? <Requests requests={floor.requests} checks={floor.checks} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-2xl bg-tinto/6 p-1" role="tablist">
          {floor.zones.map((z) => {
            const n = floor.tables.filter((t) => t.zone_id === z.id && t.check).length;
            return (
              <button
                key={z.id}
                role="tab"
                aria-selected={zone === z.id}
                onClick={() => setZone(z.id)}
                className={cn("rounded-xl px-4 py-2 text-[15px] font-semibold", zone === z.id ? "bg-papel shadow-sm" : "text-tinto-2")}
              >
                {z.name}
                {n ? <span className="ml-1.5 text-humo tnum">{n}</span> : null}
              </button>
            );
          })}
        </div>
        <p className="mr-auto text-sm text-humo">
          {busy} de {floor.tables.length} mesas ocupadas
        </p>
        <button className={btn("soft", "md")} onClick={() => (setNewTab("barra"), setTabName(""))}>
          <Wine size={18} /> Cuenta de barra
        </button>
        <button className={btn("soft", "md")} onClick={() => (setNewTab("llevar"), setTabName(""))}>
          <ShoppingBag size={18} /> Para llevar
        </button>
      </div>

      {/* Plano en tablet y computador; lista en el teléfono */}
      <div className="relative mt-4 hidden aspect-[16/7.2] rounded-3xl border border-linea bg-papel/60 sm:block">
        {tables.map((t) => (
          <div key={t.id} className="absolute" style={{ left: `${t.x}%`, top: `${t.y}%`, width: t.shape === "long" ? "17%" : "16%", height: "34%" }}>
            <TableTile table={t} onOpen={() => (setOpening(t), setGuests(Math.min(t.seats, 2)))} />
          </div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:hidden">
        {tables.map((t) => (
          <div key={t.id} className="h-32">
            <TableTile table={t} onOpen={() => (setOpening(t), setGuests(Math.min(t.seats, 2)))} />
          </div>
        ))}
      </div>

      <section className="mt-6">
        <h2 className="text-lg font-bold">Barra y para llevar</h2>
        {floor.others.length ? (
          <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {floor.others.map((c) => (
              <li key={c.id}>
                <Link href={`/cuenta/${c.id}`} className="flex items-center gap-3 rounded-2xl bg-papel px-4 py-3 ring-1 ring-linea hover:ring-tinto">
                  {c.kind === "barra" ? <Wine size={20} className="text-balcon" /> : <ShoppingBag size={20} className="text-puerta" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{c.label}</span>
                    <span className="block text-sm text-humo">
                      {c.minutesOpen} min · {c.units} productos
                    </span>
                  </span>
                  {c.ready ? <Pill tone="green">Listo</Pill> : null}
                  <Money value={c.total} className="font-semibold" />
                  <ChevronRight size={18} className="text-humo" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-humo">No hay cuentas de barra ni pedidos para llevar abiertos.</p>
        )}
      </section>

      <Sheet
        open={!!opening}
        onClose={() => setOpening(null)}
        title={`Abrir mesa ${opening?.name ?? ""}`}
        footer={
          <button className={btn("primary", "lg", "w-full")} disabled={pending} onClick={() => opening && open({ kind: "mesa", tableId: opening.id, guests })}>
            Abrir cuenta
          </button>
        }
      >
        <p className="text-sm font-semibold text-humo">Personas en la mesa</p>
        <div className="mt-3 flex items-center justify-center gap-6">
          <button className={btn("soft", "xl", "w-16")} onClick={() => setGuests((g) => Math.max(1, g - 1))} aria-label="Una persona menos">
            −
          </button>
          <span className="w-16 text-center text-5xl font-bold tnum">{guests}</span>
          <button className={btn("soft", "xl", "w-16")} onClick={() => setGuests((g) => Math.min(30, g + 1))} aria-label="Una persona más">
            +
          </button>
        </div>
      </Sheet>

      <Sheet
        open={!!newTab}
        onClose={() => setNewTab(null)}
        title={newTab === "barra" ? "Nueva cuenta de barra" : "Nuevo pedido para llevar"}
        footer={
          <button className={btn("primary", "lg", "w-full")} disabled={pending || tabName.trim().length < 2} onClick={() => newTab && open({ kind: newTab, name: tabName, guests: 1 })}>
            Abrir cuenta
          </button>
        }
      >
        <label className="block">
          <span className="text-sm font-semibold text-humo">¿A nombre de quién?</span>
          <input
            data-autofocus
            className="mt-2 h-14 w-full rounded-2xl border border-linea-2 px-4 text-lg outline-none focus:border-tinto"
            value={tabName}
            onChange={(e) => setTabName(e.target.value)}
            placeholder={newTab === "barra" ? "Ej. Laura" : "Ej. Sebastián"}
            onKeyDown={(e) => e.key === "Enter" && tabName.trim().length >= 2 && newTab && open({ kind: newTab, name: tabName, guests: 1 })}
          />
        </label>
      </Sheet>
    </div>
  );
}

function TableTile({ table, onOpen }: { table: TableView; onOpen: () => void }) {
  const c = table.check;
  if (!c)
    return (
      <button
        onClick={onOpen}
        className={cn(
          "flex h-full w-full flex-col items-center justify-center border-2 border-dashed border-linea-2 bg-papel text-tinto-2 transition hover:border-tinto hover:text-tinto",
          table.shape === "round" ? "rounded-[999px]" : "rounded-3xl",
        )}
        aria-label={`Mesa ${table.name} libre, ${table.seats} puestos`}
      >
        <span className="text-2xl font-bold [font-stretch:110%]">{table.name}</span>
        <span className="mt-0.5 inline-flex items-center gap-1 text-[13px] text-humo">
          <Users size={13} /> {table.seats}
        </span>
      </button>
    );
  const bill = c.status === "bill";
  const idle = !bill && c.minutesIdle >= IDLE_MINUTES && c.inStation === 0;
  return (
    <Link
      href={`/cuenta/${c.id}`}
      className={cn(
        "relative flex h-full w-full flex-col justify-between p-3 text-left transition",
        table.shape === "round" ? "rounded-[40px] items-center text-center" : "rounded-3xl",
        bill ? "bg-fachada text-tinto" : "bg-balcon text-white hover:bg-balcon-2",
        c.ready > 0 && "ready-pulse ring-4 ring-puerta",
      )}
      aria-label={`Mesa ${table.name}, ${bill ? "pidió la cuenta" : "ocupada"}, ${cop(c.total)}`}
    >
      <span className={cn("flex w-full items-start gap-1", table.shape === "round" ? "justify-center gap-2.5" : "justify-between")}>
        <span className="text-2xl font-bold leading-none [font-stretch:110%]">{table.name}</span>
        <span className={cn("inline-flex items-center gap-1 text-[13px]", bill ? "text-tinto/70" : "text-white/80")}>
          <Users size={13} /> {c.guests}
        </span>
      </span>
      <span className="w-full">
        {c.ready ? (
          <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-puerta px-2 py-0.5 text-[12px] font-bold text-white">
            <Check size={12} /> {c.ready} listo{c.ready > 1 ? "s" : ""}
          </span>
        ) : bill ? (
          <span className="mb-1 inline-flex items-center gap-1 text-[13px] font-bold">
            <Receipt size={13} /> Pidió la cuenta
          </span>
        ) : idle ? (
          <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[12px] font-semibold">
            <Clock size={12} /> Ofrece otra ronda
          </span>
        ) : c.inStation ? (
          <span className="mb-1 inline-flex items-center gap-1 text-[12px] font-semibold text-white/85">
            <Utensils size={12} /> {c.inStation} en preparación
          </span>
        ) : null}
        <span className="flex items-end justify-between gap-1">
          <Money value={c.total} className="text-base font-bold" />
          <span className={cn("text-[12px] tnum", bill ? "text-tinto/70" : "text-white/75")}>{c.minutesOpen} min</span>
        </span>
      </span>
    </Link>
  );
}

function Requests({ requests, checks }: { requests: RequestView[]; checks: CheckSummary[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; data?: unknown }>, done: string) =>
    start(async () => {
      const r = await fn();
      if (report(r, done)) router.refresh();
    });
  return (
    <section className="mb-4 rounded-3xl bg-tinto p-3 text-cal sm:p-4" aria-label="Solicitudes de las mesas">
      <p className="flex items-center gap-2 px-1 pb-2 text-sm font-semibold text-cal/80">
        <BellRing size={16} className="text-fachada" /> Desde las mesas
      </p>
      <ul className="grid gap-2 lg:grid-cols-2">
        {requests.map((r) => {
          const where = r.table_name ? `Mesa ${r.table_name}` : "Una mesa";
          const check = checks.find((c) => c.id === r.check_id || (r.table_id && c.table_id === r.table_id));
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-white/8 px-3.5 py-3">
              <div className="min-w-[12rem] flex-1">
                {r.kind === "order" ? (
                  <>
                    <p className="font-semibold">
                      {where} pidió por QR{r.payload.guestName ? ` · ${r.payload.guestName}` : ""}
                    </p>
                    <p className="truncate text-sm text-cal/75">{(r.payload.items ?? []).map((i) => `${i.qty} ${i.name}${i.note ? ` (${i.note})` : ""}`).join(", ")}</p>
                  </>
                ) : r.kind === "waiter" ? (
                  <p className="font-semibold">{where} llama al mesero</p>
                ) : r.kind === "bill" ? (
                  <p className="font-semibold">{where} pidió la cuenta</p>
                ) : (
                  <>
                    <p className="font-semibold">
                      {where} pagó {r.payload.method === "breb" ? "con Bre-B" : r.payload.method === "nequi" ? "con Nequi" : ""} {cop(r.payload.amount ?? 0)}
                    </p>
                    <p className="text-sm text-cal/75">Referencia {r.payload.reference}: confirma que llegó antes de aceptarlo</p>
                  </>
                )}
              </div>
              {r.kind === "order" ? (
                <div className="flex gap-2 max-sm:w-full">
                  <button className={btn("light", "sm")} disabled={pending} onClick={() => run(() => rejectRequestAction(r.id), "Pedido rechazado")} aria-label="Rechazar pedido">
                    <X size={16} />
                  </button>
                  <button className={btn("send", "sm", "max-sm:flex-1")} disabled={pending} onClick={() => run(() => approveRequestAction(r.id), "Pedido enviado a barra y cocina")}>
                    <Check size={16} /> Aprobar y enviar
                  </button>
                </div>
              ) : r.kind === "waiter" ? (
                <button className={btn("warn", "sm")} disabled={pending} onClick={() => run(() => approveRequestAction(r.id), "Atendido")}>
                  Voy para allá
                </button>
              ) : (
                <button
                  className={btn("warn", "sm")}
                  onClick={() => {
                    if (!check) return toast("Esa mesa no tiene una cuenta abierta", { tone: "error" });
                    if (r.kind === "bill") start(async () => void (await approveRequestAction(r.id)));
                    router.push(`/cuenta/${check.id}/cobro`);
                  }}
                >
                  {r.kind === "bill" ? "Ir a cobrar" : "Revisar pago"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
