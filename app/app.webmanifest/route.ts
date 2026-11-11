import type { MetadataRoute } from "next";
import type { NextRequest } from "next/server";

/**
 * Manifiesto para instalar el sistema en la tablet o el celular ("Agregar a la pantalla de inicio"): abre en pantalla
 * completa, sin la barra del navegador, en /entrar. No toca la base de datos: el layout raíz pasa la marca del local
 * en la dirección (nombre, iniciales y colores); sin ella es Ronda.
 */
export function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const name =
    (q.get("n") ?? "")
      .replace(/[\u0000-\u001f<>]/g, "")
      .trim()
      .slice(0, 40) || "Ronda";
  const brand: Record<string, string> = {};
  for (const k of ["i", "bg", "fg"]) {
    const v = q.get(k);
    if (v) brand[k] = v.slice(0, 8);
  }
  const icon = (s: number, full = false) => `/app-icon?${new URLSearchParams({ s: String(s), ...(full ? { v: "full" } : {}), ...brand })}`;
  const manifest: MetadataRoute.Manifest = {
    id: "/",
    name,
    short_name: name,
    description: name === "Ronda" ? "Mesas, barra y cocina, caja y factura en la tablet." : `El sistema de ${name}: pedidos, cocina y caja.`,
    lang: "es-CO",
    dir: "ltr",
    start_url: "/entrar",
    scope: "/",
    display: "standalone",
    background_color: "#f4f5f1",
    theme_color: "#f4f5f1",
    icons: [
      { src: icon(192), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: icon(512), sizes: "512x512", type: "image/png", purpose: "any" },
      { src: icon(512, true), sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
