"use client";

import { Wifi, WifiOff } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** Lo que mandan las pantallas que preguntan por cambios (Live, AutoRefresh): true si el servidor respondió. */
export const NET_EVENT = "ronda-net";
export const reportNet = (ok: boolean) => window.dispatchEvent(new CustomEvent(NET_EVENT, { detail: ok }));

/** Un fetch que no llegó al servidor: sin red, wifi sin internet o el servidor no contestó. */
export function isConnectionError(error: unknown) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return /failed to fetch|networkerror|load failed|fetch failed|network request failed|network connection was lost|unexpected response was received from the server/i.test(msg);
}

/**
 * Aviso de "Sin conexión" en todas las pantallas. El navegador avisa al instante cuando se cae la red; cuando el
 * wifi sigue conectado pero no hay internet, lo confirman dos preguntas seguidas al servidor que no llegan.
 * Al volver, dice "Volvió la conexión" un momento y se quita. La pantalla de turnos tiene su propio aviso.
 */
export function OfflineNotice() {
  const pathname = usePathname() ?? "";
  const [state, setState] = useState<"ok" | "off" | "back">("ok");
  useEffect(() => {
    let fails = 0;
    let off = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const down = () => {
      off = true;
      clearTimeout(timer);
      setState("off");
    };
    const up = () => {
      fails = 0;
      if (!off) return;
      off = false;
      setState("back");
      clearTimeout(timer);
      timer = setTimeout(() => setState("ok"), 3000);
    };
    const onNet = (e: Event) => {
      if ((e as CustomEvent<boolean>).detail) up();
      else if (++fails >= 2) down();
    };
    if (navigator.onLine === false) down();
    window.addEventListener("offline", down);
    window.addEventListener("online", up);
    window.addEventListener(NET_EVENT, onNet);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("offline", down);
      window.removeEventListener("online", up);
      window.removeEventListener(NET_EVENT, onNet);
    };
  }, []);
  const visible = state !== "ok" && !pathname.startsWith("/pantalla");
  const bar = useRef<HTMLDivElement>(null);
  // Mientras se ve, la pantalla se corre hacia abajo lo que mide el aviso (body y los encabezados fijos usan --offline-h)
  useEffect(() => {
    const el = bar.current;
    const root = document.documentElement;
    if (!visible || !el) {
      root.style.removeProperty("--offline-h");
      return;
    }
    const fit = () => root.style.setProperty("--offline-h", `${el.offsetHeight}px`);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--offline-h");
    };
  }, [visible]);
  if (!visible) return null;
  const text = pathname.startsWith("/m/")
    ? "Sin conexión. Tu pedido no se envía hasta que vuelva el internet."
    : pathname === "/" || pathname.startsWith("/r/")
      ? "Sin conexión a internet. La página se pone al día sola cuando vuelva."
      : "Sin conexión. Nada se guarda hasta que vuelva; esta pantalla se pone al día sola.";
  return (
    <div
      ref={bar}
      role={state === "off" ? "alert" : "status"}
      className={`no-print fixed inset-x-0 top-0 z-[90] flex items-center justify-center gap-2 px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 text-center text-[15px] font-semibold text-white shadow-lg ${state === "off" ? "bg-cereza" : "toast-in bg-puerta"}`}
    >
      {state === "off" ? <WifiOff size={18} className="shrink-0" aria-hidden /> : <Wifi size={18} className="shrink-0" aria-hidden />}
      <span>{state === "off" ? text : "Volvió la conexión"}</span>
    </div>
  );
}

/**
 * Lo que muestra una pantalla que falló porque se cayó la conexión (por ejemplo, al mandar un pedido sin internet):
 * avisa que lo último puede no haberse guardado y vuelve a intentar sola cuando hay red.
 */
export function ConnectionLost({
  retry,
  text = "Puede que lo último que hiciste no se haya guardado. Cuando vuelva el internet, esta pantalla se recarga sola: revisa que esté todo.",
}: {
  retry: () => void;
  text?: string;
}) {
  useEffect(() => {
    let wait = 5000;
    let timer: ReturnType<typeof setTimeout>;
    const again = () => {
      if (navigator.onLine !== false) retry();
      wait = Math.min(30_000, wait * 2);
      timer = setTimeout(again, wait);
    };
    timer = setTimeout(again, wait);
    const online = () => retry();
    window.addEventListener("online", online);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", online);
    };
  }, [retry]);
  return (
    <>
      <span className="mx-auto grid size-14 place-items-center rounded-full bg-cereza-soft text-cereza">
        <WifiOff size={28} aria-hidden />
      </span>
      <h1 className="text-2xl font-bold">Se cayó la conexión</h1>
      <p className="text-humo">{text}</p>
    </>
  );
}
