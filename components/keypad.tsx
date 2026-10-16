"use client";

import { Delete } from "lucide-react";
import { cn } from "@/lib/utils";

/** Teclado numérico propio para montos y PIN (el del sistema solo para notas y búsqueda). */
export function Keypad({ onKey, dark, extra }: { onKey: (k: string) => void; dark?: boolean; extra?: { label: string; value: string } }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", extra ? extra.value : "", "0", "del"];
  return (
    <div className="grid grid-cols-3 gap-2">
      {keys.map((k, i) =>
        k === "" ? (
          <span key={i} />
        ) : (
          <button
            key={i}
            type="button"
            onClick={() => onKey(k)}
            className={cn(
              "flex h-14 items-center justify-center rounded-2xl text-2xl font-semibold tnum transition-colors active:scale-[0.98]",
              dark ? "bg-white/8 text-cal hover:bg-white/14" : "bg-tinto/5 hover:bg-tinto/10",
            )}
            aria-label={k === "del" ? "Borrar" : extra && k === extra.value ? extra.label : k}
          >
            {k === "del" ? <Delete size={22} /> : extra && k === extra.value ? <span className="text-lg">{extra.label}</span> : k}
          </button>
        ),
      )}
    </div>
  );
}
