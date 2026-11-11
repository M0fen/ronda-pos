import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Arranque contra una base vacía (PGlite en una carpeta temporal, migrada y sin sembrar): la migración v6 y la siembra
 * de la demo cuando dos copias arrancan a la vez. Con Postgres real las ordena el candado de arranque
 * (tests/postgres.integration.test.ts lo prueba de verdad); aquí se prueba que la segunda vuelve a mirar antes de sembrar.
 */

vi.mock("server-only", () => ({}));

type Db = import("../lib/db-core").Db;

const dir = mkdtempSync(path.join(tmpdir(), "ronda-arranque-"));
let db: Db;

beforeAll(async () => {
  process.env.PGLITE_DIR = dir;
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.VERCEL;
  // Sin siembra: solo las migraciones
  db = await (await import("../lib/db-core")).connect();
}, 180_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const count = async (table: string) => (await db.one<{ n: number }>(`select count(*)::int as n from ${table}`))!.n;

describe("arranque", () => {
  it("la migración v6 deja la llave de intento única por sede y las opciones sin precio negativo", async () => {
    expect((await db.one<{ v: number }>("select max(version) as v from schema_version"))!.v).toBeGreaterThanOrEqual(6);
    const index = await db.one<{ indexdef: string }>("select indexdef from pg_indexes where indexname = 'payments_attempt_key'");
    expect(index?.indexdef).toMatch(/UNIQUE INDEX payments_attempt_key ON .*payments .*\(business_id, attempt_key\) WHERE \(attempt_key IS NOT NULL\)/);
    expect(await db.one("select 1 from pg_constraint where conname = 'modifiers_price_check'")).toBeTruthy();
  });

  it("el candado de arranque solo se pide con Postgres real", async () => {
    const { startupLock } = await import("../lib/db-core");
    const asked: string[] = [];
    const tx = { query: async (sql: string) => (asked.push(sql), []) };
    await startupLock({ kind: "pglite" }, tx);
    expect(asked).toEqual([]);
    await startupLock({ kind: "pg" }, tx);
    expect(asked).toEqual(["select pg_advisory_xact_lock(4242001)"]);
  });

  it("dos copias que arrancan a la vez contra una base vacía siembran la demo una sola vez", async () => {
    const { seedIfEmpty } = await import("../lib/server/db");
    expect(await count("businesses")).toBe(0);
    // Las dos ven la base vacía antes de que alguna siembre; la segunda vuelve a mirar dentro de su transacción
    await Promise.all([seedIfEmpty(db), seedIfEmpty(db)]);
    expect(await count("businesses")).toBe(4);
    const staff = await count("staff");
    // Y un arranque posterior no toca nada
    await seedIfEmpty(db);
    expect(await count("businesses")).toBe(4);
    expect(await count("staff")).toBe(staff);
  }, 180_000);
});
