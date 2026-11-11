import "server-only";
import { demoShouldReseed } from "../core/demo";
import { jornadaKey } from "../core/time";
import { connect, databaseUrl, isDemoMode, isEphemeralDb, startupLock, type Db } from "../db-core";
import { seedActivity, seedBusiness } from "../seed";

export { isDemoMode, isEphemeralDb };
export type { Db, Tx } from "../db-core";

/** La demo en memoria se vuelve a sembrar si ya está vieja y nadie la está usando: la regla, con sus tiempos, está en lib/core/demo.ts. */
declare global {
  var __dzdemo: { at: number; jornada: string; lastWrite: number; lastSeen: number; refreshing: Promise<void> | null } | undefined;
}

function demoState() {
  globalThis.__dzdemo ??= { at: Date.now(), jornada: jornadaKey(), lastWrite: 0, lastSeen: 0, refreshing: null };
  return globalThis.__dzdemo;
}

async function seedAll(db: Pick<Db, "query" | "one">) {
  await seedBusiness(db);
  await seedActivity(db);
  const s = demoState();
  s.at = Date.now();
  s.jornada = jornadaKey();
}

/** Al arrancar: si la base está vacía y es la demo, siembra el ejemplo. */
export async function seedIfEmpty(db: Db) {
  const row = await db.one<{ n: number }>("select count(*)::int as n from businesses");
  if (row?.n || !isDemoMode()) return;
  await db.tx(async (tx) => {
    // Con Postgres real, dos copias que arrancan a la vez contra una base vacía no siembran las dos: la segunda espera
    // el candado (el mismo de las migraciones), vuelve a mirar y ya encuentra los datos
    await startupLock(db, tx);
    const again = await tx.one<{ n: number }>("select count(*)::int as n from businesses");
    if (!again?.n) await seedAll(tx);
  });
}

/** Cada escritura lo anota: la demo no se resiembra mientras alguien la usa. */
export function noteWrite() {
  if (isEphemeralDb()) demoState().lastWrite = Date.now();
}

/** El pulso de una pantalla del equipo (con sesión válida) también cuenta como uso: la demo no se resiembra a mitad de una presentación. */
export function noteScreen() {
  if (isEphemeralDb()) demoState().lastSeen = Date.now();
}

async function freshen(db: Db) {
  const s = demoState();
  if (!demoShouldReseed(s, Date.now(), jornadaKey())) return;
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
  const db = await connect(seedIfEmpty);
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
