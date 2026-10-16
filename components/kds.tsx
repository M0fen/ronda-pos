"use client";

import { ArrowLeft, Check, CheckCheck, QrCode, RotateCcw, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { kdsBumpAction, kdsItemAction } from "@/app/(pos)/actions";
import { btn } from "@/components/ui";
import type { Ticket } from "@/lib/server/checks";
import { cn } from "@/lib/utils";
import { Live } from "./live";
import { report } from "./toast";

type Board = { active: Ticket[]; ready: Ticket[]; done: Ticket[]; avgMinutes: number | null };

/** Reloj con la hora del servidor: arranca igual que el HTML (sin errores de hidratación) y corrige
 *  tabletas con la hora mal puesta, porque los tiempos de los tiquetes vienen del servidor. */
function useServerNow(serverNow: number, ms: number) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const offset = serverNow - Date.now();
    const t = setInterval(() => setNow(Date.now() + offset), ms);
    return () => clearInterval(t);
  }, [serverNow, ms]);
  return now;
}

function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    o.connect(g);
    g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    o.start();
    o.stop(ctx.currentTime + 0.4);
  } catch {}
}

export function Kds({ board, station, business, staff, serverNow }: { board: Board; station: string | null; business: string; staff: { name: string; canCharge: boolean }; serverNow: number }) {
  const router = useRouter();
  const now = useServerNow(serverNow, 1000);
  const [sound, setSound] = useState(false);
  const [pending, start] = useTransition();
  const seen = useRef<Set<string> | null>(null);

  // Suena cuando llega un tiquete nuevo
  useEffect(() => {
    const keys = new Set(board.active.map((t) => t.key));
    if (seen.current && sound && [...keys].some((k) => !seen.current!.has(k))) beep();
    seen.current = keys;
  }, [board.active, sound]);

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      if (report(await fn())) router.refresh();
    });

  const tabs = [
    { key: null, label: "Todo" },
    { key: "barra", label: "Barra" },
    { key: "cocina", label: "Cocina" },
  ];

  return (
    <div className="min-h-dvh bg-noche text-cal">
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-white/10 bg-noche/95 px-3 py-2.5 backdrop-blur sm:px-5">
        <Link href="/salon" className="flex size-10 items-center justify-center rounded-xl hover:bg-white/10" aria-label="Volver al salón">
          <ArrowLeft size={20} />
        </Link>
        <div className="mr-auto">
          <p className="text-lg font-bold leading-tight">Barra y cocina</p>
          <p className="text-[13px] text-cal/60">
            {business} · {staff.name}
          </p>
        </div>
        <nav className="flex rounded-2xl bg-white/8 p-1">
          {tabs.map((t) => (
            <Link
              key={t.label}
              href={t.key ? `/barra?estacion=${t.key}` : "/barra"}
              className={cn("rounded-xl px-4 py-2 text-[15px] font-semibold", station === t.key ? "bg-cal text-tinto" : "text-cal/80 hover:bg-white/10")}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <p className="hidden text-sm text-cal/70 md:block">{board.avgMinutes ? `Promedio ${board.avgMinutes.toLocaleString("es-CO")} min` : "Sin tiempos aún"}</p>
        <button onClick={() => (setSound((s) => !s), !sound && beep())} className={btn(sound ? "warn" : "light", "sm")} aria-pressed={sound}>
          {sound ? <Volume2 size={16} /> : <VolumeX size={16} />} {sound ? "Sonido" : "Activar sonido"}
        </button>
        <span className="text-cal">
          <Live every={2500} />
        </span>
      </header>

      <div className="grid gap-4 p-3 sm:p-5 xl:grid-cols-[1fr_340px]">
        <section aria-label="En preparación">
          <h2 className="mb-3 text-sm font-semibold text-cal/70">En preparación · {board.active.length}</h2>
          {board.active.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
              {board.active.map((t) => {
                const mins = Math.floor((now - new Date(t.sentAt).getTime()) / 60_000);
                const secs = Math.floor(((now - new Date(t.sentAt).getTime()) / 1000) % 60);
                const tone = mins >= 15 ? "bg-cereza" : mins >= 8 ? "bg-fachada text-tinto" : "bg-puerta";
                return (
                  <article key={t.key} className="flex flex-col overflow-hidden rounded-2xl bg-noche-2 ring-1 ring-white/8">
                    <header className={cn("flex items-center justify-between px-4 py-2.5", tone)}>
                      <span className="text-xl font-bold [font-stretch:108%]">{t.label}</span>
                      <span className="text-xl font-bold tnum">
                        {mins}:{String(secs).padStart(2, "0")}
                      </span>
                    </header>
                    <p className="px-4 pt-2 text-[13px] text-cal/60">
                      Ronda {t.round} · {t.station === "cocina" ? "Cocina" : "Barra"} · {t.waiter ?? ""}
                    </p>
                    <ul className="flex-1 space-y-1 px-2 py-2">
                      {t.items.map((i) => {
                        const ready = i.status !== "sent";
                        return (
                          <li key={i.id}>
                            <button
                              disabled={pending}
                              onClick={() => act(() => kdsItemAction(i.id, ready ? "sent" : "ready"))}
                              className={cn("flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-white/6", ready && "opacity-45")}
                            >
                              <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg text-[15px] font-bold tnum", ready ? "bg-puerta text-white" : "bg-white/12")}>
                                {ready ? <Check size={16} /> : i.qty}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className={cn("block text-[17px] font-semibold leading-tight", ready && "line-through")}>{i.name}</span>
                                {i.modifiers.length ? <span className="block text-[14px] text-cal/70">{i.modifiers.map((m) => m.name).join(" · ")}</span> : null}
                                {i.note ? <span className="mt-1 inline-block rounded-md bg-fachada px-1.5 py-0.5 text-[13px] font-bold text-tinto">{i.note}</span> : null}
                              </span>
                              {i.source === "qr" ? <QrCode size={16} className="mt-1 shrink-0 text-cal/50" aria-label="Pedido por QR" /> : null}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="p-2 pt-0">
                      <button className={btn("send", "lg", "w-full")} disabled={pending} onClick={() => act(() => kdsBumpAction(t.checkId, t.round, t.station, "ready"))}>
                        <Check size={20} /> Listo todo
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/15 px-6 py-16 text-center">
              <p className="text-xl font-semibold">Nada pendiente</p>
              <p className="mt-1 text-cal/60">Los pedidos aparecen aquí apenas el mesero los envía.</p>
            </div>
          )}
        </section>

        <aside className="space-y-4" aria-label="Listos para llevar">
          <div>
            <h2 className="mb-3 text-sm font-semibold text-cal/70">Listos para llevar · {board.ready.length}</h2>
            <div className="space-y-2">
              {board.ready.map((t) => (
                <article key={t.key} className="rounded-2xl bg-puerta/20 p-3 ring-1 ring-puerta">
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-bold">{t.label}</span>
                    <span className="text-[13px] text-cal/70">{t.waiter}</span>
                  </div>
                  <p className="mt-1 text-[15px] text-cal/85">{t.items.map((i) => `${i.qty} ${i.name}`).join(", ")}</p>
                  <button className={btn("light", "md", "mt-2 w-full")} disabled={pending} onClick={() => act(() => kdsBumpAction(t.checkId, t.round, t.station, "delivered"))}>
                    <CheckCheck size={18} /> Entregado
                  </button>
                </article>
              ))}
              {!board.ready.length ? <p className="text-sm text-cal/50">Cuando marques algo como listo, el mesero lo ve en su salón.</p> : null}
            </div>
          </div>
          {board.done.length ? (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-cal/70">Entregados hace poco</h2>
              <ul className="space-y-1.5">
                {board.done.slice(0, 6).map((t) => (
                  <li key={t.key} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      <b>{t.label}</b> · {t.items.map((i) => `${i.qty} ${i.name}`).join(", ")}
                    </span>
                    <button className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-cal/80 hover:bg-white/10" onClick={() => act(() => kdsBumpAction(t.checkId, t.round, t.station, "recall"))} disabled={pending}>
                      <RotateCcw size={14} /> Recuperar
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
