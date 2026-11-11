import { describe, expect, it } from "vitest";
import { bogotaStamp, CODE_LABEL, dianQrUrl, NOTE_LABEL, readiness, uniqueCode } from "../lib/core/dian";

const issuer = { nit: "900123456-7", legalName: "Sr. Patata S.A.S.", tradeName: "Sr. Patata", regime: "ordinario" as const, responsibilities: "O-13", address: "Cra. 13 #8-25", city: "Pereira", phone: "3001234567" };
const resolution = { number: "18764000000001", prefix: "SP", from: 1, to: 5000, validFrom: "2026-01-01", validTo: "2027-12-31" };
const doc = {
  prefix: "SP",
  number: 101,
  generatedAt: "2026-11-11T20:04:05.000Z",
  totals: { base: 80092, tax: 6408, tip: 8700, total: 95200 },
  issuer,
  buyer: { identified: false, doc: "222222222222", name: "Consumidor final", email: null },
  environment: "pruebas" as const,
};

describe("código único (CUDE o CUFE)", () => {
  it("es SHA-384 en hexadecimal y cambia con cualquier dato", () => {
    const a = uniqueCode(doc, "pin");
    expect(a).toMatch(/^[0-9a-f]{96}$/);
    expect(uniqueCode(doc, "pin")).toBe(a);
    expect(uniqueCode({ ...doc, number: 102 }, "pin")).not.toBe(a);
    expect(uniqueCode({ ...doc, environment: "produccion" }, "pin")).not.toBe(a);
    expect(uniqueCode(doc, "otra")).not.toBe(a);
  });
  it("la propina no entra: el valor es base más impuesto", () => {
    expect(uniqueCode({ ...doc, totals: { ...doc.totals, tip: 0 } }, "pin")).toBe(uniqueCode(doc, "pin"));
  });
  it("fecha y hora van en la hora de Bogotá", () => {
    expect(bogotaStamp("2026-11-12T03:30:00.000Z")).toEqual({ date: "2026-11-11", time: "22:30:00-05:00" });
  });
});

describe("cada documento con su nombre", () => {
  it("el tiquete POS usa CUDE y se anula con nota de ajuste; la factura, CUFE y nota crédito", () => {
    expect([CODE_LABEL.pos, NOTE_LABEL.pos]).toEqual(["CUDE", "Nota de ajuste"]);
    expect([CODE_LABEL.fe, NOTE_LABEL.fe]).toEqual(["CUFE", "Nota crédito"]);
  });
  it("el QR lleva a la consulta de la DIAN, la de habilitación en pruebas", () => {
    expect(dianQrUrl("abc", "produccion")).toBe("https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=abc");
    expect(dianQrUrl("abc", "pruebas")).toContain("catalogo-vpfe-hab.dian.gov.co");
  });
});

describe("lo que falta para facturar", () => {
  it("con todo cargado no falta nada", () => {
    expect(readiness({ type: "pos", issuer, resolution, lines: [{ code: "SP-001", description: "Antojo" }] })).toEqual([]);
  });
  it("dice qué falta y dónde se pone", () => {
    const out = readiness({
      type: "fe",
      issuer: { ...issuer, nit: "123", responsibilities: "" },
      resolution: { ...resolution, number: "", to: 0 },
      lines: [{ code: "", description: "Antojo de patatas" }, { code: "", description: "Antojo de patatas" }],
    });
    expect(out.join(" | ")).toMatch(/NIT del local/);
    expect(out.join(" | ")).toMatch(/responsabilidades tributarias/);
    expect(out.join(" | ")).toMatch(/resolución de factura electrónica/);
    expect(out.join(" | ")).toMatch(/rango autorizado/);
    expect(out.find((x) => x.startsWith("Código de producto"))).toBe("Código de producto para Antojo de patatas (Carta → el producto)");
  });
});
