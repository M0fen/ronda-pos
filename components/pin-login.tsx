"use client";

import { ArrowLeft, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { pinLoginAction } from "@/app/entrar/actions";
import { Avatar } from "@/components/ui";
import { Keypad } from "./keypad";
import { toast } from "./toast";

type Person = { id: string; name: string; role: string; roleLabel: string; color: string; hint: string | null };

export function PinLogin({ staff }: { staff: Person[] }) {
  const router = useRouter();
  const [who, setWho] = useState<Person | null>(null);
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(false);
  const [pending, start] = useTransition();

  function press(k: string) {
    if (pending || !who) return;
    if (k === "del") return setPin((p) => p.slice(0, -1));
    const next = (pin + k).slice(0, 4);
    setPin(next);
    if (next.length === 4) {
      start(async () => {
        const result = await pinLoginAction(who.id, next);
        if (result.ok) {
          router.replace(result.data?.role === "bar" ? "/barra" : "/salon");
        } else {
          toast(result.error, { tone: "error" });
          setShake(true);
          setTimeout(() => setShake(false), 400);
          setPin("");
        }
      });
    }
  }

  if (!who)
    return (
      <div className="rounded-3xl bg-papel p-4 shadow-sm ring-1 ring-linea sm:p-5">
        <p className="px-1 pb-3 text-sm font-semibold text-humo">¿Quién eres?</p>
        <ul className="grid gap-2">
          {staff.map((s) => (
            <li key={s.id}>
              <button onClick={() => setWho(s)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition hover:bg-cal">
                <Avatar name={s.name} color={s.color} size={44} />
                <span className="flex-1">
                  <span className="block text-lg font-semibold leading-tight">{s.name}</span>
                  <span className="block text-sm text-humo">{s.roleLabel}</span>
                </span>
                {s.hint ? <span className="rounded-lg bg-cal px-2 py-1 font-mono text-sm text-humo">PIN {s.hint}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );

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
