"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { pulseAction } from "@/app/(pos)/actions";

/**
 * Mantiene la pantalla al día: pregunta cada pocos segundos si algo cambió en el local
 * y, si cambió, vuelve a pedir la página. Muestra si hay conexión.
 */
export function Live({ every = 3000, onChange }: { every?: number; onChange?: () => void }) {
  const router = useRouter();
  const version = useRef<number | null>(null);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stop) return;
      if (document.visibilityState === "visible") {
        try {
          const v = await pulseAction();
          setOnline(true);
          if (version.current !== null && v !== version.current) {
            onChange?.();
            router.refresh();
          }
          version.current = v;
        } catch {
          setOnline(false);
        }
      }
      timer = setTimeout(tick, every);
    };
    tick();
    const wake = () => document.visibilityState === "visible" && router.refresh();
    document.addEventListener("visibilitychange", wake);
    return () => {
      stop = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [every, router, onChange]);
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium" title={online ? "Conectado" : "Sin conexión: reintentando"}>
      <span className={`size-2.5 rounded-full ${online ? "bg-puerta" : "bg-cereza"}`} />
      <span className="hidden sm:inline">{online ? "En vivo" : "Sin conexión"}</span>
    </span>
  );
}
