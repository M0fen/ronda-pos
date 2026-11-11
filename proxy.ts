import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./lib/session";

const PRIVATE = ["/salon", "/cuenta", "/barra", "/caja", "/panel", "/recibo", "/domicilios", "/comanda"];

/**
 * Sin sesión, las pantallas del equipo llevan a /entrar. Cada página y acción vuelve a verificar en el servidor.
 * Las Server Actions pasan siempre: si la sesión se venció, la acción misma responde y la pantalla lleva a /entrar.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (request.method === "POST" && request.headers.has("next-action")) return NextResponse.next();
  if (PRIVATE.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    const session = token ? await verifySessionToken(token) : null;
    if (!session) {
      const url = request.nextUrl.clone();
      url.pathname = "/entrar";
      url.search = token ? "?sesion=1" : "";
      return NextResponse.redirect(url);
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico|icon.svg|menu/|shots/|app-icon|app.webmanifest|sw.js).*)"],
};
