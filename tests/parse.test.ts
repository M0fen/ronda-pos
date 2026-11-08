import { describe, expect, it } from "vitest";
import { parseQty } from "../lib/money";

describe("cantidades escritas como en Colombia", () => {
  it("el punto de miles no vuelve 2.400 en 2,4", () => {
    expect(parseQty("2.400")).toBe(2400);
    expect(parseQty("12.000.000")).toBe(12000000);
    expect(parseQty("1.234,5")).toBe(1234.5);
  });
  it("la coma es decimal; un punto que no separa miles también", () => {
    expect(parseQty("2,5")).toBe(2.5);
    expect(parseQty("2.5")).toBe(2.5);
    expect(parseQty("0,75")).toBe(0.75);
    expect(parseQty("750")).toBe(750);
  });
  it("vacío o texto no es un número", () => {
    expect(Number.isNaN(parseQty(""))).toBe(true);
    expect(Number.isNaN(parseQty("abc"))).toBe(true);
  });
});
