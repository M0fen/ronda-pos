import { defineConfig } from "vitest/config";

/**
 * Cada archivo *.integration.test.ts levanta su propio Postgres en WebAssembly (PGlite) con la demo de las cuatro sedes
 * sembrada, y eso pesa en memoria. Vitest corre un proceso por archivo y, sin tope, tantos a la vez como núcleos tenga
 * el equipo: con seis o más archivos de integración al tiempo los procesos mueren con "Fatal process out of memory".
 * Con tres a la vez la suite tarda lo mismo y no se cae.
 */
export default defineConfig({
  test: {
    maxWorkers: 3,
  },
});
