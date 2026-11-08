/** Sesión del equipo (JWT firmado en una cookie). La usan proxy.ts y el servidor. */
import { createHash } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "ronda_session";
export const SESSION_HOURS = 14;

let cached: Uint8Array | null = null;

/**
 * Secreto de firma. Con una base real en producción es obligatorio (SESSION_SECRET): sin él la app no arranca.
 * La demo sin base usa uno derivado del despliegue para seguir funcionando, y el panel avisa que falta.
 */
function secret() {
  if (cached) return cached;
  const fromEnv = process.env.SESSION_SECRET;
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  const demo = !dbUrl || process.env.DEMO_MODE === "true";
  let material: string;
  if (fromEnv && fromEnv.length >= 16) material = fromEnv;
  else if (process.env.NODE_ENV === "production" && !demo) throw new Error("Falta SESSION_SECRET (32 caracteres o más al azar) en las variables de entorno");
  else if (dbUrl) material = createHash("sha256").update(`ronda-session:${dbUrl}`).digest("hex");
  else material = createHash("sha256").update(`ronda-demo:${process.env.VERCEL_PROJECT_ID ?? ""}:${process.env.VERCEL_GIT_REPO_ID ?? ""}`).digest("hex");
  cached = new TextEncoder().encode(material);
  return cached;
}

/** La demo publicada sin SESSION_SECRET: el panel lo avisa. */
export function missingSessionSecret() {
  return process.env.NODE_ENV === "production" && !(process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16);
}

export interface SessionData {
  id: string;
  biz: string;
  role: string;
  /** Sesión guardada en la base: se puede cerrar desde el servidor */
  sid: string;
  iat?: number;
}

export async function createSessionToken(s: SessionData) {
  return new SignJWT({ biz: s.biz, role: s.role, sid: s.sid })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(s.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secret());
}

export async function verifySessionToken(token: string): Promise<SessionData | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.sid !== "string") return null;
    return { id: payload.sub, biz: String(payload.biz ?? ""), role: String(payload.role ?? ""), sid: payload.sid, iat: payload.iat };
  } catch {
    return null;
  }
}
