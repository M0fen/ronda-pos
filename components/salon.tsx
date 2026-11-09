"use client";

import { BellRing, Check, ChevronRight, Clock, Pause, Receipt, ShoppingBag, Split, Users, Utensils, Wine, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { approveRequestAction, openCheckAction, rejectRequestAction } from "@/app/(pos)/actions";
import { btn, Money, Pill } from "@/components/ui";
import type { CheckSummary, RequestView, TableView } from "@/lib/server/checks";
import { cop } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Sheet } from "./sheet";
import { report } from "./toast";

type Floor = {
  zones: { id: string; name: string }[];
  tables: TableView[];
  others: CheckSummary[];
  checks: CheckSummary[];
  requests: RequestView[];
  deliveries: number;
};

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
  // Local de mostrador (como un punto en centro comercial): solo sillas de barra, sin mesas. Primero van los pedidos.
  const counter = floor.tables.every((t) => t.seats <= 1);

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
          {counter ? `${floor.others.length} ${floor.others.length === 1 ? "pedido abierto" : "pedidos abiertos"}` : `${busy} de ${floor.tables.length} mesas ocupadas`}
        </p>
        {counter ? null : (
          <button className={btn("soft", "md")} onClick={() => (setNewTab("barra"), setTabName(""))}>
            <Wine size={18} /> Cuenta de barra
          </button>
        )}
        <button className={btn(counter ? "primary" : "soft", "md")} onClick={() => (setNewTab("llevar"), setTabName(""))}>
          <ShoppingBag size={18} /> {counter ? "Nuevo pedido" : "Para llevar"}
        </button>
      </div>

      <div className="flex flex-col">
        {/* Plano en tablet y computador; lista en el teléfono */}
        <div
          className={cn(
            "relative mt-4 hidden rounded-3xl border border-linea bg-papel/60 bg-[radial-gradient(circle,var(--color-linea)_1.2px,transparent_1.2px)] bg-[size:24px_24px] sm:block",
            counter ? "order-2 aspect-[16/4]" : "aspect-[16/7.2]",
          )}
        >
          {tables.map((t) => (
            <div
              key={t.id}
              className="absolute"
              style={{
                left: `${t.x}%`,
                top: `${t.y}%`,
                width: t.shape === "long" ? "17%" : "16%",
                height: "34%",
              }}
            >
              <TableTile plan table={t} onOpen={() => (setOpening(t), setGuests(Math.min(t.seats, 2)))} />
            </div>
          ))}
        </div>
        <div className={cn("mt-4 grid grid-cols-2 gap-2.5 sm:hidden", counter && "order-3")}>
          {tables.map((t) => (
            <div key={t.id} className="h-32">
              <TableTile table={t} onOpen={() => (setOpening(t), setGuests(Math.min(t.seats, 2)))} />
            </div>
          ))}
        </div>

        <section className={counter ? "order-1 mt-4" : "mt-6"}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">{counter ? "Pedidos del mostrador" : "Barra y para llevar"}</h2>
            {floor.deliveries ? (
              <Link href="/domicilios" className="text-[15px] font-semibold text-balcon underline-offset-4 hover:underline">
                {floor.deliveries} {floor.deliveries === 1 ? "domicilio en curso" : "domicilios en curso"} →
              </Link>
            ) : null}
          </div>
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
                    {/* "Listo" solo cuando todo está listo; mientras tanto, cuántos van */}
                    {c.ready && !c.inStation ? (
                      <Pill tone="green">Listo</Pill>
                    ) : c.ready ? (
                      <Pill tone="yellow">{`${c.ready} de ${c.ready + c.inStation} listos`}</Pill>
                    ) : c.held && !c.inStation ? (
                      <Pill tone="blue">{`${c.held} retenido${c.held > 1 ? "s" : ""}`}</Pill>
                    ) : null}
                    <Money value={c.total} className="font-semibold" />
                    <ChevronRight size={18} className="text-humo" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-humo">{counter ? "No hay pedidos abiertos. Toca Nuevo pedido para empezar." : "No hay cuentas de barra ni pedidos para llevar abiertos."}</p>
          )}
        </section>
      </div>

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
        title={newTab === "barra" ? "Nueva cuenta de barra" : counter ? "Nuevo pedido" : "Nuevo pedido para llevar"}
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

/**
 * Una mesa en el plano o en la lista del teléfono. Libre: contorno punteado. Ocupada: tarjeta tipo comanda con una
 * franja que dice el estado de lejos (color del local; amarilla si pidió la cuenta; verde si hay algo listo para llevar).
 * El texto crece con la mesa (unidades del contenedor) para que no sobre espacio en pantallas grandes ni falte en tablets.
 */
/** Cuando una mesa cambia (otro mesero, la barra, el QR), la tarjeta destella una vez para que se note. */
function useFlashOnChange(sig: string) {
  const ref = useRef<HTMLElement | null>(null);
  const prev = useRef<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (prev.current !== null && prev.current !== sig && el && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const color = getComputedStyle(el).getPropertyValue("--color-fachada").trim() || "#FFC20E";
      el.animate(
        [
          { outline: `4px solid ${color}`, outlineOffset: "0px" },
          { outline: "4px solid transparent", outlineOffset: "14px" },
        ],
        { duration: 1100, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      );
    }
    prev.current = sig;
  }, [sig]);
  return ref;
}

function TableTile({ table, onOpen, plan = false }: { table: TableView; onOpen: () => void; plan?: boolean }) {
  const main = table.check;
  // Con cuentas aparte, la mesa muestra todo junto: el total, lo listo, lo que se prepara y lo retenido
  const all = main ? [main, ...table.splits] : [];
  const c = main
    ? {
        ...main,
        total: all.reduce((s, x) => s + x.total, 0),
        ready: all.reduce((s, x) => s + x.ready, 0),
        inStation: all.reduce((s, x) => s + x.inStation, 0),
        held: all.reduce((s, x) => s + x.held, 0),
        status: all.some((x) => x.status === "bill") ? ("bill" as const) : main.status,
        minutesIdle: Math.min(...all.map((x) => x.minutesIdle)),
      }
    : null;
  const flash = useFlashOnChange(c ? `${c.id}:${c.status}:${c.ready}:${c.inStation}:${c.held}:${c.total}:${all.length}` : "libre");
  const round = plan && table.shape === "round";
  const shape = round ? "aspect-square h-full max-w-full mx-auto rounded-full" : "h-full w-full rounded-[22px]";
  if (!c)
    return (
      <button
        ref={flash as React.Ref<HTMLButtonElement>}
        onClick={onOpen}
        className={cn(
          "@container flex flex-col items-center justify-center gap-1 border-2 border-dashed border-linea-2 bg-papel/60 text-tinto-2 transition hover:border-balcon hover:bg-papel hover:text-tinto",
          shape,
        )}
        aria-label={`Mesa ${table.name} libre, ${table.seats} puestos`}
      >
        <span className="text-[clamp(1.2rem,15cqw,2.25rem)] font-bold leading-none [font-stretch:110%]">{table.name}</span>
        <span className="inline-flex items-center gap-1 text-[clamp(0.72rem,6.5cqw,0.9rem)] text-humo">
          <Users className="size-[1.05em]" /> {table.seats}
        </span>
      </button>
    );
  const bill = c.status === "bill";
  const waiting = !bill && c.held > 0 && c.inStation === 0;
  const idle = !bill && !waiting && c.minutesIdle >= IDLE_MINUTES && c.inStation === 0;
  const band = c.ready ? "bg-puerta text-white" : bill ? "bg-fachada text-tinto" : "bg-balcon text-white";
  const chip = c.ready
    ? { cls: "bg-puerta-soft text-puerta-2", icon: <Check className="size-[1.1em]" strokeWidth={3} />, long: `${c.ready} listo${c.ready > 1 ? "s" : ""} para llevar`, short: `${c.ready} listo${c.ready > 1 ? "s" : ""}`, count: String(c.ready) }
    : bill
      ? { cls: "bg-fachada-soft text-tinto", icon: <Receipt className="size-[1.1em]" />, long: "Pidió la cuenta", short: "Cuenta", count: "" }
      : waiting
        ? { cls: "bg-balcon-soft text-balcon-2", icon: <Pause className="size-[1.1em]" />, long: `${c.held} retenido${c.held > 1 ? "s" : ""} por enviar`, short: `${c.held} retenido${c.held > 1 ? "s" : ""}`, count: String(c.held) }
        : idle
        ? { cls: "bg-fachada-soft text-tinto", icon: <Clock className="size-[1.1em]" />, long: "Ofrece otra ronda", short: "Otra ronda", count: "" }
        : c.inStation
          ? { cls: "bg-tinto/6 text-tinto-2", icon: <Utensils className="size-[1.1em]" />, long: `${c.inStation} en preparación`, short: `${c.inStation} en prep.`, count: String(c.inStation) }
          : null;
  return (
    <Link
      ref={flash as React.Ref<HTMLAnchorElement>}
      href={`/cuenta/${c.id}`}
      className={cn(
        "@container relative flex flex-col overflow-hidden bg-papel text-tinto shadow-[0_12px_28px_-16px_rgba(23,19,16,0.5)] ring-1 ring-black/8 transition hover:-translate-y-0.5",
        shape,
        round && "text-center",
        c.ready > 0 && "ready-pulse ring-2 ring-puerta",
      )}
      aria-label={`Mesa ${table.name}, ${bill ? "pidió la cuenta" : "ocupada"}${all.length > 1 ? `, ${all.length} cuentas` : ""}, ${cop(c.total)}`}
    >
      <span className={cn("flex shrink-0 items-center gap-1.5 px-[8cqw]", band, round ? "h-[42%] items-end justify-center pb-[5cqw]" : "h-[40%] justify-between")}>
        <span className="text-[clamp(1.2rem,15cqw,2.25rem)] font-bold leading-none [font-stretch:110%]">{table.name}</span>
        <span className="inline-flex items-center gap-1 text-[clamp(0.72rem,6.5cqw,0.9rem)] font-medium opacity-80">
          <Users className="size-[1.05em]" /> {all.reduce((n, x) => n + x.guests, 0)}
          {all.length > 1 ? (
            <span className="ml-0.5 inline-flex items-center gap-0.5" title={`${all.length} cuentas`}>
              <Split className="size-[1.05em]" /> {all.length}
            </span>
          ) : null}
        </span>
      </span>
      {round ? (
        // En la mesa redonda cabe menos: el total y una línea con el estado en corto y los minutos
        <span className="flex min-h-0 flex-1 flex-col items-center gap-[3cqw] px-[10cqw] pt-[5cqw]">
          <Money value={c.total} className="text-[clamp(0.9rem,10cqw,1.45rem)] font-bold leading-none" />
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-[clamp(0.68rem,6cqw,0.85rem)] leading-none text-humo tnum">
            {chip ? (
              <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold", chip.cls)} title={chip.long}>
                {chip.icon}
                <span className="hidden @min-[11rem]:inline">{chip.short}</span>
                <span className="@min-[11rem]:hidden">{chip.count}</span>
              </span>
            ) : null}
            {c.minutesOpen} min
          </span>
        </span>
      ) : (
        <span className="flex min-h-0 flex-1 flex-col justify-between px-[7cqw] py-[5cqw]">
          {chip ? (
            <span className={cn("inline-flex max-w-full items-center gap-1 self-start rounded-full px-[0.6em] py-[0.2em] text-[clamp(0.68rem,5.8cqw,0.85rem)] font-semibold", chip.cls)}>
              {chip.icon}
              <span className="hidden truncate @min-[10rem]:inline">{chip.long}</span>
              <span className="truncate @min-[10rem]:hidden">{chip.short}</span>
            </span>
          ) : (
            <span />
          )}
          <span className="flex flex-wrap items-end justify-between gap-x-2 gap-y-0.5">
            <Money value={c.total} className="text-[clamp(0.9rem,10cqw,1.45rem)] font-bold leading-none" />
            <span className="whitespace-nowrap text-[clamp(0.7rem,6cqw,0.85rem)] leading-none text-humo tnum">{c.minutesOpen} min</span>
          </span>
        </span>
      )}
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
            <li key={r.id} className="flex min-w-0 flex-wrap items-center gap-3 rounded-2xl bg-white/8 px-3.5 py-3">
              <div className="min-w-0 flex-1 basis-48">
                {r.kind === "order" ? (
                  <>
                    <p className="font-semibold">
                      {where} pidió por QR
                      {r.payload.guestName ? ` · ${r.payload.guestName}` : ""}
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
                      {where} pagó {r.payload.method === "breb" ? "con Bre-B" : r.payload.method === "nequi" ? "con Nequi" : ""} {cop((r.payload.amount ?? 0) + (r.payload.tip ?? 0))}
                      {r.payload.tip ? <span className="font-normal text-cal/75"> (con {cop(r.payload.tip)} de propina)</span> : null}
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
              ) : check ? (
                <button
                  className={btn("warn", "sm", "max-sm:w-full")}
                  onClick={() => {
                    if (r.kind === "bill") start(async () => void (await approveRequestAction(r.id)));
                    router.push(`/cuenta/${check.id}/cobro`);
                  }}
                >
                  {r.kind === "bill" ? "Ir a cobrar" : "Revisar pago"}
                </button>
              ) : (
                // Sin cuenta abierta no hay nada que cobrar: el aviso se puede quitar
                <button className={btn("light", "sm", "max-sm:w-full")} disabled={pending} onClick={() => run(() => rejectRequestAction(r.id), "Aviso quitado")}>
                  <X size={16} /> Quitar aviso
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
