"use client";

import { useEffect } from "react";

/** La pantalla del mostrador no tiene quién la toque: si algo falla, se vuelve a intentar sola cada 10 s. */
export default function TurnosError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
    const t = setInterval(() => retry(), 10_000);
    return () => clearInterval(t);
  }, [error, retry]);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-balcon p-10 text-center text-white">
      <p className="text-[clamp(1.75rem,3vw,3rem)] font-extrabold">Volvemos en un momento</p>
      <p className="text-xl text-white/60">La pantalla se está reconectando sola.</p>
    </main>
  );
}
