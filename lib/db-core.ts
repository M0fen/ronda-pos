/**
 * Capa de datos: Postgres real en producción (Supabase u otro, vía DATABASE_URL)
 * y PGlite (Postgres en WebAssembly, guardado en disco) cuando no hay DATABASE_URL.
 * Las dos hablan el mismo SQL, así que el resto de la app no sabe cuál está usando.
 */
import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { rootCertificates } from "node:tls";
import { MIGRATIONS } from "./schema";
import { SUPABASE_ROOT_CA } from "./supabase-ca";

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
 * Lo que está mal en una cadena de conexión, en palabras de quien la configura. `error`: así no conecta;
 * `aviso`: conecta, pero hay una opción mejor. Lo usan la app al arrancar y `npm run db:check`.
 */
export function connectionProblems(url: string): { level: "error" | "aviso"; text: string }[] {
  if (/\[?YOUR-PASSWORD\]?/i.test(url)) return [{ level: "error", text: "La cadena todavía dice [YOUR-PASSWORD]: cámbialo por la contraseña de la base (sin los corchetes)." }];
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [{ level: "error", text: "La cadena no es válida. Si la contraseña tiene símbolos (@ # / ? : %), cámbiala en Supabase por una de solo letras y números." }];
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) return [{ level: "error", text: "La cadena debe empezar por postgresql://" }];
  const out: { level: "error" | "aviso"; text: string }[] = [];
  if (/^db\.[a-z0-9]+\.supabase\.co$/i.test(parsed.hostname) && (parsed.port || "5432") === "5432") {
    out.push({ level: "aviso", text: "Esa es la conexión directa de Supabase (solo IPv6, salvo con el complemento IPv4): Vercel no llega a ella. Usa la de Transaction pooler (…pooler.supabase.com:6543)." });
  }
  if (/\.pooler\.supabase\.com$/i.test(parsed.hostname) && parsed.port === "5432") {
    out.push({ level: "aviso", text: "Es el pooler en modo sesión: funciona, pero en Vercel conviene el modo transacción (puerto 6543)." });
  }
  if (/\.pooler\.supabase\.com$/i.test(parsed.hostname) && !decodeURIComponent(parsed.username).includes(".") && !parsed.searchParams.get("options")?.includes("reference")) {
    out.push({ level: "aviso", text: "En el pooler el usuario lleva el código del proyecto (postgres.xxxxxxxx). Copia la cadena completa desde Connect." });
  }
  return out;
}

/** Supabase firma la conexión con su propia autoridad: se confía en ella además de las públicas. */
function isSupabase(hostname: string) {
  return /(^|\.)supabase\.(co|com)$/i.test(hostname);
}

async function createPg(url: string): Promise<Db> {
  const blocking = connectionProblems(url).find((p) => p.level === "error");
  if (blocking) throw new Error(`DATABASE_URL: ${blocking.text}`);
  const pg = (await import("pg")).default;
  pg.types.setTypeParser(INT8, (v: string) => parseInt(v, 10));
  pg.types.setTypeParser(NUMERIC, (v: string) => parseFloat(v));
  pg.types.setTypeParser(DATE, (v: string) => v);

  const parsed = new URL(url);
  // pg maneja SSL con la opción de abajo; estos parámetros de Supabase/Neon no los entiende
  parsed.searchParams.delete("sslmode");
  parsed.searchParams.delete("channel_binding");
  const local = ["localhost", "127.0.0.1"].includes(parsed.hostname) || process.env.PGSSL === "disable";
  // El certificado se verifica siempre. Neon usa autoridades públicas; Supabase, la suya (incluida en
  // lib/supabase-ca.ts). Otro proveedor con certificado propio: PGSSL_CA, o PGSSL=no-verify si no hay cómo
  const ca = process.env.PGSSL_CA?.replace(/\\n/g, "\n") ?? (isSupabase(parsed.hostname) ? [...rootCertificates, SUPABASE_ROOT_CA] : undefined);
  const pool = new pg.Pool({
    connectionString: parsed.toString(),
    max: Number(process.env.PG_POOL_MAX ?? 5),
    ssl: local ? undefined : { rejectUnauthorized: process.env.PGSSL !== "no-verify", ...(ca ? { ca } : {}) },
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
      if (m.run) await m.run(tx);
      await tx.query("insert into schema_version (version) values ($1)", [m.version]);
    }
    if (db.kind === "pg") await closeDataApi(tx);
  });
}

/**
 * Supabase publica por su API de datos (PostgREST) las tablas del esquema public. Ronda no usa esa API: con la
 * seguridad por filas activa y sin políticas, desde allá no se ve ni se cambia nada. La app entra como dueña de
 * las tablas, así que a ella no le aplica. Corre en cada arranque y solo toca las tablas que aún no la tienen.
 */
async function closeDataApi(tx: Tx) {
  const open = await tx.query<{ name: string }>(
    `select quote_ident(c.relname) as name
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = current_schema() and c.relkind in ('r', 'p') and not c.relrowsecurity
        and c.relowner = (select oid from pg_roles where rolname = current_user)`,
  );
  for (const t of open) await tx.query(`alter table ${t.name} enable row level security`);
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
