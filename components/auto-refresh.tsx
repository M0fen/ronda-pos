"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { screenPulseAction } from "@/app/pantalla/actions";

/**
 * Pantallas públicas (sin sesión): preguntan cada pocos segundos si algo cambió en el local y solo entonces
 * vuelven a pedir la página (y cada minuto, por si acaso). Sin internet lo dicen, y al volver se ponen al día solas.
 */
export function AutoRefresh({ bizId, every = 4000 }: { bizId: string; every?: number }) {
  const router = useRouter();
  const version = useRef<number | null>(null);
  const last = useRef(0);
  const up = useRef(true);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    last.current = Date.now();
    const tick = async () => {
      if (stop) return;
      if (document.visibilityState === "visible") {
        try {
          const v = await screenPulseAction(bizId);
          const back = !up.current;
          up.current = true;
          setOnline(true);
          if (back || (version.current !== null && v !== version.current) || Date.now() - last.current > 60_000) {
            last.current = Date.now();
            router.refresh();
          }
          version.current = v;
        } catch {
          up.current = false;
          setOnline(false);
        }
      }
      timer = setTimeout(tick, every);
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [bizId, every, router]);
  return online ? null : (
    <p role="status" className="fixed bottom-5 right-5 flex items-center gap-2 rounded-full bg-black/60 px-5 py-2.5 text-lg text-white">
      <span className="size-3 rounded-full bg-cereza" /> Sin conexión: reintentando
    </p>
  );
}
