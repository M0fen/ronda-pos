import { defineConfig } from "vitest/config";

/**
 * Cada archivo *.integration.test.ts levanta su propio Postgres en WebAssembly (PGlite) con la demo de las cuatro sedes
 * sembrada, y eso pesa en memoria (cerca de 1 GB por proceso). Vitest corre un proceso por archivo y, sin tope, tantos a
 * la vez como núcleos tenga el equipo: con varios archivos de integración al tiempo y poca memoria libre, los procesos
 * mueren con "Fatal process out of memory". Con dos a la vez la suite tarda unos segundos más y no se cae.
 */
export default defineConfig({
  test: {
    maxWorkers: 2,
  },
});
