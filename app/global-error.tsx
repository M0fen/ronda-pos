"use client";

import { useEffect } from "react";

/** Si falla hasta el marco de la página: sin estilos del sistema, por eso va con estilos propios. */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <html lang="es-CO">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f6f1e8", color: "#2a1b17" }}>
        <title>Algo salió mal</title>
        <main style={{ maxWidth: 420, margin: "0 auto", minHeight: "100dvh", display: "flex", flexDirection: "column", justifyContent: "center", gap: 16, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 26, margin: 0 }}>Algo salió mal</h1>
          <p style={{ margin: 0, color: "#6b5d55" }}>Lo que ya estaba guardado sigue guardado. Intenta de nuevo; si vuelve a pasar, avísale a quien esté a cargo.</p>
          <button onClick={() => retry()} style={{ minHeight: 52, borderRadius: 16, border: 0, background: "#2a1b17", color: "#fff", fontSize: 17, fontWeight: 600 }}>
            Intentar de nuevo
          </button>
        </main>
      </body>
    </html>
  );
}
