import "server-only";
import { jornadaKey } from "../core/time";
import { connect, databaseUrl, isDemoMode, isEphemeralDb, type Db } from "../db-core";
import { seedActivity, seedBusiness } from "../seed";

export { isDemoMode, isEphemeralDb };
export type { Db, Tx } from "../db-core";

/** La demo en memoria se vuelve a sembrar si tiene más de 2 horas o cambió la jornada, y nadie la está usando. */
const DEMO_MAX_AGE = 2 * 3_600_000;
const DEMO_IDLE = 15 * 60_000;

declare global {
  var __dzdemo: { at: number; jornada: string; lastWrite: number; refreshing: Promise<void> | null } | undefined;
}

function demoState() {
  globalThis.__dzdemo ??= { at: Date.now(), jornada: jornadaKey(), lastWrite: 0, refreshing: null };
  return globalThis.__dzdemo;
}

async function seedAll(db: Pick<Db, "query" | "one">) {
  await seedBusiness(db);
  await seedActivity(db);
  const s = demoState();
  s.at = Date.now();
  s.jornada = jornadaKey();
}

async function bootstrap(db: Db) {
  const row = await db.one<{ n: number }>("select count(*)::int as n from businesses");
  if (!row?.n && isDemoMode()) await db.tx((tx) => seedAll(tx));
}

/** Cada escritura lo anota: la demo no se resiembra mientras alguien la usa. */
export function noteWrite() {
  if (isEphemeralDb()) demoState().lastWrite = Date.now();
}

async function freshen(db: Db) {
  const s = demoState();
  const stale = Date.now() - s.at > DEMO_MAX_AGE || jornadaKey() !== s.jornada;
  if (!stale || Date.now() - s.lastWrite < DEMO_IDLE) return;
  s.refreshing ??= (async () => {
    try {
      await reseed(db);
      console.info("[db] demo en memoria resembrada");
    } finally {
      s.refreshing = null;
    }
  })();
  await s.refreshing;
}

export async function getDb() {
  const db = await connect(bootstrap);
  if (isEphemeralDb()) await freshen(db);
  return db;
}

async function reseed(db: Db) {
  await db.tx(async (tx) => {
    await tx.query("truncate businesses restart identity cascade");
    await seedAll(tx);
  });
}

/** Reiniciar la demo solo tiene sentido con la base en memoria, o si se permite a propósito (ALLOW_DEMO_RESET=true). */
export function canResetDemo() {
  return isDemoMode() && (isEphemeralDb() || !databaseUrl() || process.env.ALLOW_DEMO_RESET === "true");
}

/** Borra todo y vuelve a cargar el ejemplo, en una sola transacción. */
export async function resetDemo() {
  if (!canResetDemo()) throw new Error("Reiniciar la demo no está permitido en esta instalación");
  const db = await getDb();
  await reseed(db);
}
