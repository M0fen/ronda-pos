"use client";

import { Check, CircleAlert, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";

type Toast = { id: number; text: string; tone: "ok" | "error"; undo?: () => void };
let counter = 0;

export function toast(text: string, opts: { tone?: "ok" | "error"; undo?: () => void } = {}) {
  window.dispatchEvent(new CustomEvent("ronda-toast", { detail: { id: ++counter, text, tone: opts.tone ?? "ok", undo: opts.undo } }));
}

/** Muestra el resultado de una acción del servidor. Devuelve true si salió bien. */
export function report(result: { ok: boolean; message?: string; error?: string } | undefined | null, success?: string) {
  if (!result) return false;
  if (result.ok) {
    if (success ?? result.message) toast((success ?? result.message)!);
    return true;
  }
  toast(result.error ?? "No se pudo", { tone: "error" });
  return false;
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const t = (e as CustomEvent<Toast>).detail;
      setItems((list) => [...list.slice(-2), t]);
      setTimeout(() => setItems((list) => list.filter((x) => x.id !== t.id)), t.undo ? 5000 : 3200);
    };
    window.addEventListener("ronda-toast", on);
    return () => window.removeEventListener("ronda-toast", on);
  }, []);
  return (
    <div className="no-print pointer-events-none fixed inset-x-0 bottom-4 z-[80] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl px-4 py-3 text-[15px] font-medium shadow-lg ${t.tone === "error" ? "bg-cereza text-white" : "bg-tinto text-cal"}`} role="status">
          {t.tone === "error" ? <CircleAlert size={18} className="shrink-0" /> : <Check size={18} className="shrink-0" />}
          <span>{t.text}</span>
          {t.undo ? (
            <button
              className="ml-2 inline-flex items-center gap-1 rounded-lg bg-white/15 px-2.5 py-1 text-sm font-semibold"
              onClick={() => {
                t.undo?.();
                setItems((list) => list.filter((x) => x.id !== t.id));
              }}
            >
              <Undo2 size={14} /> Deshacer
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
