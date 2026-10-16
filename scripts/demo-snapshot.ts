/**
 * Genera en el build la base de la demo ya migrada (lib/generated/demo-schema.tar.gz).
 * Con ella la demo en memoria (Vercel sin DATABASE_URL) arranca en ~3 s en vez de ~6 s.
 * Si algo falla no detiene el build: la app crea la base desde cero como antes.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSchemaSnapshot, databaseUrl, DEMO_SNAPSHOT } from "../lib/db-core";

async function main() {
  if (databaseUrl()) {
    console.log("demo-snapshot: hay base de datos conectada, no hace falta.");
    return;
  }
  const started = Date.now();
  const blob = await createSchemaSnapshot();
  const out = path.join(process.cwd(), DEMO_SNAPSHOT);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, new Uint8Array(await blob.arrayBuffer()));
  console.log(`demo-snapshot: ${DEMO_SNAPSHOT} (${(blob.size / 1024 / 1024).toFixed(1)} MB) en ${Date.now() - started} ms`);
}

main()
  .catch((error) => console.warn("demo-snapshot: no se pudo generar; la demo arrancará más lento.", error))
  .finally(() => process.exit(0));
