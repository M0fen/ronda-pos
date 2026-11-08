"use client";

import { useEffect } from "react";
import { btn } from "@/components/ui";

/** La carta del cliente: nada técnico, solo volver a intentar o llamar al mesero. */
export default function MenuError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-bold">No pudimos cargar la carta</h1>
      <p className="text-humo">Revisa tu conexión e intenta de nuevo. Si no carga, llama al mesero y con gusto te atiende.</p>
      <button className={btn("primary", "lg")} onClick={() => retry()}>
        Intentar de nuevo
      </button>
    </main>
  );
}
