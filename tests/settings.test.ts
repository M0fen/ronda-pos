import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, kdsThresholds, mergeSettings } from "../lib/settings";

describe("ajustes de barra y cocina y motivos", () => {
  it("lo guardado antes de existir estas capas toma los valores por defecto", () => {
    const s = mergeSettings({ business: { name: "Sr. Patata" } });
    expect(s.kds).toEqual(DEFAULT_SETTINGS.kds);
    expect(s.reasons.void.length).toBeGreaterThan(0);
    expect(s.reasons.notes).toContain("Sin cebolla");
  });

  it("el rojo siempre llega después del amarillo y los minutos quedan en rango", () => {
    const s = mergeSettings({ kds: { barraWarn: 30, barraLate: 10, cocinaWarn: 0, cocinaLate: 500 } });
    expect(s.kds.barraWarn).toBe(30);
    expect(s.kds.barraLate).toBe(31);
    expect(s.kds.cocinaWarn).toBe(DEFAULT_SETTINGS.kds.cocinaWarn);
    expect(s.kds.cocinaLate).toBe(120);
    expect(kdsThresholds(s, "barra")).toEqual({ warn: 30, late: 31 });
    // Sin estación (la pantalla de todo) usa los de cocina
    expect(kdsThresholds(s, null)).toEqual({ warn: s.kds.cocinaWarn, late: 120 });
  });

  it("los motivos se limpian: sin repetir, sin vacíos, cortos y hasta 8", () => {
    const s = mergeSettings({
      reasons: {
        void: ["  Se marcó   dos veces ", "se marcó dos veces", "", "ok", 7, "x".repeat(60), ...Array.from({ length: 10 }, (_, i) => `Motivo ${i}`)],
        courtesy: "no es una lista",
        discount: [],
        notes: ["Sin hielo"],
      },
    });
    expect(s.reasons.void[0]).toBe("Se marcó dos veces");
    expect(s.reasons.void).not.toContain("ok");
    expect(s.reasons.void[1]).toHaveLength(40);
    expect(s.reasons.void).toHaveLength(8);
    expect(s.reasons.courtesy).toEqual(DEFAULT_SETTINGS.reasons.courtesy);
    // Una lista vacía es válida: se escribe el motivo cada vez
    expect(s.reasons.discount).toEqual([]);
    expect(s.reasons.notes).toEqual(["Sin hielo"]);
  });
});
