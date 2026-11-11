"use client";

import { ArrowLeft, Ban, Bike, Check, CheckCheck, ChevronRight, Clock, ListOrdered, PackageCheck, Pause, Printer, QrCode, RotateCcw, TriangleAlert, Volume2, VolumeX, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { kdsAckVoidsAction, kdsBumpAction, kdsDetailAction, kdsItemAction } from "@/app/(pos)/actions";
import { btn } from "@/components/ui";
import { fmtTime } from "@/lib/format";
import type { KdsDetail, KdsDetailItem, Mod, Ticket, TicketItem, VoidNotice } from "@/lib/server/checks";
import { CHANNEL_COLOR, CHANNEL_SHORT } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { Live } from "./live";
import { Sheet } from "./sheet";
import { report } from "./toast";

type Board = { active: Ticket[]; ready: Ticket[]; done: Ticket[]; voids: VoidNotice[]; avgMinutes: number | null };
type Thresholds = Record<"barra" | "cocina", { warn: number; late: number }>;

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

/* ---------- Sonido: un tono por estación y otro, que baja, para las anulaciones ---------- */

let audio: AudioContext | null = null;
function audioContext() {
  try {
    audio ??= new AudioContext();
  } catch {
    return null;
  }
  return audio;
}

const TONES: Record<"barra" | "cocina" | "void", [number, number][]> = {
  barra: [
    [988, 0],
    [1319, 0.12],
  ],
  cocina: [
    [523, 0],
    [784, 0.14],
  ],
  void: [
    [740, 0],
    [554, 0.16],
    [415, 0.32],
  ],
};

function play(kind: keyof typeof TONES) {
  const ctx = audioContext();
  if (!ctx || ctx.state !== "running") return;
  for (const [freq, at] of TONES[kind]) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = kind === "void" ? "triangle" : "sine";
    o.frequency.value = freq;
    o.connect(g);
    g.connect(ctx.destination);
    const t = ctx.currentTime + at;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.start(t);
    o.stop(t + 0.32);
  }
}

/* ---------- Opciones y notas: lo que se quita en rojo, lo que se agrega en verde, lo que va aparte en azul ---------- */

type Tone = "sin" | "extra" | "aparte" | null;

function modTone(m: Pick<Mod, "name" | "price" | "group">): Tone {
  const name = m.name.toLowerCase();
  const group = (m.group ?? "").toLowerCase();
  if (/^sin\b/.test(name) || /\b(sin|quitar)\b/.test(group)) return "sin";
  if (/\baparte\b/.test(name) || /\baparte\b/.test(group)) return "aparte";
  if (m.price > 0 || /\b(adici|extra)/.test(group) || /^(extra|doble|con extra)\b/.test(name)) return "extra";
  return null;
}

function noteTone(note: string): Tone {
  if (/^sin\b/i.test(note.trim())) return "sin";
  if (/\baparte\b/i.test(note)) return "aparte";
  return null;
}

const TONE_TEXT: Record<Exclude<Tone, null>, string> = { sin: "text-[#ff9a92]", extra: "text-[#86e3b5]", aparte: "text-[#a9c8ff]" };

function Mods({ mods }: { mods: Mod[] }) {
  if (!mods.length) return null;
  return (
    <span className="block text-[14px] leading-snug">
      {mods.map((m, i) => {
        const tone = modTone(m);
        return (
          <span key={`${m.name}-${i}`}>
            {i ? <span className="text-cal/40"> · </span> : null}
            <span className={cn(tone ? cn("font-semibold", TONE_TEXT[tone]) : "text-cal/70")}>
              {tone === "extra" ? "+ " : ""}
              {m.name}
            </span>
          </span>
        );
      })}
    </span>
  );
}

function Note({ note }: { note: string }) {
  const tone = noteTone(note);
  return (
    <span
      className={cn(
        "mt-1 inline-block rounded-md px-1.5 py-0.5 text-[13px] font-bold",
        tone === "sin" ? "bg-[#ff9a92] text-tinto" : tone === "aparte" ? "bg-[#a9c8ff] text-tinto" : "bg-fachada text-tinto",
      )}
    >
      {note}
    </span>
  );
}

function AllergyBadge() {
  return (
    <span className="mr-1 inline-flex items-center gap-1 rounded-md bg-cereza px-1.5 py-0.5 align-middle text-[12px] font-bold tracking-wide text-white uppercase">
      <TriangleAlert size={12} /> Alergia
    </span>
  );
}

const KIND_LABEL: Record<string, string> = { mesa: "Mesa", barra: "Barra", llevar: "Para llevar" };
/** Borde del tiquete: lo que se empaca (para llevar y domicilios) se distingue de lo que va en plato */
const LLEVAR = "#4aa3ff";

function kindColor(t: Pick<Ticket, "kind" | "channel">) {
  if (t.kind === "domicilio") return CHANNEL_COLOR[t.channel ?? "propio"] ?? CHANNEL_COLOR.propio;
  if (t.kind === "llevar") return LLEVAR;
  return null;
}

function KindChip({ t }: { t: Pick<Ticket, "kind" | "channel"> }) {
  const color = kindColor(t);
  const label = t.kind === "domicilio" ? (CHANNEL_SHORT[t.channel ?? "propio"] ?? "Domicilio") : KIND_LABEL[t.kind];
  return (
    <span className={cn("mr-1 rounded px-1.5 py-0.5 font-bold", color ? "text-white" : "bg-white/12 text-cal/85")} style={color ? { background: color } : undefined}>
      {label}
    </span>
  );
}

const soundKey = (station: string | null) => `ronda-kds-sound:${station ?? "todo"}`;
const ALL_DAY_KEY = "ronda-kds-todo-el-dia";

export function Kds({
  board,
  station,
  business,
  businessId,
  staff,
  serverNow,
  thresholds,
}: {
  board: Board;
  station: string | null;
  business: string;
  businessId: string;
  staff: { name: string; canCharge: boolean };
  serverNow: number;
  thresholds: Thresholds;
}) {
  const router = useRouter();
  const now = useServerNow(serverNow, 1000);
  const [sound, setSound] = useState(false);
  // El navegador no deja sonar hasta que alguien toca la pantalla: si el sonido quedó prendido, se pide un toque
  const [locked, setLocked] = useState(false);
  const [allDay, setAllDay] = useState(true);
  const [pending, start] = useTransition();
  const seen = useRef<Set<string> | null>(null);
  const seenVoids = useRef<Set<string> | null>(null);
  const [detail, setDetail] = useState<{ checkId: string; data: KdsDetail | null } | null>(null);

  // Lo que la tablet recuerda: el sonido de esta pantalla y si se ve "todo el día"
  useEffect(() => {
    try {
      if (localStorage.getItem(ALL_DAY_KEY) === "0") setAllDay(false);
      if (localStorage.getItem(soundKey(station)) === "1") {
        setSound(true);
        const ctx = audioContext();
        if (ctx && ctx.state !== "running") setLocked(true);
      } else setSound(false);
    } catch {}
  }, [station]);

  useEffect(() => {
    if (!locked) return;
    const unlock = () => {
      audioContext()
        ?.resume()
        .then(() => setLocked(false))
        .catch(() => {});
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, [locked]);

  function toggleSound() {
    const next = !sound;
    setSound(next);
    try {
      localStorage.setItem(soundKey(station), next ? "1" : "0");
    } catch {}
    if (next) {
      // El toque en el botón es el permiso del navegador para sonar
      audioContext()
        ?.resume()
        .then(() => {
          setLocked(false);
          play(station === "barra" ? "barra" : "cocina");
        })
        .catch(() => {});
    }
  }

  function toggleAllDay() {
    setAllDay((v) => {
      try {
        localStorage.setItem(ALL_DAY_KEY, v ? "0" : "1");
      } catch {}
      return !v;
    });
  }

  // Suena cuando llega un tiquete nuevo (con el tono de su estación) y cuando se anula algo
  useEffect(() => {
    const keys = new Set(board.active.map((t) => t.key));
    if (seen.current && sound) {
      const fresh = board.active.filter((t) => !seen.current!.has(t.key));
      for (const st of new Set(fresh.map((t) => t.station))) play(st === "barra" ? "barra" : "cocina");
    }
    seen.current = keys;
  }, [board.active, sound]);
  useEffect(() => {
    const ids = new Set(board.voids.map((v) => v.id));
    if (seenVoids.current && sound && [...ids].some((id) => !seenVoids.current!.has(id))) play("void");
    seenVoids.current = ids;
  }, [board.voids, sound]);

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      if (report(await fn())) router.refresh();
    });

  function openDetail(checkId: string) {
    setDetail({ checkId, data: null });
    start(async () => {
      const r = await kdsDetailAction(checkId);
      if (r.ok && r.data) setDetail((d) => (d?.checkId === checkId ? { checkId, data: r.data! } : d));
      else {
        report(r);
        setDetail(null);
      }
    });
  }

  // Todo el día: cuántos de cada producto faltan por preparar, para alistar en tanda
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of board.active) for (const i of t.items) if (i.status === "sent") m.set(i.name, (m.get(i.name) ?? 0) + i.qty);
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [board.active]);

  const tabs = [
    { key: null, label: "Todo" },
    { key: "barra", label: "Barra" },
    { key: "cocina", label: "Cocina" },
  ];

  return (
    <div className="min-h-dvh bg-noche text-cal">
      <header className="sticky top-(--offline-h,0px) z-30 flex flex-wrap items-center gap-3 border-b border-white/10 bg-noche/95 px-3 py-2.5 backdrop-blur sm:px-5">
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
        <button onClick={toggleAllDay} className={btn(allDay ? "light" : "ghost", "sm", allDay ? "" : "text-cal/80 hover:bg-white/10")} aria-pressed={allDay}>
          <ListOrdered size={16} /> Todo el día
        </button>
        {/* Con la sede en el enlace: el televisor sin sesión muestra los pedidos de esta sede */}
        <a href={`/pantalla?sede=${businessId}`} target="_blank" rel="noopener" className={btn("light", "sm")}>
          Pantalla de turnos
        </a>
        <p className="hidden text-sm text-cal/70 md:block">{board.avgMinutes ? `Promedio ${board.avgMinutes.toLocaleString("es-CO")} min` : "Sin tiempos aún"}</p>
        <button onClick={toggleSound} className={btn(sound ? "warn" : "light", "sm")} aria-pressed={sound}>
          {sound ? <Volume2 size={16} /> : <VolumeX size={16} />} {sound ? "Sonido" : "Activar sonido"}
        </button>
        <span className="text-cal">
          <Live every={2500} />
        </span>
      </header>

      {sound && locked ? (
        <button onClick={() => audioContext()?.resume().then(() => setLocked(false))} className="flex w-full items-center justify-center gap-2 bg-fachada px-4 py-2.5 text-[15px] font-bold text-tinto">
          <Volume2 size={18} /> Toca aquí para que el sonido vuelva a funcionar
        </button>
      ) : null}

      {board.voids.length ? <Voids voids={board.voids} now={now} pending={pending} onAck={(ids) => act(() => kdsAckVoidsAction(ids))} /> : null}

      {allDay && totals.length ? (
        <section aria-label="Todo el día" className="scrollbar-none flex items-center gap-2 overflow-x-auto border-b border-white/10 px-3 py-2.5 sm:px-5">
          <span className="shrink-0 text-[13px] font-semibold text-cal/60">Por preparar</span>
          {totals.map(([name, qty]) => (
            <span key={name} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-white/8 py-1 pr-3 pl-1 text-[15px]">
              <span className="flex h-7 min-w-7 items-center justify-center rounded-lg bg-cal px-1.5 font-bold text-tinto tnum">{qty}</span>
              <span className="font-semibold">{name}</span>
            </span>
          ))}
        </section>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 p-3 sm:p-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="En preparación">
          <h2 className="mb-3 text-sm font-semibold text-cal/70">En preparación · {board.active.length}</h2>
          {board.active.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(260px,100%),1fr))] gap-3">
              {board.active.map((t) => {
                const elapsed = now - new Date(t.sentAt).getTime();
                const mins = Math.floor(elapsed / 60_000);
                const secs = Math.floor((elapsed / 1000) % 60);
                const limit = thresholds[t.station === "barra" ? "barra" : "cocina"];
                const tone = mins >= limit.late ? "bg-cereza" : mins >= limit.warn ? "bg-fachada text-tinto" : "bg-puerta";
                const edge = kindColor(t);
                const allergy = t.items.some((i) => i.allergy);
                return (
                  <Arrive
                    key={t.key}
                    fresh={!!seen.current && !seen.current.has(t.key)}
                    className={cn("relative flex flex-col overflow-hidden rounded-2xl bg-noche-2 ring-1", allergy ? "ring-2 ring-cereza" : "ring-white/8", edge && "pl-1.5")}
                  >
                    {edge ? <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: edge }} aria-hidden /> : null}
                    <button
                      onClick={() => openDetail(t.checkId)}
                      className={cn("flex items-center justify-between gap-2 px-4 py-2.5 text-left", tone)}
                      aria-label={`Ver la cuenta completa de ${t.label}`}
                    >
                      <span className="flex min-w-0 items-center gap-1 text-xl font-bold [font-stretch:108%]">
                        <span className="truncate">{t.label}</span>
                        <ChevronRight size={18} className="shrink-0 opacity-70" />
                      </span>
                      <span className="shrink-0 text-xl font-bold tnum">
                        {mins}:{String(secs).padStart(2, "0")}
                      </span>
                    </button>
                    <p className="px-4 pt-2 text-[13px] leading-6 text-cal/60">
                      <KindChip t={t} />
                      {t.paid ? <span className="mr-1 rounded bg-puerta px-1.5 py-0.5 font-bold text-white">Pagado</span> : null}
                      {t.movedFrom ? <span className="mr-1 rounded bg-fachada px-1.5 py-0.5 font-bold text-tinto">Antes en la mesa {t.movedFrom}</span> : null}
                      {allergy ? <AllergyBadge /> : null}
                      Ronda {t.round} · {t.station === "cocina" ? "Cocina" : "Barra"}
                      {t.waiter ? ` · ${t.waiter}` : ""}
                      {t.kind === "mesa" ? ` · ${t.guests} ${t.guests === 1 ? "persona" : "personas"}` : ""}
                    </p>
                    {t.riderAt ? <Rider at={t.riderAt} now={now} /> : null}
                    <ul className="flex-1 space-y-1 px-2 py-2">
                      {t.items.map((i) => (
                        <TicketLine key={i.id} item={i} disabled={pending} onToggle={() => act(() => kdsItemAction(i.id, i.status !== "sent" ? "sent" : "ready"))} />
                      ))}
                    </ul>
                    {t.held.length ? (
                      <p className="mx-4 mb-2 flex items-start gap-1.5 border-t border-dashed border-white/15 pt-2 text-[13px] text-cal/70">
                        <Pause size={14} className="mt-0.5 shrink-0" />
                        <span>
                          <b className="text-cal/90">Sale después:</b> {t.held.map((h) => `${h.qty} ${h.name}`).join(", ")}
                        </span>
                      </p>
                    ) : null}
                    <div className="p-2 pt-0">
                      <button className={btn("send", "lg", "w-full")} disabled={pending} onClick={() => act(() => kdsBumpAction(t.checkId, t.round, t.station, "ready"))}>
                        <Check size={20} /> Listo todo
                      </button>
                    </div>
                  </Arrive>
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
                  <button onClick={() => openDetail(t.checkId)} className="flex min-h-10 w-full items-center justify-between gap-2 text-left">
                    <span className="min-w-0 truncate text-lg font-bold">{t.label}</span>
                    <span className="shrink-0 text-[13px] text-cal/70">{t.waiter}</span>
                  </button>
                  {t.movedFrom ? <p className="mt-1 w-fit rounded bg-fachada px-1.5 py-0.5 text-[13px] font-bold text-tinto">Antes en la mesa {t.movedFrom}</p> : null}
                  <p className="mt-1 text-[15px] text-cal/85">
                    {t.items.some((i) => i.allergy) ? <AllergyBadge /> : null}
                    {t.items.map((i) => `${i.qty} ${i.name}${i.seat ? ` (P${i.seat})` : ""}`).join(", ")}
                  </p>
                  {t.held.length ? (
                    <p className="mt-1 flex items-start gap-1.5 text-[13px] text-cal/70">
                      <Pause size={14} className="mt-0.5 shrink-0" />
                      <span>
                        <b className="text-cal/90">Sale después:</b> {t.held.map((h) => `${h.qty} ${h.name}`).join(", ")}
                      </span>
                    </p>
                  ) : null}
                  {t.channel ? (
                    // El domicilio no se entrega en la mesa: pasa a empaque, donde se revisa la bolsa
                    <Link href="/domicilios" className={btn("light", "md", "mt-2 w-full")}>
                      <PackageCheck size={18} /> A empacar
                    </Link>
                  ) : (
                    <button className={btn("light", "md", "mt-2 w-full")} disabled={pending} onClick={() => act(() => kdsBumpAction(t.checkId, t.round, t.station, "delivered"))}>
                      <CheckCheck size={18} /> Entregado
                    </button>
                  )}
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

      <DetailSheet detail={detail} station={station} onClose={() => setDetail(null)} />
    </div>
  );
}

function TicketLine({ item: i, disabled, onToggle }: { item: TicketItem; disabled: boolean; onToggle: () => void }) {
  const ready = i.status !== "sent";
  return (
    <li>
      <button disabled={disabled} onClick={onToggle} className={cn("flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-white/6", ready && "opacity-45")}>
        <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg text-[15px] font-bold tnum", ready ? "bg-puerta text-white" : "bg-white/12")}>
          {ready ? <Check size={16} /> : i.qty}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block text-[17px] font-semibold leading-tight", ready && "line-through")}>
            {i.name}
            {i.seat ? <span className="ml-1.5 rounded bg-white/12 px-1 align-middle text-[12px] font-bold text-cal/85">P{i.seat}</span> : null}
          </span>
          <Mods mods={i.modifiers} />
          {i.allergy || i.note ? (
            <span className="block">
              {i.allergy ? <AllergyBadge /> : null}
              {i.note ? <Note note={i.note} /> : null}
            </span>
          ) : null}
          {i.ficha && !ready ? <span className="mt-1 block text-[12px] leading-snug text-cal/50">Ficha: {i.ficha}</span> : null}
        </span>
        {i.source === "qr" ? <QrCode size={16} className="mt-1 shrink-0 text-cal/50" aria-label="Pedido por QR" /> : null}
      </button>
    </li>
  );
}

/** Lo anulado que estaba en pantalla: en rojo, con el motivo, hasta que alguien de barra o cocina lo marca como visto. */
function Voids({ voids, now, pending, onAck }: { voids: VoidNotice[]; now: number; pending: boolean; onAck: (ids: string[]) => void }) {
  return (
    <section aria-label="Anulados" className="border-b border-cereza/40 bg-cereza/15 px-3 py-3 sm:px-5">
      <div className="mb-2 flex items-center gap-2">
        <Ban size={18} className="text-[#ff9a92]" />
        <h2 className="mr-auto text-[15px] font-bold">Anulado: no lo prepares</h2>
        {voids.length > 1 ? (
          <button className={btn("light", "sm")} disabled={pending} onClick={() => onAck(voids.map((v) => v.id))}>
            <Check size={16} /> Todo visto
          </button>
        ) : null}
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-2">
        {voids.map((v) => (
          <li key={v.id} className="arrive flex items-start gap-3 rounded-2xl bg-noche-2 p-3 ring-2 ring-cereza">
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-cal/70">
                {v.label} · Ronda {v.round} · {v.station === "cocina" ? "Cocina" : "Barra"}
              </span>
              <span className="block text-[17px] font-bold leading-tight line-through decoration-cereza decoration-2">
                {v.qty} {v.name}
              </span>
              <Mods mods={v.modifiers} />
              <span className="mt-1 block text-[13px] text-cal/80">
                {v.reason}
                {v.by ? ` · ${v.by}` : ""} · {ago(now, v.at)}
              </span>
              {v.wasReady ? <span className="mt-1 inline-block rounded-md bg-fachada px-1.5 py-0.5 text-[13px] font-bold text-tinto">Ya estaba listo: retíralo del pase</span> : null}
            </span>
            <button className={btn("light", "md", "shrink-0")} disabled={pending} onClick={() => onAck([v.id])}>
              Visto
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ago(now: number, at: string) {
  const mins = Math.floor((now - Date.parse(at)) / 60_000);
  return mins < 1 ? "ahora" : `hace ${mins} min`;
}

const STATUS_LABEL: Record<string, string> = { open: "Abierta", bill: "Pidió la cuenta", paid: "Pagada", void: "Descartada", merged: "Unida a otra" };

/** La cuenta completa para barra y cocina: quién la atiende, cuántos son, las rondas, lo retenido y lo que ha pasado. */
function DetailSheet({ detail, station, onClose }: { detail: { checkId: string; data: KdsDetail | null } | null; station: string | null; onClose: () => void }) {
  const d = detail?.data;
  return (
    <Sheet open={!!detail} onClose={onClose} title={d ? `${d.label} · #${d.number}` : "Cuenta"} dark wide>
      {!d ? (
        <div className="space-y-3" aria-busy="true" aria-label="Cargando la cuenta">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-white/8" />
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Atiende", d.waiter ?? "QR de la mesa"],
              ["Personas", String(d.guests)],
              ["Abierta", fmtTime(d.openedAt)],
              ["Estado", STATUS_LABEL[d.status] ?? d.status],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-white/6 px-3 py-2">
                <dt className="text-[12px] text-cal/60">{k}</dt>
                <dd className="font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          {d.delivery ? (
            <p className="rounded-xl bg-white/6 px-3 py-2 text-[15px]">
              <KindChip t={{ kind: d.kind, channel: d.channel }} /> Código <b>{d.delivery.code}</b>
              {d.delivery.riderAt ? ` · domiciliario a las ${fmtTime(d.delivery.riderAt)}` : ""}
              {d.delivery.notes ? <span className="mt-1 block text-cal/80">Notas del cliente: {d.delivery.notes}</span> : null}
            </p>
          ) : null}
          {d.held.length ? (
            <section>
              <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-bold text-cal/80">
                <Pause size={14} /> Retenido: sale cuando el mesero lo mande
              </h3>
              <ul className="space-y-1">
                {d.held.map((i) => (
                  <DetailLine key={i.id} item={i} />
                ))}
              </ul>
            </section>
          ) : null}
          {d.rounds.map((r) => (
            <section key={r.round}>
              <h3 className="mb-1.5 flex items-center gap-2 text-sm font-bold text-cal/80">
                <span className="flex-1">
                  Ronda {r.round}
                  {r.sentAt ? ` · ${fmtTime(r.sentAt)}` : ""}
                </span>
                <Link
                  href={`/comanda/${detail!.checkId}?ronda=${r.round}&de=barra${station ? `&estacion=${station}` : ""}&auto=1`}
                  className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2.5 font-semibold text-cal/85 hover:bg-white/10"
                  aria-label={`Imprimir la comanda de la ronda ${r.round}`}
                >
                  <Printer size={14} /> Comanda
                </Link>
              </h3>
              <ul className="space-y-1">
                {r.items.map((i) => (
                  <DetailLine key={i.id} item={i} />
                ))}
              </ul>
            </section>
          ))}
          <section>
            <h3 className="mb-2 text-sm font-bold text-cal/80">Historial</h3>
            <ol className="relative space-y-2 border-l border-white/15 pl-4">
              {d.events.map((e, i) => (
                <li key={i} className="relative text-[14px]">
                  <span
                    className={cn("absolute top-1.5 -left-[21px] size-2.5 rounded-full ring-2 ring-noche-2", e.tone === "red" ? "bg-cereza" : e.tone === "green" ? "bg-puerta" : "bg-cal/50")}
                    aria-hidden
                  />
                  <span className="mr-2 text-cal/55 tnum">{fmtTime(e.at)}</span>
                  <span className={cn(e.tone === "red" && "text-[#ff9a92]")}>{e.text}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </Sheet>
  );
}

const ITEM_ICON: Record<string, React.ReactNode> = {
  draft: <Pause size={14} />,
  sent: <Clock size={14} />,
  ready: <Check size={14} />,
  delivered: <CheckCheck size={14} />,
  void: <X size={14} />,
};

function DetailLine({ item: i }: { item: KdsDetailItem }) {
  const voided = i.status === "void";
  return (
    <li className="flex items-start gap-2.5 rounded-xl bg-white/5 px-3 py-2">
      <span
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
          voided ? "bg-cereza text-white" : i.status === "ready" ? "bg-puerta text-white" : i.status === "sent" ? "bg-fachada text-tinto" : "bg-white/12 text-cal/80",
        )}
        title={{ draft: "Retenido", sent: "En preparación", ready: "Listo", delivered: "Entregado", void: "Anulado" }[i.status]}
      >
        {ITEM_ICON[i.status]}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block font-semibold leading-tight", voided && "text-cal/60 line-through")}>
          <span className="tnum">{i.qty}</span> {i.name}
          {i.seat ? <span className="ml-1.5 rounded bg-white/12 px-1 text-[12px] font-bold text-cal/85">P{i.seat}</span> : null}
          <span className="ml-1.5 text-[12px] font-normal text-cal/50">{i.station === "cocina" ? "Cocina" : "Barra"}</span>
          {i.source === "qr" ? <QrCode size={13} className="ml-1 inline text-cal/50" aria-label="Por QR" /> : null}
        </span>
        <Mods mods={i.modifiers} />
        {i.allergy || i.note ? (
          <span className="block">
            {i.allergy ? <AllergyBadge /> : null}
            {i.note ? <Note note={i.note} /> : null}
          </span>
        ) : null}
        {voided ? (
          <span className="mt-0.5 block text-[13px] text-[#ff9a92]">
            Anulado{i.voidReason ? `: ${i.voidReason}` : ""}
            {i.voidBy ? ` (${i.voidBy})` : ""}
          </span>
        ) : null}
      </span>
    </li>
  );
}

/** Un tiquete que llega mientras la pantalla está abierta entra deslizándose; los que ya estaban no se mueven. */
function Arrive({ fresh, className, children }: { fresh: boolean; className: string; children: React.ReactNode }) {
  const [anim] = useState(fresh);
  return <article className={cn(className, anim && "arrive")}>{children}</article>;
}

/** Cuánto falta para que llegue el domiciliario de la plataforma: la cocina prioriza con esto. */
function Rider({ at, now }: { at: string; now: number }) {
  const mins = Math.round((Date.parse(at) - now) / 60_000);
  return (
    <p className={cn("mx-4 mt-1.5 inline-flex w-fit items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[13px] font-semibold", mins <= 3 ? "bg-cereza text-white" : "bg-white/10 text-cal/85")}>
      <Bike size={14} /> {mins > 0 ? `Domiciliario en ${mins} min` : mins === 0 ? "Domiciliario llegando" : `Domiciliario esperando hace ${-mins} min`}
    </p>
  );
}
