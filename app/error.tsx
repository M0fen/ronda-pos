"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ConnectionLost, isConnectionError } from "@/components/offline-notice";
import { btn } from "@/components/ui";

/** Cualquier pantalla que falle muestra esto en lugar del error en inglés de Next. */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => console.error(error), [error]);
  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;
  if (isConnectionError(error))
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6 text-center">
        <ConnectionLost retry={retry} />
        <button className={btn("primary", "lg")} onClick={() => retry()}>
          Intentar de nuevo
        </button>
      </main>
    );
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-bold">Algo salió mal</h1>
      <p className="text-humo">Lo que ya estaba guardado sigue guardado. Intenta de nuevo; si vuelve a pasar, avísale a quien esté a cargo.</p>
      <button className={btn("primary", "lg")} onClick={() => retry()}>
        Intentar de nuevo
      </button>
      <Link href="/" className={btn("ghost", "md")}>
        Ir al inicio
      </Link>
      {digest ? <p className="text-xs text-humo">Código del error: {digest}</p> : null}
    </main>
  );
}
