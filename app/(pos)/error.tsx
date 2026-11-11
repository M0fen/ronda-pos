"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ConnectionLost, isConnectionError } from "@/components/offline-notice";
import { btn } from "@/components/ui";

/** Dentro del sistema del equipo: el menú de arriba sigue a mano y hay salida al salón. */
export default function PosError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => console.error(error), [error]);
  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;
  if (isConnectionError(error))
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4 py-16 text-center">
        <ConnectionLost retry={retry} />
        <button className={btn("primary", "lg")} onClick={() => retry()}>
          Intentar de nuevo
        </button>
      </div>
    );
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 py-16 text-center">
      <h1 className="text-2xl font-bold">Esta pantalla no cargó</h1>
      <p className="text-humo">Lo que ya estaba guardado sigue guardado. Intenta de nuevo o vuelve al salón.</p>
      <button className={btn("primary", "lg")} onClick={() => retry()}>
        Intentar de nuevo
      </button>
      <Link href="/salon" className={btn("soft", "lg")}>
        Volver al salón
      </Link>
      {digest ? <p className="text-xs text-humo">Si sigue pasando, comparte este código con soporte: {digest}</p> : null}
    </div>
  );
}
