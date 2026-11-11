import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

/**
 * Íconos PNG para instalar el sistema en la tablet: 192 y 512 para Android (con `v=full` el fondo llega al borde,
 * para el ícono "maskable") y 180 para el iPad. No toca la base de datos: la marca llega en la dirección (iniciales y
 * colores del local, o el anillo de Ronda si no vienen), así responde igual en la demo y en un local real.
 * La letra es Archivo ExtraBold (licencia OFL, en OFL.txt).
 */
const SIZES = [180, 192, 512];
const HEX = /^[0-9a-f]{6}$/i;
let archivo: Promise<Buffer> | undefined;

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const size = SIZES.includes(Number(q.get("s"))) ? Number(q.get("s")) : 192;
  const full = q.get("v") === "full";
  const initials = (q.get("i") ?? "").replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toUpperCase();
  const color = (key: string, fallback: string) => {
    const v = q.get(key) ?? "";
    return HEX.test(v) ? `#${v}` : fallback;
  };
  const bg = color("bg", "#24150F");
  const fg = color("fg", "#F4B400");
  // Medidas en la grilla de 64 del ícono SVG
  const u = size / 64;
  const circle = (d: number, background: string, child?: React.ReactNode) => (
    <div style={{ width: d * u, height: d * u, borderRadius: "50%", background, display: "flex", alignItems: "center", justifyContent: "center" }}>{child}</div>
  );
  const mark = initials ? (
    <span style={{ fontFamily: "Archivo", fontWeight: 800, fontSize: 28 * u, lineHeight: 1, color: fg, paddingTop: 1.5 * u, letterSpacing: -0.4 * u }}>{initials}</span>
  ) : (
    // El anillo de Ronda: círculo amarillo, el hueco del color de fondo y el punto claro en el centro
    circle(41, fg, circle(27, bg, circle(10, "#F4F5F1")))
  );
  if (initials) archivo ??= readFile(join(process.cwd(), "app/app-icon/archivo-800.woff"));
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: bg, borderRadius: full ? 0 : 16 * u }}>{mark}</div>,
    {
      width: size,
      height: size,
      fonts: initials ? [{ name: "Archivo", data: await archivo!, weight: 800, style: "normal" }] : undefined,
      headers: { "cache-control": "public, max-age=31536000, immutable" },
    },
  );
}
