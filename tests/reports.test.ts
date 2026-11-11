import { describe, expect, it } from "vitest";
import { engineerMenu } from "../lib/core/menu-engineering";
import { splitTips } from "../lib/core/tips";

describe("ingeniería de menú", () => {
  // Cuatro platos: participación promedio 25 %, línea de popularidad 17,5 %; margen promedio ponderado por unidad
  const menu = engineerMenu([
    { id: "a", name: "Antojo", units: 50, net: 750_000, cost: 150_000 }, // 50 %, deja 12.000
    { id: "b", name: "Burger", units: 30, net: 900_000, cost: 600_000 }, // 30 %, deja 10.000
    { id: "c", name: "Bandeja", units: 12, net: 780_000, cost: 240_000 }, // 12 %, deja 45.000
    { id: "d", name: "Limonada", units: 8, net: 40_000, cost: 24_000 }, // 8 %, deja 2.000
    { id: "e", name: "Sin ventas", units: 0, net: 0, cost: 0 },
  ]);
  it("deja por fuera lo que no se vendió y ordena por lo más pedido", () => {
    expect(menu.dishes.map((d) => d.id)).toEqual(["a", "b", "c", "d"]);
    expect(menu.popularityLine).toBeCloseTo(0.175);
  });
  it("clasifica por popularidad y margen", () => {
    // Margen promedio: (600.000 + 300.000 + 540.000 + 16.000) / 100 = 14.560 por unidad
    expect(menu.marginLine).toBeCloseTo(14_560);
    const cls = Object.fromEntries(menu.dishes.map((d) => [d.id, d.cls]));
    expect(cls).toEqual({ a: "caballo", b: "caballo", c: "enigma", d: "perro" });
  });
  it("un plato popular y que deja más que el promedio es estrella", () => {
    const m = engineerMenu([
      { id: "x", name: "X", units: 60, net: 1_800_000, cost: 300_000 },
      { id: "y", name: "Y", units: 40, net: 400_000, cost: 200_000 },
    ]);
    expect(m.dishes.find((d) => d.id === "x")!.cls).toBe("estrella");
  });
  it("sin ventas no hay nada que clasificar", () => {
    expect(engineerMenu([]).dishes).toEqual([]);
  });
});

describe("reparto de la propina", () => {
  const team = [
    { id: "a", name: "Camila", minutes: 480 },
    { id: "b", name: "Juan Pablo", minutes: 240 },
    { id: "c", name: "Luisa", minutes: 240 },
    { id: "d", name: "Descansó", minutes: 0 },
  ];
  it("por horas: proporcional a lo trabajado y sin que sobre ni falte un peso", () => {
    const out = splitTips(100_001, team, "horas");
    expect(out.map((p) => p.amount)).toEqual([50_001, 25_000, 25_000]);
    expect(out.reduce((s, p) => s + p.amount, 0)).toBe(100_001);
    expect(out.some((p) => p.id === "d")).toBe(false);
  });
  it("en partes iguales entre quienes trabajaron", () => {
    const out = splitTips(100_000, team, "partes");
    expect(out.map((p) => p.amount)).toEqual([33_334, 33_333, 33_333]);
  });
  it("sin propina o sin nadie que haya trabajado no reparte", () => {
    expect(splitTips(0, team, "horas").every((p) => p.amount === 0)).toBe(true);
    expect(splitTips(50_000, [{ id: "z", name: "Z", minutes: 0 }], "horas")).toEqual([]);
  });
});
