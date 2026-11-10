/**
 * Capa de datos: Postgres real en producción (Supabase u otro, vía DATABASE_URL)
 * y PGlite (Postgres en WebAssembly, guardado en disco) cuando no hay DATABASE_URL.
 * Las dos hablan el mismo SQL, así que el resto de la app no sabe cuál está usando.
 */
import { AsyncLocalStorage } from "node:async_hooks";
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

/**
 * Marca de "este flujo está dentro de db.tx". PGlite tiene una sola conexión: una consulta con la base de afuera
 * mientras la transacción sigue abierta espera a la transacción, que la espera a ella. No da error: se cuelga todo
 * (el pulso, la barra, todas las tablets). Con esta guardia el error sale al instante y dice qué hacer.
 * Va por contexto asíncrono y no con una bandera global: otra petición que consulta mientras alguien cobra no se ve afectada.
 */
const txScope = new AsyncLocalStorage<{ open: boolean }>();

function insideTx() {
  return txScope.getStore()?.open === true;
}

/**
 * Arma la base con la guardia puesta: dentro de db.tx solo se usa el tx que recibe la transacción.
 * Usar la base de afuera (getDb(), getBusiness(), loadMenu() y lo que los llame) o abrir otra transacción lanza un error claro.
 * Con Postgres real no se colgaría, pero leería por otra conexión sin ver lo que la transacción lleva escrito: mismo error.
 */
function guarded(kind: Db["kind"], raw: { query: Tx["query"]; exec(sql: string): Promise<void>; begin<T>(fn: (tx: Tx) => Promise<T>): Promise<T> }): Db {
  const outside = () => {
    if (insideTx()) throw new Error("Consulta con la base de afuera (getDb) dentro de db.tx: usa el tx de la transacción. Lo que necesite getDb() se carga antes de abrirla y se pasa.");
  };
  const query = async <T,>(sql: string, params?: unknown[]) => {
    outside();
    return raw.query<T>(sql, params);
  };
  return {
    kind,
    ...withOne(query),
    async exec(sql) {
      outside();
      await raw.exec(sql);
    },
    async tx(fn) {
      if (insideTx()) throw new Error("db.tx anidado: este flujo ya está dentro de db.tx. Usa el tx de esa transacción en vez de abrir otra.");
      // La marca se apaga al terminar: lo que quede corriendo después (sin esperar) ya no está "dentro"
      const scope = { open: true };
      try {
        return await raw.begin((tx) => txScope.run(scope, () => fn(tx)));
      } finally {
        scope.open = false;
      }
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
  // El certificado se verifica siempre (Neon sirve tal cual). Supabase usa su propia autoridad:
  // pon su certificado en PGSSL_CA, o PGSSL=no-verify si no hay cómo
  const ca = process.env.PGSSL_CA?.replace(/\\n/g, "\n");
  const pool = new pg.Pool({
    connectionString: parsed.toString(),
    max: Number(process.env.PG_POOL_MAX ?? 5),
    ssl: local ? undefined : { rejectUnauthorized: process.env.PGSSL !== "no-verify", ...(ca ? { ca } : {}) },
    idleTimeoutMillis: 10_000,
  });

  return guarded("pg", {
    query: async <T,>(sql: string, params?: unknown[]) => (await pool.query(sql, params as unknown[])).rows as T[],
    async exec(sql) {
      await pool.query(sql);
    },
    async begin(fn) {
      const client = await pool.connect();
      // Una consulta a la vez por conexión: lo que la transacción lanza en paralelo (un Promise.all, como en loadCheck)
      // hace fila aquí, en el mismo orden. pg las encolaba por dentro, pero eso ya avisa que se va en pg 9
      let last: Promise<unknown> = Promise.resolve();
      const send = (sql: string, params?: unknown[]) => {
        const run = last.then(() => client.query(sql, params as unknown[]));
        last = run.catch(() => {});
        return run;
      };
      try {
        await send("begin");
        const result = await fn(withOne(async <T,>(sql: string, params?: unknown[]) => (await send(sql, params)).rows as T[]));
        await send("commit");
        return result;
      } catch (error) {
        await send("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  });
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
  return guarded("pglite", {
    query: async <T,>(sql: string, params?: unknown[]) => (await db.query<T>(sql, params as unknown[])).rows,
    async exec(sql) {
      await db.exec(sql);
    },
    begin(fn) {
      return db.transaction((t) => fn(withOne(async <T,>(sql: string, params?: unknown[]) => (await t.query<T>(sql, params as unknown[])).rows)));
    },
  });
}

/**
 * Candado de arranque, solo con Postgres real: una copia a la vez migra o siembra; las demás esperan y encuentran el trabajo hecho.
 * Es de transacción: se suelta solo al terminarla. PGlite no lo necesita (una sola conexión, un solo proceso).
 */
export async function startupLock(db: Pick<Db, "kind">, tx: Pick<Tx, "query">) {
  if (db.kind === "pg") await tx.query("select pg_advisory_xact_lock(4242001)");
}

async function migrate(db: Db) {
  await db.tx(async (tx) => {
    // Con el candado puesto antes de crear nada: dos copias que arrancan a la vez contra una base vacía no chocan
    await startupLock(db, tx);
    await tx.query("create table if not exists schema_version (version int primary key, applied_at timestamptz not null default now())");
    const row = await tx.one<{ v: number | null }>("select max(version) as v from schema_version");
    const current = row?.v ?? 0;
    for (const m of MIGRATIONS) {
      if (m.version <= current) continue;
      for (const statement of splitSql(m.sql)) await tx.query(statement);
      if (m.run) await m.run(tx);
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
