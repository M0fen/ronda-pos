import { describe, expect, it } from "vitest";
import { csvCell, csvFilename, csvStamp, toCsv } from "../lib/core/csv";

describe("CSV para el contador", () => {
  it("escapa solo lo que hace falta", () => {
    expect(csvCell("Mesa 4")).toBe("Mesa 4");
    expect(csvCell("Combo; grande")).toBe('"Combo; grande"');
    expect(csvCell('Burger "smash"')).toBe('"Burger ""smash"""');
    expect(csvCell("dos\nlíneas")).toBe('"dos\nlíneas"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(true)).toBe("Sí");
  });

  it("escribe los números como los lee Excel en Colombia: enteros tal cual y decimales con coma", () => {
    expect(csvCell(145900)).toBe("145900");
    expect(csvCell(22.5)).toBe("22,5");
    expect(csvCell(-3200)).toBe("-3200");
    expect(csvCell(Number.NaN)).toBe("");
  });

  it("arma el archivo con BOM, punto y coma y CRLF", () => {
    const csv = toCsv(["Jornada", "Total"], [["2026-11-08", 145900], ["2026-11-09", 0]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toBe("\uFEFFJornada;Total\r\n2026-11-08;145900\r\n2026-11-09;0\r\n");
  });

  it("pone la hora de Bogotá", () => {
    expect(csvStamp("2026-11-09T02:35:00Z")).toBe("2026-11-08 21:35");
    expect(csvStamp("2026-11-08T12:00:00-05:00")).toBe("2026-11-08 12:00");
    expect(csvStamp(null)).toBe("");
    expect(csvStamp("no es fecha")).toBe("");
  });

  it("nombra el archivo por rango y sede", () => {
    expect(csvFilename("ventas", "2026-11-01", "2026-11-08")).toBe("ronda-ventas-2026-11-01-a-2026-11-08.csv");
    expect(csvFilename("caja", "2026-11-08", "2026-11-08", "todas las sedes")).toBe("ronda-caja-2026-11-08-todas-las-sedes.csv");
  });
});
