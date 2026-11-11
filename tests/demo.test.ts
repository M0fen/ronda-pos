import { describe, expect, it } from "vitest";
import { DEMO_IDLE, DEMO_MAX_AGE, DEMO_SCREEN_HOLD, DEMO_SCREEN_IDLE, demoShouldReseed } from "../lib/core/demo";

/** Cuándo se vuelve a sembrar la demo en memoria: vieja y sin nadie usándola. Una pantalla del equipo abierta cuenta como uso. */
const MIN = 60_000;
const now = Date.parse("2026-11-10T22:00:00-05:00");
const jornada = "2026-11-10";
/** Sembrada hace 3 horas (ya está vieja), en la misma jornada */
const old = { at: now - 3 * 3_600_000, jornada };

describe("demo en memoria", () => {
  it("recién sembrada no se toca, aunque nadie la use", () => {
    expect(demoShouldReseed({ at: now - 30 * MIN, jornada, lastWrite: 0, lastSeen: 0 }, now, jornada)).toBe(false);
    expect(demoShouldReseed({ at: now - DEMO_MAX_AGE + MIN, jornada, lastWrite: 0, lastSeen: 0 }, now, jornada)).toBe(false);
  });

  it("vieja y sin nadie: se vuelve a sembrar (también si cambió la jornada)", () => {
    expect(demoShouldReseed({ ...old, lastWrite: 0, lastSeen: 0 }, now, jornada)).toBe(true);
    expect(demoShouldReseed({ at: now - 10 * MIN, jornada: "2026-11-09", lastWrite: 0, lastSeen: 0 }, now, jornada)).toBe(true);
  });

  it("con una escritura reciente no se resiembra", () => {
    expect(demoShouldReseed({ ...old, lastWrite: now - 5 * MIN, lastSeen: 0 }, now, jornada)).toBe(false);
    expect(demoShouldReseed({ ...old, lastWrite: now - DEMO_IDLE - MIN, lastSeen: 0 }, now, jornada)).toBe(true);
  });

  it("una pantalla del equipo abierta cuenta como uso: la mesa de la presentación no desaparece mientras se habla", () => {
    // Abrió la mesa hace 40 minutos y desde entonces solo hay pulsos de la pantalla (el último, hace 10 segundos)
    expect(demoShouldReseed({ ...old, lastWrite: now - 40 * MIN, lastSeen: now - 10_000 }, now, jornada)).toBe(false);
    // La tablet se durmió hace media hora: todavía cuenta
    expect(demoShouldReseed({ ...old, lastWrite: now - 40 * MIN, lastSeen: now - 30 * MIN }, now, jornada)).toBe(false);
    // Pasado ese margen sin pantallas ni escrituras, ya no hay nadie
    expect(demoShouldReseed({ ...old, lastWrite: now - 2 * 3_600_000, lastSeen: now - DEMO_SCREEN_IDLE - MIN }, now, jornada)).toBe(true);
  });

  it("una pestaña olvidada no deja la demo con datos viejos para siempre", () => {
    // Pulsos al día, pero nadie escribe nada hace más de 3 horas
    expect(demoShouldReseed({ at: now - 6 * 3_600_000, jornada, lastWrite: now - DEMO_SCREEN_HOLD - MIN, lastSeen: now - 5_000 }, now, jornada)).toBe(true);
    // Y una pantalla abierta sin ninguna escritura desde la siembra no detiene nada: no hay nada que perder
    expect(demoShouldReseed({ ...old, lastWrite: 0, lastSeen: now - 5_000 }, now, jornada)).toBe(true);
  });
});
