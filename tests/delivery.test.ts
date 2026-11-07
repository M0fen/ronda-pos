import { describe, expect, it } from "vitest";
import { deliveryStage, packingList } from "../lib/core/delivery";

describe("etapas del domicilio", () => {
  it("nuevo, en cocina, para empacar y listo", () => {
    expect(deliveryStage([{ status: "draft" }], false)).toBe("nuevo");
    expect(deliveryStage([], false)).toBe("nuevo");
    expect(deliveryStage([{ status: "sent" }, { status: "ready" }], false)).toBe("cocina");
    expect(deliveryStage([{ status: "ready" }, { status: "void" }], false)).toBe("empacar");
    expect(deliveryStage([{ status: "ready" }], true)).toBe("listo");
  });

  it("la lista de empaque trae cada producto con sus opciones y lo que siempre se olvida", () => {
    const list = packingList([
      { name: "Antojo de patatas", qty: 2, modifiers: [{ name: "Queso" }], status: "ready" },
      { name: "Burger smash doble", qty: 1, modifiers: [], status: "void" },
    ]);
    expect(list).toEqual(["2 × Antojo de patatas (Queso)", "Salsas y cubiertos", "Factura en la bolsa", "Bolsa sellada"]);
  });
});
