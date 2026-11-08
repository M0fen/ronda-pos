"use client";

import { MonitorSmartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { enrollAction } from "@/app/entrar/actions";
import { btn } from "@/components/ui";
import { Keypad } from "./keypad";
import { report } from "./toast";

/** Pantalla de una tablet sin enrolar: pide el código de 6 números que da el dueño en Panel → Equipo. */
export function EnrollDevice() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="mt-10 rounded-3xl bg-papel p-6 ring-1 ring-linea">
      <p className="flex items-center gap-2 text-xl font-bold">
        <MonitorSmartphone size={22} /> Esta tablet no está enrolada
      </p>
      <p className="mt-2 text-tinto-2">
        Para ver al equipo y entrar, el dueño o la administración crean un código en <b>Panel → Equipo → Tablets</b>. Escríbelo aquí: vale 15 minutos.
      </p>
      <div className="my-5 flex justify-center gap-3" aria-label={`${code.length} de 6 números`}>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className="flex h-14 w-11 items-center justify-center rounded-xl bg-cal text-2xl font-bold tnum ring-1 ring-linea-2">
            {code[i] ?? ""}
          </span>
        ))}
      </div>
      <div className="mx-auto max-w-xs">
        <Keypad onKey={(k) => setCode((c) => (k === "del" ? c.slice(0, -1) : (c + k).slice(0, 6)))} />
      </div>
      <button
        className={btn("primary", "lg", "mt-4 w-full")}
        disabled={pending || code.length !== 6}
        onClick={() =>
          start(async () => {
            if (report(await enrollAction(code))) router.refresh();
            else setCode("");
          })
        }
      >
        Enrolar esta tablet
      </button>
    </div>
  );
}
