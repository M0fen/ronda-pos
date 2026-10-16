/** Sesión del equipo (JWT firmado en una cookie). La usan proxy.ts y el servidor. */
import { createHash } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "ronda_session";
export const SESSION_HOURS = 14;

let cached: Uint8Array | null = null;

function secret() {
  if (cached) return cached;
  const fromEnv = process.env.SESSION_SECRET;
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  let material: string;
  if (fromEnv && fromEnv.length >= 16) material = fromEnv;
  else if (dbUrl) material = createHash("sha256").update(`ronda-session:${dbUrl}`).digest("hex");
  else material = "ronda-demo-solo-para-pruebas";
  cached = new TextEncoder().encode(material);
  return cached;
}

export interface SessionData {
  id: string;
  biz: string;
  role: string;
}

export async function createSessionToken(s: SessionData) {
  return new SignJWT({ biz: s.biz, role: s.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(s.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secret());
}

export async function verifySessionToken(token: string): Promise<SessionData | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return payload.sub ? { id: payload.sub, biz: String(payload.biz ?? ""), role: String(payload.role ?? "") } : null;
  } catch {
    return null;
  }
}
