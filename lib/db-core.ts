/**
 * Capa de datos: Postgres real en producción (Supabase u otro, vía DATABASE_URL)
 * y PGlite (Postgres en WebAssembly, guardado en disco) cuando no hay DATABASE_URL.
 * Las dos hablan el mismo SQL, así que el resto de la app no sabe cuál está usando.
 */
import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { MIGRATIONS } from "./schema";

export type Row = Record<string, unknown>;

export interface Tx {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Row>(sql: string, params?: unknown[]): Promise<T | null>;
}

export interface Db extends Tx {
  kind: "pg" | "pglite";
  exec(sql: string): Promise<void>;
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

const INT8 = 20;
const NUMERIC = 1700;
const DATE = 1082;

/** Cadena de conexión: DATABASE_URL, o POSTGRES_URL (la que ponen las integraciones de Vercel con Neon o Supabase). */
export function databaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || undefined;
}

/** Modo demo: sin base de datos propia, o forzado con DEMO_MODE=true (datos de ejemplo y pagos simulados). */
export function isDemoMode() {
  return !databaseUrl() || process.env.DEMO_MODE === "true";
}

/**
 * Base en memoria (demo en Vercel sin base de datos). Ojo: en Vercel las páginas y las rutas /api
 * corren en funciones distintas y cada una tendría su propia copia, así que lo que deba verse
 * en la tienda o el panel se guarda y se lee desde páginas y Server Actions, no desde /api.
 */
export function isEphemeralDb() {
  return !databaseUrl() && !process.env.PGLITE_DIR && !!process.env.VERCEL;
}

function withOne(query: Tx["query"]): Tx {
  return {
    query,
    async one<T = Row>(sql: string, params?: unknown[]) {
      const rows = await query<T>(sql, params);
      return rows[0] ?? null;
    },
  };
}

async function createPg(url: string): Promise<Db> {
  const pg = (await import("pg")).default;
  pg.types.setTypeParser(INT8, (v: string) => parseInt(v, 10));
  pg.types.setTypeParser(NUMERIC, (v: string) => parseFloat(v));
  pg.types.setTypeParser(DATE, (v: string) => v);

  const parsed = new URL(url);
  // pg maneja SSL con la opción de abajo; estos parámetros de Supabase/Neon no los entiende
  parsed.searchParams.delete("sslmode");
  parsed.searchParams.delete("channel_binding");
  const local = ["localhost", "127.0.0.1"].includes(parsed.hostname) || process.env.PGSSL === "disable";
  const pool = new pg.Pool({
    connectionString: parsed.toString(),
    max: Number(process.env.PG_POOL_MAX ?? 5),
    ssl: local ? undefined : { rejectUnauthorized: false },
    idleTimeoutMillis: 10_000,
  });

  const query = async <T,>(sql: string, params?: unknown[]) => (await pool.query(sql, params as unknown[])).rows as T[];
  return {
    kind: "pg",
    ...withOne(query),
    async exec(sql) {
      await pool.query(sql);
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await fn(withOne(async <T,>(sql: string, params?: unknown[]) => (await client.query(sql, params as unknown[])).rows as T[]));
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

/** Base ya migrada que se genera en el build (scripts/demo-snapshot.ts): la demo en memoria arranca en ~3 s en vez de ~6 s. */
export const DEMO_SNAPSHOT = "lib/generated/demo-schema.tar.gz";

const PGLITE_PARSERS = {
  [INT8]: (v: string) => parseInt(v, 10),
  [NUMERIC]: (v: string) => parseFloat(v),
  [DATE]: (v: string) => v,
};

async function readSnapshot() {
  try {
    return new Blob([new Uint8Array(await readFile(/*turbopackIgnore: true*/ path.join(process.cwd(), DEMO_SNAPSHOT)))]);
  } catch {
    return undefined;
  }
}

async function createPglite(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  // En Vercel (sin DATABASE_URL) la demo vive en memoria: cada instancia arranca con datos de ejemplo frescos
  const dir = process.env.PGLITE_DIR ?? (process.env.VERCEL ? undefined : path.join(process.cwd(), ".data", "db"));
  if (dir) {
    await mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });
    return wrapPglite(await PGlite.create(dir, { parsers: PGLITE_PARSERS }));
  }
  const snapshot = await readSnapshot();
  if (snapshot) {
    try {
      return wrapPglite(await PGlite.create("memory://", { loadDataDir: snapshot, parsers: PGLITE_PARSERS }));
    } catch (error) {
      console.warn("[db] No se pudo cargar la base precreada; se crea desde cero", error);
    }
  }
  return wrapPglite(await PGlite.create("memory://", { parsers: PGLITE_PARSERS }));
}

/** Genera la base migrada (vacía) que usa la demo en memoria. La llama scripts/demo-snapshot.ts en el build. */
export async function createSchemaSnapshot() {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = await PGlite.create("memory://", { parsers: PGLITE_PARSERS });
  await migrate(wrapPglite(pg));
  const blob = await pg.dumpDataDir("gzip");
  await pg.close();
  return blob;
}

function wrapPglite(db: import("@electric-sql/pglite").PGlite): Db {
  const query = async <T,>(sql: string, params?: unknown[]) => (await db.query<T>(sql, params as unknown[])).rows;
  return {
    kind: "pglite",
    ...withOne(query),
    async exec(sql) {
      await db.exec(sql);
    },
    async tx(fn) {
      return db.transaction((t) => fn(withOne(async <T,>(sql: string, params?: unknown[]) => (await t.query<T>(sql, params as unknown[])).rows)));
    },
  };
}

async function migrate(db: Db) {
  await db.exec("create table if not exists schema_version (version int primary key, applied_at timestamptz not null default now())");
  await db.tx(async (tx) => {
    // En Postgres real, evita que dos instancias migren al mismo tiempo
    if (db.kind === "pg") await tx.query("select pg_advisory_xact_lock(4242001)");
    const row = await tx.one<{ v: number | null }>("select max(version) as v from schema_version");
    const current = row?.v ?? 0;
    for (const m of MIGRATIONS) {
      if (m.version <= current) continue;
      for (const statement of splitSql(m.sql)) await tx.query(statement);
      await tx.query("insert into schema_version (version) values ($1)", [m.version]);
    }
  });
}

/** Divide un script en sentencias (los scripts de migración no usan funciones con $$). */
function splitSql(sql: string) {
  return sql
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

type Bootstrap = (db: Db) => Promise<void>;

declare global {
  var __dzdb: Promise<Db> | undefined;
}

export function connect(bootstrap?: Bootstrap): Promise<Db> {
  if (!globalThis.__dzdb) {
    globalThis.__dzdb = (async () => {
      const started = Date.now();
      const url = databaseUrl();
      const db = url ? await createPg(url) : await createPglite();
      await migrate(db);
      if (bootstrap) await bootstrap(db);
      if (isEphemeralDb()) console.info(`[db] demo en memoria lista en ${Date.now() - started} ms`);
      return db;
    })().catch((error) => {
      globalThis.__dzdb = undefined;
      throw error;
    });
  }
  return globalThis.__dzdb;
}
