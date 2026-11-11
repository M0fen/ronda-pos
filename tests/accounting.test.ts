import { describe, expect, it } from "vitest";
import { type AccountingDoc, accountingCsv, inventoryVariance, monthBounds, monthsAround, toCsv } from "../lib/core/accounting";

const doc = (p: Partial<AccountingDoc>): AccountingDoc => ({
  at: "2026-10-15T20:00:00.000Z",
  kind: "pos",
  number: "SP1001",
  customer: "Consumidor final",
  customerDoc: "222222222222",
  base: 37037,
  tax: 2963,
  tip: 4000,
  total: 44000,
  payments: [{ method: "efectivo", amount: 44000 }],
  dian: "simulado",
  code: "abc",
  ref: "",
  reason: "",
  ...p,
});

describe("CSV para Excel en Colombia", () => {
  it("usa punto y coma, BOM y fin de línea de Windows, y comillas solo donde hacen falta", () => {
    const csv = toCsv([
      ["a", 1, null],
      ['dice "hola"', "uno; dos", " espacio"],
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe('﻿a;1;\r\n"dice ""hola""";"uno; dos";" espacio"\r\n');
  });

  it("un texto que Excel tomaría por fórmula lleva apóstrofo; los números negativos no", () => {
    expect(toCsv([["=1+1", "@SUMA", "-x", -500]])).toBe("﻿'=1+1;'@SUMA;'-x;-500\r\n");
  });
});

describe("meses en Bogotá", () => {
  it("un mes va del día 1 a las 0:00 al día 1 del siguiente", () => {
    expect(monthBounds("2026-10")).toEqual({ from: "2026-10-01T00:00:00-05:00", to: "2026-11-01T00:00:00-05:00" });
    expect(monthBounds("2026-12").to).toBe("2027-01-01T00:00:00-05:00");
    expect(() => monthBounds("2026-13")).toThrow();
  });

  it("el mes actual y el anterior se cuentan en Bogotá", () => {
    // 1 de noviembre a las 2:00 UTC todavía es 31 de octubre en Bogotá
    expect(monthsAround(new Date("2026-11-01T02:00:00Z"))).toEqual({ current: "2026-10", previous: "2026-09" });
    expect(monthsAround(new Date("2027-01-10T15:00:00Z"))).toEqual({ current: "2027-01", previous: "2026-12" });
  });
});

describe("exportación para el contador", () => {
  it("una fila por documento en orden, con fecha y hora de Bogotá y medios de pago legibles", () => {
    const csv = accountingCsv(
      [
        doc({ at: "2026-10-16T01:30:00.000Z", number: "SP1002", payments: [{ method: "efectivo", amount: 20000 }, { method: "nequi", amount: 24000 }] }),
        doc({ at: "2026-10-15T20:00:00.000Z" }),
      ],
      { efectivo: "Efectivo", nequi: "Nequi" },
    );
    const lines = csv.slice(1).trim().split("\r\n");
    expect(lines[0]).toBe("Fecha;Hora;Documento;Número;Cliente;Identificación;Base;Impuesto;Propina;Total;Medios de pago;Estado DIAN;CUDE o CUFE;Anula a;Motivo");
    expect(lines[1]).toBe("2026-10-15;15:00;Tiquete POS electrónico;SP1001;Consumidor final;222222222222;37037;2963;4000;44000;Efectivo 44000;Simulado (sin enviar a la DIAN);abc;;");
    // 1:30 UTC del 16 = 8:30 p. m. del 15 en Bogotá
    expect(lines[2]?.startsWith("2026-10-15;20:30;Tiquete POS electrónico;SP1002;")).toBe(true);
    expect(lines[2]).toContain(";Efectivo 20000 + Nequi 24000;");
  });

  it("la nota que anula va en negativo y dice a qué documento anula", () => {
    const csv = accountingCsv([doc({ kind: "credito", number: "NCSF7", base: -100, tax: -8, tip: 0, total: -108, payments: [], dian: "pendiente", ref: "SF5", reason: "Error en el NIT" })]);
    expect(csv).toContain(";Nota crédito;NCSF7;");
    expect(csv).toContain(";-100;-8;0;-108;;Pendiente;abc;SF5;Error en el NIT\r\n");
  });
});

describe("inventario: recetas contra conteos", () => {
  const base = { unit: "g", venta: 0, anulacion: 0, merma: 0, conteo: 0, ajuste: 0 };

  it("real = lo de las recetas + la merma registrada + lo que faltó al contar", () => {
    const { rows, totals, counted } = inventoryVariance([
      { ...base, id: "a", name: "Tocineta", cost: 40, venta: -1000, anulacion: 100, merma: -50, conteo: -200 },
      { ...base, id: "b", name: "Papa", cost: 4, venta: -5000 },
    ]);
    // La papa no se contó ni tuvo merma: no sale en la lista, pero sí en lo teórico
    expect(rows.map((r) => r.name)).toEqual(["Tocineta"]);
    expect(rows[0]).toMatchObject({ theoretical: 900, waste: 50, counted: -200, real: 1150, countValue: -8000, wasteValue: 2000 });
    expect(totals).toEqual({ theoreticalValue: 900 * 40 + 5000 * 4, wasteValue: 2000, missingValue: -8000, extraValue: 0 });
    expect(counted).toBe(1);
  });

  it("primero lo que más plata representa; lo que sobró no tapa lo que faltó", () => {
    const { rows, totals } = inventoryVariance([
      { ...base, id: "a", name: "Queso", cost: 30, conteo: 100 },
      { ...base, id: "b", name: "Carne", cost: 50, conteo: -300 },
      { ...base, id: "c", name: "Salsa", cost: 10, merma: -100 },
    ]);
    expect(rows.map((r) => r.name)).toEqual(["Carne", "Salsa", "Queso"]);
    expect(totals.missingValue).toBe(-15000);
    expect(totals.extraValue).toBe(3000);
  });
});
