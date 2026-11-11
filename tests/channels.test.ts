import { describe, expect, it } from "vitest";
import { channelOfCheck, cleanChannelPrices, cleanCode, cleanHiddenChannels, menuForChannel, priceIn } from "../lib/core/channels";

const product = (over: Partial<{ price: number; basePrice: number; onHappy: boolean; channelPrices: Record<string, number>; hiddenChannels: string[] }> = {}) => ({
  id: "p",
  price: 30000,
  basePrice: 30000,
  onHappy: false,
  channelPrices: {},
  hiddenChannels: [],
  ...over,
}) as never as { id: string; price: number; basePrice: number; onHappy: boolean; channelPrices: Partial<Record<"llevar" | "rappi" | "didi" | "propio", number>>; hiddenChannels: ("local" | "llevar" | "rappi" | "didi" | "propio" | "qr")[] };

describe("canal de la cuenta", () => {
  it("el domicilio va por su plataforma; sin plataforma es propio", () => {
    expect(channelOfCheck({ kind: "domicilio", channel: "rappi" })).toBe("rappi");
    expect(channelOfCheck({ kind: "domicilio", channel: "didi" })).toBe("didi");
    expect(channelOfCheck({ kind: "domicilio", channel: "local" })).toBe("propio");
  });
  it("para llevar es su propio canal y mesa y barra son el local", () => {
    expect(channelOfCheck({ kind: "llevar" })).toBe("llevar");
    expect(channelOfCheck({ kind: "mesa" })).toBe("local");
    expect(channelOfCheck({ kind: "barra" })).toBe("local");
  });
});

describe("precio por canal", () => {
  it("usa el precio del canal y, si no hay, el del local", () => {
    const p = product({ channelPrices: { rappi: 36000 } });
    expect(priceIn(p, "rappi")).toBe(36000);
    expect(priceIn(p, "didi")).toBe(30000);
    expect(priceIn(p, "local")).toBe(30000);
  });
  it("la carta QR cobra lo del local aunque haya otros precios", () => {
    expect(priceIn(product({ channelPrices: { llevar: 28000 } }), "qr")).toBe(30000);
  });
  it("con precio propio el happy hour no se aplica en ese canal", () => {
    const menu = { products: [product({ price: 24000, onHappy: true, channelPrices: { rappi: 36000 } })] };
    const rappi = menuForChannel(menu, "rappi").products[0];
    expect(rappi.price).toBe(36000);
    expect(rappi.onHappy).toBe(false);
    // Sin precio propio, para llevar conserva el happy hour del local
    expect(menuForChannel(menu, "llevar").products[0].price).toBe(24000);
  });
  it("lo que no se ofrece en un canal no aparece en su carta", () => {
    const menu = { products: [product({ hiddenChannels: ["rappi", "didi"] }), product()] };
    expect(menuForChannel(menu, "rappi").products).toHaveLength(1);
    expect(menuForChannel(menu, "local").products).toHaveLength(2);
  });
});

describe("limpieza de lo que manda el editor", () => {
  it("solo guarda precios enteros positivos de canales conocidos", () => {
    expect(cleanChannelPrices({ rappi: "36000.4", didi: 0, qr: 1000, mesa: 5, propio: -3 })).toEqual({ rappi: 36000 });
  });
  it("solo guarda canales conocidos para ocultar", () => {
    expect(cleanHiddenChannels(["rappi", "otro", "qr"])).toEqual(["rappi", "qr"]);
    expect(cleanHiddenChannels("rappi")).toEqual([]);
  });
  it("el código va en mayúsculas, sin espacios y vacío es sin código", () => {
    expect(cleanCode(" sp 001 ")).toBe("SP-001");
    expect(cleanCode("")).toBeNull();
    expect(cleanCode("ñandú")).toBe("");
    expect(cleanCode("A".repeat(31))).toBe("");
  });
});
