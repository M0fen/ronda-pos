"use client";

import { ArrowLeft, Clock, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { clockAction, pinLoginAction } from "@/app/entrar/actions";
import { Avatar } from "@/components/ui";
import { fmtTime } from "@/lib/format";
import { fmtHours } from "@/lib/core/labor";
import { cn } from "@/lib/utils";
import { Keypad } from "./keypad";
import { toast } from "./toast";

type Person = { id: string; name: string; role: string; roleLabel: string; color: string; hint: string | null; since: string | null };
type Mode = "entrar" | "turno";

export function PinLogin({ staff }: { staff: Person[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("entrar");
  const [who, setWho] = useState<Person | null>(null);
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(false);
  const [pending, start] = useTransition();

  function fail(error: string) {
    toast(error, { tone: "error" });
    setShake(true);
    setTimeout(() => setShake(false), 400);
    setPin("");
  }

  function press(k: string) {
    if (pending || !who) return;
    if (k === "del") return setPin((p) => p.slice(0, -1));
    const next = (pin + k).slice(0, 4);
    setPin(next);
    if (next.length !== 4) return;
    start(async () => {
      if (mode === "entrar") {
        const result = await pinLoginAction(who.id, next);
        if (result.ok) router.replace(result.data?.role === "bar" ? "/barra" : "/salon");
        else fail(result.error);
        return;
      }
      const result = await clockAction(who.id, next);
      if (!result.ok || !result.data) return fail(result.ok ? "Algo salió mal" : result.error);
      const d = result.data;
      toast(d.action === "in" ? `¡Buen turno, ${d.name}! Entrada marcada a las ${fmtTime(d.at)}` : `Salida marcada a las ${fmtTime(d.at)}: trabajaste ${fmtHours(d.minutes)}`);
      setWho(null);
      setPin("");
      router.refresh();
    });
  }

  const tabs = (
    <div className="mb-3 grid grid-cols-2 rounded-2xl bg-cal p-1" role="tablist" aria-label="Qué quieres hacer">
      {(
        [
          ["entrar", "Entrar"],
          ["turno", "Marcar turno"],
        ] as const
      ).map(([m, label]) => (
        <button
          key={m}
          role="tab"
          aria-selected={mode === m}
          onClick={() => (setMode(m), setWho(null), setPin(""))}
          className={cn("flex h-11 items-center justify-center gap-1.5 rounded-xl text-[15px] font-semibold transition", mode === m ? "bg-papel shadow-sm ring-1 ring-linea" : "text-humo hover:text-tinto")}
        >
          {m === "turno" ? <Clock size={16} /> : null}
          {label}
        </button>
      ))}
    </div>
  );

  if (!who)
    return (
      <div className="rounded-3xl bg-papel p-4 shadow-sm ring-1 ring-linea sm:p-5">
        {tabs}
        <p className="px-1 pb-3 text-sm font-semibold text-humo">{mode === "entrar" ? "¿Quién eres?" : "Toca tu nombre para marcar tu entrada o tu salida"}</p>
        <ul className="grid gap-2">
          {staff.map((s) => (
            <li key={s.id}>
              <button onClick={() => setWho(s)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition hover:bg-cal">
                <Avatar name={s.name} color={s.color} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-semibold leading-tight">{s.name}</span>
                  <span className="block text-sm text-humo">
                    {s.roleLabel}
                    {s.since ? <span className="font-semibold text-puerta-2"> · en turno desde las {fmtTime(s.since)}</span> : null}
                  </span>
                </span>
                {s.hint ? <span className="shrink-0 whitespace-nowrap rounded-lg bg-cal px-2 py-1 font-mono text-sm text-humo">PIN {s.hint}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );

  const clockText = mode === "turno" ? (who.since ? `Marca tu salida · en turno desde las ${fmtTime(who.since)}` : "Marca tu entrada al turno") : null;

  return (
    <div className="rounded-3xl bg-papel p-5 shadow-sm ring-1 ring-linea">
      <button onClick={() => (setWho(null), setPin(""))} className="-ml-1 inline-flex items-center gap-1 rounded-lg px-1 py-1 text-sm font-semibold text-humo hover:text-tinto">
        <ArrowLeft size={16} /> Cambiar persona
      </button>
      <div className="mt-3 flex items-center gap-3">
        <Avatar name={who.name} color={who.color} size={48} />
        <div>
          <p className="text-xl font-bold leading-tight">{who.name}</p>
          <p className="text-sm text-humo">{who.hint ? `PIN de prueba: ${who.hint}` : who.roleLabel}</p>
        </div>
      </div>
      {clockText ? <p className="mt-3 rounded-xl bg-puerta-soft px-3 py-2 text-[15px] font-semibold text-puerta-2">{clockText}</p> : null}
      <div className={`my-6 flex justify-center gap-4 ${shake ? "animate-[shake_0.35s]" : ""}`} aria-label={`${pin.length} de 4 números`}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`size-4 rounded-full transition ${i < pin.length ? "bg-tinto" : "bg-tinto/12"}`} />
        ))}
      </div>
      {pending ? (
        <div className="flex h-[248px] items-center justify-center text-humo">
          <Loader2 className="animate-spin" />
        </div>
      ) : (
        <Keypad onKey={press} />
      )}
      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}`}</style>
    </div>
  );
}
