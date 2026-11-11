"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { pulseAction } from "@/app/(pos)/actions";
import { reportNet } from "@/components/offline-notice";

/**
 * Mantiene la pantalla al día: pregunta cada pocos segundos si algo cambió en el local y, si cambió,
 * vuelve a pedir la página. Sin cambios, pregunta cada vez más espaciado (hasta 12 s); un toque lo acelera.
 * Si la sesión terminó, lleva a /entrar con el aviso.
 */
export function Live({ every = 3000, onChange, refresh = true }: { every?: number; onChange?: () => void; refresh?: boolean }) {
  const router = useRouter();
  const version = useRef<number | null>(null);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    let wait = every;
    const tick = async () => {
      if (stop) return;
      if (document.visibilityState === "visible" && navigator.onLine !== false) {
        try {
          const v = await pulseAction();
          setOnline(true);
          reportNet(true);
          if (v === -1) {
            router.replace("/entrar?sesion=1");
            return;
          }
          if (version.current !== null && v !== version.current) {
            wait = every;
            onChange?.();
            if (refresh) router.refresh();
          } else wait = Math.min(12_000, wait + 1000);
          version.current = v;
        } catch {
          setOnline(false);
          reportNet(false);
          wait = every;
        }
      } else if (navigator.onLine === false) setOnline(false);
      timer = setTimeout(tick, wait);
    };
    tick();
    const touch = () => (wait = every);
    // Sin red no se recarga al despertar: la recarga fallida reemplazaría la pantalla por la del navegador
    const wake = () => document.visibilityState === "visible" && refresh && navigator.onLine !== false && router.refresh();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("pointerdown", touch, { passive: true });
    return () => {
      stop = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("pointerdown", touch);
    };
  }, [every, router, onChange, refresh]);
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium" title={online ? "Conectado" : "Sin conexión: reintentando"}>
      <span className={`size-2.5 rounded-full ${online ? "bg-puerta" : "bg-cereza"}`} />
      <span>{online ? "En vivo" : "Sin conexión"}</span>
    </span>
  );
}
