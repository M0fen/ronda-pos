/**
 * Comanda en papel: una tirilla por estación (cocina, barra) con lo que se pidió en una ronda. Sirve de respaldo
 * cuando no hay pantalla en la cocina o para pegar en la bolsa de un domicilio. Puro: sin base de datos.
 */

export interface ComandaItem {
  id: string;
  name: string;
  qty: number;
  modifiers: { name: string }[];
  note: string;
  station: string;
  status: string;
  allergy: boolean;
  seat: number | null;
}

export interface ComandaRound<T extends ComandaItem = ComandaItem> {
  round: number;
  sentAt: string | null;
  items: T[];
}

export interface Comanda<T extends ComandaItem = ComandaItem> {
  station: string;
  round: number;
  sentAt: string | null;
  /** Lo que hay que preparar, por puesto */
  lines: T[];
  /** Lo anulado de esa ronda en esa estación: para que no se prepare */
  voided: T[];
  units: number;
}

/** Cocina primero (lo que más se demora), luego barra y cualquier otra estación por nombre. */
const ORDER: Record<string, number> = { cocina: 0, barra: 1 };
const byStation = (a: string, b: string) => (ORDER[a] ?? 9) - (ORDER[b] ?? 9) || a.localeCompare(b);

export const STATION_TITLE: Record<string, string> = { cocina: "Cocina", barra: "Barra" };

/**
 * Las comandas de una ronda (la pedida, o la última que se envió), una por estación. Con `station` solo la de esa
 * estación. Dentro de cada una, en el orden de la cuenta, agrupado por puesto (sin puesto al final).
 */
export function comandasFor<T extends ComandaItem>(rounds: ComandaRound<T>[], opts: { round?: number | null; station?: string | null } = {}): Comanda<T>[] {
  const sent = rounds.filter((r) => r.items.length);
  if (!sent.length) return [];
  const pick = (opts.round && sent.find((r) => r.round === opts.round)) || sent.reduce((a, b) => (b.round > a.round ? b : a));
  const stations = [...new Set(pick.items.map((i) => i.station))].filter((s) => !opts.station || s === opts.station).sort(byStation);
  const bySeat = (a: T, b: T) => (a.seat ?? 99) - (b.seat ?? 99);
  return stations.map((station) => {
    const mine = pick.items.filter((i) => i.station === station);
    const lines = mine.filter((i) => i.status !== "void").sort(bySeat);
    return {
      station,
      round: pick.round,
      sentAt: pick.sentAt,
      lines,
      voided: mine.filter((i) => i.status === "void"),
      units: lines.reduce((n, i) => n + i.qty, 0),
    };
  });
}
