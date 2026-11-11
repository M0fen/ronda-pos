"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { retryDianAction } from "@/app/(pos)/actions";
import { btn } from "@/components/ui";
import { cn } from "@/lib/utils";
import { report } from "../toast";

/** Aviso del panel cuando algo no ha llegado a la DIAN: cuánto, desde cuándo y un botón para reintentar ya. */
export function DianAlert({ pending, rejected, hours, overdue, lastError }: { pending: number; rejected: number; hours: number | null; overdue: boolean; lastError: string | null }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const urgent = overdue || rejected > 0;
  return (
    <div className={cn("mt-3 flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-[15px]", urgent ? "bg-cereza-soft text-cereza" : "bg-fachada-soft text-tinto")}>
      <TriangleAlert size={18} className="shrink-0" />
      <p className="min-w-0 flex-1">
        <b>
          {pending ? `${pending} ${pending === 1 ? "documento sin validar" : "documentos sin validar"} ante la DIAN` : ""}
          {pending && rejected ? " y " : ""}
          {rejected ? `${rejected} ${rejected === 1 ? "rechazado" : "rechazados"}` : ""}.
        </b>{" "}
        {pending && hours !== null ? (overdue ? "Pasaron más de 48 horas: ya no cuenta como contingencia. " : `El más antiguo es de hace ${hours} h; hay 48 horas para transmitirlo. `) : ""}
        {lastError ? <span className="block text-sm opacity-80">{lastError}</span> : null}
      </p>
      {pending ? (
        <button className={btn("soft", "md")} disabled={busy} onClick={() => start(async () => (report(await retryDianAction()), router.refresh()))}>
          <RotateCcw size={16} /> Reintentar ahora
        </button>
      ) : null}
    </div>
  );
}
