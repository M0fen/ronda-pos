"use client";

import { Bike, Check, ChefHat, Clock, MapPin, PackageCheck, Plus, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createDeliveryAction, dispatchDeliveryAction, packDeliveryAction, sendRoundAction } from "@/app/(pos)/actions";
import { btn, Empty, Money } from "@/components/ui";
import { STAGES, type DeliveryStage } from "@/lib/core/delivery";
import type { DeliveryCard } from "@/lib/server/delivery";
import { CHANNEL_COLOR } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { Sheet } from "./sheet";
import { report } from "./toast";

const ICON: Record<DeliveryStage, typeof Clock> = { nuevo: ShoppingBag, cocina: ChefHat, empacar: PackageCheck, listo: Bike };
/** En el tablero todo es domicilio: basta el canal */
const LABEL: Record<string, string> = { rappi: "Rappi", didi: "DiDi Food", propio: "Propio" };

export function DeliveryBoard({ cards, channels, canCharge }: { cards: DeliveryCard[]; channels: { key: string; label: string }[]; canCharge: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ channel: channels[0]?.key ?? "propio", customer: "", code: "", rider: "", phone: "", address: "", notes: "" });
  const [checked, setChecked] = useState<Record<string, string[]>>({});
  const act = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      if (report(await fn())) router.refresh();
    });
  const toggle = (id: string, line: string) => setChecked((c) => ({ ...c, [id]: c[id]?.includes(line) ? c[id]!.filter((x) => x !== line) : [...(c[id] ?? []), line] }));

  return (
    <div className="mx-auto max-w-[1400px] px-3 py-4 sm:px-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Domicilios</h1>
          <p className="text-humo">Rappi y domicilio propio en un solo tablero, de que entran a que salen. Nada sale sin revisar la bolsa.</p>
        </div>
        {canCharge && channels.length ? (
          <button className={btn("primary", "md")} onClick={() => setCreating(true)}>
            <Plus size={18} /> Nuevo domicilio
          </button>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {STAGES.map((s) => {
          const list = cards.filter((c) => c.stage === s.key);
          const Icon = ICON[s.key];
          return (
            <section key={s.key} className="min-w-0 rounded-3xl bg-tinto/4 p-3" aria-label={s.label}>
              <header className="flex items-center gap-2 px-1 pb-2">
                <Icon size={18} />
                <h2 className="font-bold">{s.label}</h2>
                <span className="ml-auto rounded-full bg-papel px-2 text-sm font-bold tnum ring-1 ring-linea">{list.length}</span>
              </header>
              <p className="px-1 pb-2 text-[13px] text-humo">{s.hint}</p>
              <div className="space-y-3">
                {list.length ? (
                  list.map((c) => {
                    const done = checked[c.id] ?? [];
                    return (
                      <article key={c.id} className="overflow-hidden rounded-2xl bg-papel ring-1 ring-linea">
                        <div className="h-1.5" style={{ background: CHANNEL_COLOR[c.channel] ?? "#6b6660" }} />
                        <div className="p-3.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[13px] font-bold uppercase tracking-wide" style={{ color: CHANNEL_COLOR[c.channel] }}>
                                {LABEL[c.channel] ?? c.channel} · <span className="whitespace-nowrap">{c.code}</span>
                              </p>
                              <p className="truncate text-lg font-bold leading-tight">{c.customer}</p>
                            </div>
                            <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[13px] font-semibold tnum", c.minutes >= 25 ? "bg-cereza-soft text-cereza" : "bg-tinto/6")}>
                              <Clock size={13} /> {c.minutes} min
                            </span>
                          </div>
                          {c.address ? (
                            <p className="mt-1 flex items-start gap-1 text-sm text-tinto-2">
                              <MapPin size={14} className="mt-0.5 shrink-0" /> {c.address}
                            </p>
                          ) : null}
                          {c.notes ? <p className="mt-1 inline-block rounded-md bg-fachada-soft px-1.5 py-0.5 text-[13px] font-semibold">{c.notes}</p> : null}
                          {c.riderIn !== null && c.stage !== "listo" ? (
                            <p className={cn("mt-1.5 flex items-center gap-1.5 text-[13px] font-semibold", c.riderIn <= 3 ? "text-cereza" : "text-tinto-2")}>
                              <Bike size={14} /> {c.riderIn > 0 ? `El domiciliario llega en ${c.riderIn} min` : `El domiciliario ya está esperando`}
                            </p>
                          ) : null}

                          {c.stage === "empacar" ? (
                            <ul className="mt-3 space-y-1.5">
                              {c.checklist.map((line) => {
                                const on = done.includes(line);
                                return (
                                  <li key={line}>
                                    <button onClick={() => toggle(c.id, line)} className={cn("flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-[15px] ring-1", on ? "bg-puerta-soft ring-puerta/30" : "ring-linea")}>
                                      <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-md", on ? "bg-puerta text-white" : "bg-tinto/8")}>{on ? <Check size={15} /> : null}</span>
                                      <span className={on ? "font-semibold" : ""}>{line}</span>
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : (
                            <ul className="mt-3 space-y-1 text-[15px]">
                              {c.items.map((i, k) => (
                                <li key={k} className="flex items-start gap-2">
                                  <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded text-[12px] font-bold tnum", i.status === "ready" || i.status === "delivered" ? "bg-puerta text-white" : "bg-tinto/8")}>
                                    {i.status === "ready" || i.status === "delivered" ? <Check size={12} /> : i.qty}
                                  </span>
                                  <span className="min-w-0">
                                    {i.qty > 1 && (i.status === "ready" || i.status === "delivered") ? `${i.qty} × ` : ""}
                                    {i.name}
                                    {i.modifiers.length ? <span className="text-humo"> · {i.modifiers.map((m) => m.name).join(", ")}</span> : null}
                                  </span>
                                </li>
                              ))}
                              {!c.items.length ? <li className="text-humo">Sin productos todavía</li> : null}
                            </ul>
                          )}

                          {c.stage === "cocina" ? (
                            <div className="mt-3">
                              <div className="h-2 overflow-hidden rounded-full bg-tinto/8">
                                <div className="h-full rounded-full bg-puerta" style={{ width: `${(c.ready / Math.max(1, c.count)) * 100}%` }} />
                              </div>
                              <p className="mt-1 text-[13px] text-humo">
                                {c.ready} de {c.count} listos en cocina
                              </p>
                            </div>
                          ) : null}

                          {c.stage === "listo" ? (
                            <p className="mt-3 rounded-xl bg-cal px-3 py-2 text-sm">
                              {c.channel === "propio"
                                ? `Empacó ${c.packedBy ?? "el equipo"}. Cobra y despacha con tu domiciliario.`
                                : c.riderIn === null
                                  ? `Empacó ${c.packedBy ?? "el equipo"}.`
                                  : c.riderIn > 0
                                    ? `El domiciliario llega en ${c.riderIn} min · empacó ${c.packedBy ?? "el equipo"}`
                                    : `El domiciliario espera hace ${-c.riderIn} min · empacó ${c.packedBy ?? "el equipo"}`}
                            </p>
                          ) : null}

                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                            <Money value={c.total} className="font-bold" />
                            {c.stage === "nuevo" ? (
                              c.count ? (
                                <span className="flex gap-2">
                                  <Link href={`/cuenta/${c.id}`} className={btn("soft", "sm")}>
                                    Ver
                                  </Link>
                                  <button className={btn("send", "sm")} disabled={pending} onClick={() => act(() => sendRoundAction(c.id))}>
                                    Aceptar y mandar a cocina
                                  </button>
                                </span>
                              ) : (
                                <Link href={`/cuenta/${c.id}`} className={btn("primary", "sm")}>
                                  Agregar productos
                                </Link>
                              )
                            ) : c.stage === "empacar" ? (
                              <button className={btn("send", "sm")} disabled={pending || done.length < c.checklist.length} onClick={() => act(() => packDeliveryAction(c.id, done))}>
                                <PackageCheck size={16} /> Bolsa revisada
                              </button>
                            ) : c.stage === "listo" ? (
                              c.channel === "propio" ? (
                                <Link href={`/cuenta/${c.id}/cobro`} className={btn("primary", "sm")}>
                                  Cobrar y despachar
                                </Link>
                              ) : canCharge ? (
                                <button className={btn("send", "sm")} disabled={pending} onClick={() => act(() => dispatchDeliveryAction(c.id))}>
                                  <Bike size={16} /> Entregado al domiciliario
                                </button>
                              ) : (
                                <span className="text-sm text-humo">Lo entrega caja</span>
                              )
                            ) : (
                              <Link href="/barra?estacion=cocina" className={btn("soft", "sm")}>
                                Ver en cocina
                              </Link>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })
                ) : (
                  <Empty title="Nada aquí" />
                )}
              </div>
            </section>
          );
        })}
      </div>

      <Sheet
        open={creating}
        onClose={() => setCreating(false)}
        title="Nuevo domicilio"
        footer={
          <button
            className={btn("primary", "lg", "w-full")}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await createDeliveryAction(form);
                if (report(r) && r.ok && r.data) router.push(`/cuenta/${r.data}`);
              })
            }
          >
            Crear y agregar productos
          </button>
        }
      >
        <p className="text-sm font-semibold text-humo">Canal</p>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {channels.map((ch) => (
            <button key={ch.key} onClick={() => setForm((f) => ({ ...f, channel: ch.key }))} className={cn("h-11 rounded-xl font-semibold ring-1", form.channel === ch.key ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}>
              {ch.label}
            </button>
          ))}
        </div>
        {(
          [
            ["customer", "Nombre del cliente", true],
            ["code", "Código del pedido en la plataforma (opcional)", form.channel !== "propio"],
            ["rider", "Minutos para que llegue el domiciliario (opcional)", form.channel !== "propio"],
            ["phone", "Celular", form.channel === "propio"],
            ["address", "Dirección de entrega", form.channel === "propio"],
            ["notes", "Notas (opcional)", true],
          ] as const
        )
          .filter(([, , show]) => show)
          .map(([key, label]) => (
            <label key={key} className="mt-3 block">
              <span className="text-sm font-semibold text-humo">{label}</span>
              <input
                inputMode={key === "phone" || key === "rider" ? "numeric" : undefined}
                className="mt-1 h-12 w-full rounded-xl border border-linea-2 px-3 outline-none focus:border-tinto"
                value={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              />
            </label>
          ))}
      </Sheet>
    </div>
  );
}
