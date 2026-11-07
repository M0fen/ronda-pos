"use client";

import { MapPin } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { chooseSedeAction, logoutAction } from "@/app/entrar/actions";
import { btn } from "@/components/ui";
import { cn } from "@/lib/utils";
import { report } from "./toast";

/** Sede de este dispositivo: en la tablet de cada sede aparece su equipo al entrar. */
export function SedePicker({ sedes, current }: { sedes: { id: string; sede: string }[]; current: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="mt-5">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-humo">
        <MapPin size={15} /> Sede de esta tablet
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {sedes.map((s) => (
          <button
            key={s.id}
            disabled={pending || s.id === current}
            onClick={() => start(async () => void (report(await chooseSedeAction(s.id)) && router.refresh()))}
            className={cn("h-11 rounded-full px-4 text-[15px] font-semibold ring-1 transition", s.id === current ? "bg-balcon text-white ring-balcon" : "bg-papel ring-linea-2 hover:ring-tinto")}
          >
            {s.sede}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Desde el panel de la cadena: pasar esta tablet a otra sede y entrar con el PIN. */
export function GoToSede({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      className={btn("soft", "sm")}
      disabled={pending}
      onClick={() =>
        start(async () => {
          if (!report(await chooseSedeAction(id))) return;
          await logoutAction();
          router.replace("/entrar");
        })
      }
    >
      {label}
    </button>
  );
}
