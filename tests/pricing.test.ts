import { describe, expect, it } from "vitest";
import { balance, cashSuggestions, checkTotals, splitEqual, splitTax, stampsEarned, suggestedTip } from "../lib/core/pricing";
import { addDays, clock, describeSchedule, effectivePrice, isHappyHour, jornadaKey, weekdayOf } from "../lib/core/time";

describe("impuesto incluido", () => {
  it("separa base e impuesto como en la especificación", () => {
    expect(splitTax(8000, 8)).toEqual({ base: 7407, tax: 593 });
  });

  it("la suma de líneas cuadra al peso con el total", () => {
    const t = checkTotals([
      { unitPrice: 8500, qty: 3, taxRate: 8 },
      { unitPrice: 3500, qty: 1, taxRate: 8, modifiers: [{ name: "Grande", price: 2000 }] },
      { unitPrice: 26000, qty: 2, taxRate: 8 },
      { unitPrice: 4000, qty: 1, taxRate: 0 },
    ]);
    expect(t.gross).toBe(25500 + 5500 + 52000 + 4000);
    expect(t.total).toBe(t.gross);
    expect(t.base + t.tax).toBe(t.total);
    expect(t.taxes.map((g) => g.rate)).toEqual([8, 0]);
  });

  it("no cobra anulados ni cortesías y aplica el descuento por línea", () => {
    const t = checkTotals(
      [
        { unitPrice: 10000, qty: 2, taxRate: 8 },
        { unitPrice: 9000, qty: 1, taxRate: 8, status: "void" },
        { unitPrice: 7000, qty: 1, taxRate: 8, courtesy: true },
      ],
      10,
    );
    expect(t.gross).toBe(20000);
    expect(t.discount).toBe(2000);
    expect(t.total).toBe(18000);
    expect(t.base + t.tax).toBe(18000);
  });
});

describe("cobro", () => {
  it("propina sugerida redondeada a $100 y nunca sobre el 10 %", () => {
    expect(suggestedTip(45800, 10)).toBe(4600);
    expect(suggestedTip(45800, 15)).toBe(4600);
  });

  it("partes iguales suman el total", () => {
    const parts = splitEqual(45800, 3);
    expect(parts).toEqual([15300, 15300, 15200]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(45800);
    expect(splitEqual(250, 3).reduce((a, b) => a + b, 0)).toBe(250);
  });

  it("sugiere billetes redondos", () => {
    expect(cashSuggestions(45800)).toEqual([45800, 46000, 50000, 60000]);
  });

  it("los pagos pendientes no restan del saldo", () => {
    expect(balance(50000, [{ amount: 20000 }, { amount: 30000, status: "pending" }])).toEqual({ paid: 20000, due: 30000 });
  });

  it("un sello por visita sobre el mínimo", () => {
    expect(stampsEarned(14999, { minPurchase: 15000, goal: 8 })).toBe(0);
    expect(stampsEarned(15000, { minPurchase: 15000, goal: 8 })).toBe(1);
  });
});

describe("happy hour en hora de Bogotá", () => {
  const rule = { enabled: true, days: [4, 5, 6], from: "17:00", to: "19:00", label: "Happy hour" };
  // Jueves 15 de octubre de 2026, 17:30 en Bogotá = 22:30 UTC
  it("aplica dentro del horario y del día", () => {
    expect(isHappyHour(rule, new Date("2026-10-15T22:30:00Z"))).toBe(true);
    expect(isHappyHour(rule, new Date("2026-10-15T00:30:00Z"))).toBe(false);
    // Miércoles 14 a la misma hora
    expect(isHappyHour(rule, new Date("2026-10-14T22:30:00Z"))).toBe(false);
  });

  it("cruza la medianoche", () => {
    const late = { enabled: true, days: [5], from: "22:00", to: "01:00", label: "Trasnocho" };
    // Viernes 16 a las 23:00 Bogotá = sábado 04:00 UTC
    expect(isHappyHour(late, new Date("2026-10-17T04:00:00Z"))).toBe(true);
    // Sábado 17 a las 00:30 Bogotá (sigue siendo la noche del viernes)
    expect(isHappyHour(late, new Date("2026-10-17T05:30:00Z"))).toBe(true);
    expect(isHappyHour(late, new Date("2026-10-17T06:30:00Z"))).toBe(false);
  });

  it("solo baja el precio si el de happy hour es menor", () => {
    expect(effectivePrice({ price: 26000, happy_price: 19900 }, true)).toBe(19900);
    expect(effectivePrice({ price: 26000, happy_price: 19900 }, false)).toBe(26000);
    expect(effectivePrice({ price: 26000, happy_price: null }, true)).toBe(26000);
  });

  it("describe el horario en español", () => {
    expect(clock("17:00")).toBe("5:00 p. m.");
    expect(describeSchedule(rule)).toBe("jueves a sábado, de 5:00 p. m. a 7:00 p. m.");
  });
});

describe("jornada del bar", () => {
  it("lo vendido a la 1:30 a. m. del sábado cuenta para el viernes", () => {
    expect(jornadaKey(new Date("2026-10-17T01:30:00-05:00"))).toBe("2026-10-16");
  });

  it("desde las 5:00 a. m. empieza la jornada nueva", () => {
    expect(jornadaKey(new Date("2026-10-17T04:59:00-05:00"))).toBe("2026-10-16");
    expect(jornadaKey(new Date("2026-10-17T05:00:00-05:00"))).toBe("2026-10-17");
    expect(jornadaKey(new Date("2026-10-16T23:59:00-05:00"))).toBe("2026-10-16");
  });

  it("suma días y sabe qué día de la semana es", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -7)).toBe("2026-02-22");
    expect(weekdayOf("2026-10-16")).toBe(5);
    expect(weekdayOf("2026-10-18")).toBe(7);
  });
});
