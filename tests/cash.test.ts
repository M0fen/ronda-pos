import { describe, expect, it } from "vitest";
import { cashView, closedCashView, hidesDayTotals, methodsFor, type CashTotals } from "../lib/core/cash";
import { ownerSummary } from "../lib/summary";

/**
 * Arqueo a ciegas: lo que no puede ver quien cuenta el cajón no viaja al navegador.
 * Las cifras del ejemplo son distintas entre sí para poder buscarlas en lo que se manda.
 */
const totals: CashTotals = {
  session: { id: "s1", opened_at: "2026-11-10T16:00:00.000Z", opening: 213_457, opener: "Valentina" },
  byMethod: [
    { method: "efectivo", amount: 987_650, tip: 43_210, n: 12 },
    { method: "tarjeta", amount: 456_780, tip: 21_090, n: 7 },
    { method: "plataforma", amount: 120_000, tip: 0, n: 2 },
  ],
  moves: [{ id: "m1", kind: "out", amount: 35_000, reason: "Hielo", created_at: "2026-11-10T18:00:00.000Z", staff: "Valentina" }],
  expected: 213_457 + 987_650 + 43_210 - 35_000,
  sales: 987_650 + 456_780 + 120_000,
  tips: 43_210 + 21_090,
  payments: 21,
  openChecks: 3,
  removed: { n: 1, amount: 18_500 },
};

/** Lo que no debe llegarle a quien cuenta a ciegas: esperado, base, total cobrado, propinas, efectivo y su propina, lo quitado. */
const SECRETS = [totals.expected, totals.session.opening, totals.sales, totals.tips, 987_650, 43_210, 18_500].map(String);

describe("arqueo a ciegas", () => {
  it("al dueño y a la administración les llega todo", () => {
    const view = cashView(totals, true);
    expect(view.expected).toBe(1_209_317);
    expect(view.session.opening).toBe(213_457);
    expect(view.sales).toBe(1_564_430);
    expect(view.tips).toBe(64_300);
    expect(view.removed).toEqual({ n: 1, amount: 18_500 });
    expect(view.byMethod.find((m) => m.method === "efectivo")).toEqual({ method: "efectivo", n: 12, amount: 987_650, tip: 43_210 });
  });

  it("a la caja no le viaja el esperado ni nada con qué calcularlo", () => {
    const view = cashView(totals, false);
    expect(view.expected).toBeNull();
    expect(view.session.opening).toBeNull();
    expect(view.sales).toBeNull();
    expect(view.tips).toBeNull();
    expect(view.removed).toEqual({ n: 1, amount: null });
    expect(view.byMethod.find((m) => m.method === "efectivo")).toEqual({ method: "efectivo", n: 12, amount: null, tip: null });
    // Lo que se manda al navegador, tal como viaja: ninguna de las cifras reservadas aparece
    const sent = JSON.stringify(view);
    for (const secret of SECRETS) expect(sent).not.toContain(secret);
  });

  it("la caja sí ve los otros medios (para cuadrar el datáfono), las entradas y salidas y cuántos pagos van", () => {
    const view = cashView(totals, false);
    expect(view.byMethod.find((m) => m.method === "tarjeta")).toEqual({ method: "tarjeta", n: 7, amount: 456_780, tip: 21_090 });
    expect(view.moves).toEqual(totals.moves);
    expect(view.payments).toBe(21);
    expect(view.openChecks).toBe(3);
    expect(view.session).toMatchObject({ id: "s1", opener: "Valentina" });
  });

  it("un dato nuevo del resumen no viaja solo: la vista se arma campo por campo", () => {
    const extended = {
      ...totals,
      ins: 0,
      outs: 35_000,
      cashPayments: 12,
      session: { ...totals.session, counted: null, expected: 777_001, difference: null },
      byMethod: totals.byMethod.map((m) => ({ ...m, received: m.method === "efectivo" ? 1_111_111 : 0 })),
    };
    const sent = JSON.stringify(cashView(extended, false));
    for (const leak of ["received", "1111111", "cashPayments", "777001", '"outs"']) expect(sent).not.toContain(leak);
  });

  it("cierres anteriores: la caja ve cuándo y quién cerró, no el esperado ni si cuadró", () => {
    const history = [{ id: "c1", closed_at: "2026-11-09T04:10:00.000Z", closer: "Valentina", expected: 842_300, counted: 840_300, difference: -2000 }];
    expect(closedCashView(history, true)).toEqual(history);
    expect(closedCashView(history, false)).toEqual([{ id: "c1", closed_at: "2026-11-09T04:10:00.000Z", closer: "Valentina", expected: null, counted: null, difference: null }]);
    expect(JSON.stringify(closedCashView(history, false))).not.toMatch(/842300|840300|-2000/);
  });

  it("«Cómo pagaron» del panel sale sin la fila del efectivo para la caja", () => {
    const methods = [
      { method: "efectivo", amount: 987_650, n: 12 },
      { method: "tarjeta", amount: 456_780, n: 7 },
    ];
    expect(methodsFor(methods, true)).toEqual(methods);
    expect(methodsFor(methods, false)).toEqual([{ method: "tarjeta", amount: 456_780, n: 7 }]);
  });

  it("mientras la caja siga abierta, quien la cuenta no ve los totales de esa jornada", () => {
    // Con el total del día y lo cobrado por los otros medios sale, restando, el efectivo: por eso no basta quitar una fila
    const opened = "2026-11-10T11:30:00-05:00";
    expect(hidesDayTotals(false, opened, "2026-11-10")).toBe(true);
    // La jornada de ayer ya se contó y se cerró
    expect(hidesDayTotals(false, opened, "2026-11-09")).toBe(false);
    // El dueño y la administración ven todo
    expect(hidesDayTotals(true, opened, "2026-11-10")).toBe(false);
    // Con la caja cerrada el conteo ya quedó hecho: los totales vuelven a verse
    expect(hidesDayTotals(false, null, "2026-11-10")).toBe(false);
    expect(hidesDayTotals(false, undefined, "2026-11-10")).toBe(false);
    // Una caja que quedó abierta desde ayer cubre las dos jornadas
    const since = "2026-11-09T18:00:00-05:00";
    expect(hidesDayTotals(false, since, "2026-11-09")).toBe(true);
    expect(hidesDayTotals(false, since, "2026-11-10")).toBe(true);
    expect(hidesDayTotals(false, since, "2026-11-08")).toBe(false);
    // Abierta a las 2:00 a. m.: todavía es la jornada del día anterior
    expect(hidesDayTotals(false, "2026-11-10T02:00:00-05:00", "2026-11-09")).toBe(true);
    // La base la entrega como fecha; también sirve
    expect(hidesDayTotals(false, new Date(opened), "2026-11-10")).toBe(true);
  });

  it("el resumen para WhatsApp que arma la caja no trae el efectivo y lo dice", () => {
    const base = {
      business: "Sr. Patata",
      dayLabel: "martes 10 de noviembre",
      sales: 1_448_546,
      gross: 1_564_430,
      checks: 21,
      avgTicket: 68_978,
      tips: 64_300,
      lastWeek: 0,
      weekday: "martes",
      top: [],
      voids: { n: 0, amount: 0 },
      courtesies: 0,
      lowStock: [],
      open: { n: 0, amount: 0 },
    };
    const all = [
      { method: "efectivo", amount: 987_650 },
      { method: "tarjeta", amount: 456_780 },
    ];
    const owner = ownerSummary({ ...base, methods: all });
    expect(owner).toContain("Efectivo");
    expect(owner).toContain("987.650");
    const cashier = ownerSummary({ ...base, methods: methodsFor(all, false), cashHidden: true });
    expect(cashier).not.toContain("987.650");
    expect(cashier).toContain("Tarjeta");
    expect(cashier).toContain("el efectivo se cuenta en el arqueo de caja");
    // Sin pagos por otros medios, igual queda dicho
    expect(ownerSummary({ ...base, methods: [], cashHidden: true })).toContain("Pagos: el efectivo se cuenta en el arqueo de caja");
  });
});
