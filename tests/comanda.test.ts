import { describe, expect, it } from "vitest";
import { type ComandaItem, comandasFor } from "../lib/core/comanda";

let n = 0;
const item = (p: Partial<ComandaItem>): ComandaItem => ({
  id: `i${++n}`,
  name: "Producto",
  qty: 1,
  modifiers: [],
  note: "",
  station: "cocina",
  status: "sent",
  allergy: false,
  seat: null,
  ...p,
});

const rounds = [
  { round: 1, sentAt: "2026-11-11T00:10:00.000Z", items: [item({ name: "Agua", station: "barra" }), item({ name: "Burger", qty: 2 })] },
  {
    round: 2,
    sentAt: "2026-11-11T00:40:00.000Z",
    items: [
      item({ name: "Papas", seat: 2 }),
      item({ name: "Nuggets", seat: 1 }),
      item({ name: "Limonada", station: "barra", qty: 3 }),
      item({ name: "Sin puesto" }),
      item({ name: "Coca-Cola", station: "barra", status: "void" }),
    ],
  },
];

describe("comandas por estación", () => {
  it("sin ronda pedida usa la última, cocina primero y una tirilla por estación", () => {
    const c = comandasFor(rounds);
    expect(c.map((x) => [x.station, x.round])).toEqual([
      ["cocina", 2],
      ["barra", 2],
    ]);
    expect(c[0]!.sentAt).toBe("2026-11-11T00:40:00.000Z");
  });

  it("ordena por puesto y deja lo que no tiene puesto al final", () => {
    expect(comandasFor(rounds)[0]!.lines.map((i) => i.name)).toEqual(["Nuggets", "Papas", "Sin puesto"]);
  });

  it("lo anulado sale aparte y no cuenta en las unidades", () => {
    const barra = comandasFor(rounds).find((c) => c.station === "barra")!;
    expect(barra.lines.map((i) => i.name)).toEqual(["Limonada"]);
    expect(barra.voided.map((i) => i.name)).toEqual(["Coca-Cola"]);
    expect(barra.units).toBe(3);
  });

  it("filtra por estación y por ronda", () => {
    const c = comandasFor(rounds, { round: 1, station: "cocina" });
    expect(c).toHaveLength(1);
    expect(c[0]!.lines.map((i) => `${i.qty} ${i.name}`)).toEqual(["2 Burger"]);
    expect(comandasFor(rounds, { round: 1, station: "barra" })[0]!.round).toBe(1);
  });

  it("una ronda que no existe usa la última; sin rondas no hay comanda", () => {
    expect(comandasFor(rounds, { round: 9 })[0]!.round).toBe(2);
    expect(comandasFor([])).toEqual([]);
    expect(comandasFor(rounds, { station: "horno" })).toEqual([]);
  });
});
