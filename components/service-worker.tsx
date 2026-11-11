"use client";

import { useEffect } from "react";

/** Registra public/sw.js: si la app se abre o se recarga sin internet, muestra "Sin conexión" y vuelve sola. Solo en producción. */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);
  return null;
}
