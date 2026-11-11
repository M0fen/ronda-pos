import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * La portada de la demo responde la marca sembrada sin esperar la base mientras arranca. Eso solo es correcto si esa
 * marca es exactamente la que la base va a devolver: aquí se comparan las dos contra la demo sembrada.
 */
const { jar, after } = vi.hoisted(() => ({ jar: new Map<string, string>(), after: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined),
    set: (k: string, v: string) => void jar.set(k, v),
    delete: (k: string) => void jar.delete(k),
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("next/server", () => ({ after }));

const dir = mkdtempSync(path.join(tmpdir(), "ronda-brand-"));
let biz: typeof import("../lib/server/business");
let core: typeof import("../lib/db-core");
let server: typeof import("../lib/server/db");

beforeAll(async () => {
  process.env.PGLITE_DIR = dir;
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.VERCEL;
  core = await import("../lib/db-core");
  server = await import("../lib/server/db");
  biz = await import("../lib/server/business");
}, 180_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("marca de la portada", () => {
  it("la base avisa cuándo ya arrancó", async () => {
    expect(core.dbReady()).toBe(false);
    await server.getDb();
    expect(core.dbReady()).toBe(true);
  }, 180_000);

  it("la marca sembrada es la misma que devuelve la base en cada sede de la demo", async () => {
    const db = await server.getDb();
    const sedes = await db.query<{ id: string }>("select id from businesses order by created_at");
    expect(sedes.length).toBe(4);
    for (const s of sedes) {
      const b = await biz.getBusiness(s.id);
      expect(biz.brandOf(b.name, b.settings.theme)).toEqual(biz.demoBrand());
    }
    expect(biz.demoBrand()).toMatchObject({ name: "Sr. Patata", whiteLabel: true });
  }, 60_000);

  it("con la marca apagada o un color inválido sale Ronda", () => {
    const ronda = biz.brandOf("Mi local", { primary: "#171310", accent: "#FFC20E", whiteLabel: false });
    expect(ronda).toMatchObject({ name: "Ronda", whiteLabel: false });
    expect(biz.brandOf("Mi local", { primary: "rojo", accent: "#FFC20E", whiteLabel: true })).toEqual(ronda);
    expect(biz.brandOf("Mi local", { primary: "#000000", accent: "#FFFFFF", whiteLabel: true })).toEqual({ name: "Mi local", whiteLabel: true, primary: "#000000", accent: "#FFFFFF" });
  });

  it("fuera de la demo en memoria la marca sale de la base y no queda nada para después", async () => {
    after.mockClear();
    expect(await biz.getBrand()).toEqual(biz.demoBrand());
    expect(after).not.toHaveBeenCalled();
  }, 60_000);
});
