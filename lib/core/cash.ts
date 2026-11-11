/**
 * Arqueo a ciegas. Quien cuenta el cajón no debe saber cuánto efectivo tendría que haber, y esconderlo en la pantalla
 * no basta: lo que llega al navegador se lee con "ver código fuente" o en la pestaña de red. Estas funciones arman lo que
 * se le manda a cada quien; lo que esa persona no puede ver va en null. Puras, con pruebas en tests/cash.test.ts.
 *
 * Cada vista se arma campo por campo a propósito: un dato nuevo en el resumen de caja no viaja hasta que se agregue aquí.
 */

import { jornadaKey } from "./time";

const CASH = "efectivo";

/**
 * ¿Hay que esconderle a esta persona los totales de una jornada? Sí, mientras la caja siga abierta y desde la jornada en
 * que se abrió: con lo vendido en el día y lo cobrado por los otros medios sale, restando, el efectivo que debería haber
 * (y con las propinas, igual). Cuando la caja se cierra el conteo ya quedó hecho, y los totales vuelven a verse.
 */
export function hidesDayTotals(seeExpected: boolean, cashOpenedAt: string | Date | null | undefined, dayKey: string) {
  if (seeExpected || !cashOpenedAt) return false;
  return dayKey >= jornadaKey(new Date(cashOpenedAt));
}

/** Lo que calcula el servidor de la caja abierta (cashSummary en lib/server/payments.ts). */
export interface CashTotals {
  session: { id: string; opened_at: string; opening: number; opener: string | null };
  byMethod: { method: string; amount: number; tip: number; n: number }[];
  moves: { id: string; kind: string; amount: number; reason: string; created_at: string; staff: string | null }[];
  expected: number;
  sales: number;
  tips: number;
  payments: number;
  openChecks: number;
  removed: { n: number; amount: number };
}

/** Lo que recibe la pantalla de caja. */
export interface CashView {
  session: { id: string; opened_at: string; opener: string | null; opening: number | null };
  byMethod: { method: string; n: number; amount: number | null; tip: number | null }[];
  moves: { id: string; kind: string; amount: number; reason: string; created_at: string; staff: string | null }[];
  expected: number | null;
  /** Lo cobrado por todos los medios y sus propinas: restando los otros medios sale el efectivo, así que tampoco viajan */
  sales: number | null;
  tips: number | null;
  payments: number;
  openChecks: number;
  removed: { n: number; amount: number | null };
}

/**
 * La caja abierta para quien la mira. Sin permiso para ver el esperado no viajan el esperado, la base, el total cobrado,
 * las propinas ni lo cobrado en efectivo. Los otros medios sí (con ellos se cuadra el datáfono) y también las entradas
 * y salidas, que registra la misma caja.
 */
export function cashView(s: CashTotals, seeExpected: boolean): CashView {
  return {
    session: { id: s.session.id, opened_at: s.session.opened_at, opener: s.session.opener, opening: seeExpected ? s.session.opening : null },
    byMethod: s.byMethod.map((m) => {
      const hidden = !seeExpected && m.method === CASH;
      return { method: m.method, n: m.n, amount: hidden ? null : m.amount, tip: hidden ? null : m.tip };
    }),
    moves: s.moves.map((m) => ({ id: m.id, kind: m.kind, amount: m.amount, reason: m.reason, created_at: m.created_at, staff: m.staff })),
    expected: seeExpected ? s.expected : null,
    sales: seeExpected ? s.sales : null,
    tips: seeExpected ? s.tips : null,
    payments: s.payments,
    openChecks: s.openChecks,
    removed: { n: s.removed.n, amount: seeExpected ? s.removed.amount : null },
  };
}

export interface ClosedCash {
  id: string;
  closed_at: string;
  closer: string | null;
  expected: number | null;
  counted: number | null;
  difference: number | null;
}

/** Cierres anteriores: quien cuenta a ciegas ve cuándo y quién cerró, no cuánto se esperaba ni si cuadró. */
export function closedCashView(list: ClosedCash[], seeExpected: boolean): ClosedCash[] {
  return list.map((h) => ({
    id: h.id,
    closed_at: h.closed_at,
    closer: h.closer,
    expected: seeExpected ? h.expected : null,
    counted: seeExpected ? h.counted : null,
    difference: seeExpected ? h.difference : null,
  }));
}

/** «Cómo pagaron» del panel: sin la fila del efectivo para quien cuenta a ciegas. */
export function methodsFor<T extends { method: string }>(methods: T[], seeExpected: boolean): T[] {
  return seeExpected ? methods : methods.filter((m) => m.method !== CASH);
}
