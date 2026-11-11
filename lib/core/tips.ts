/**
 * Reparto de la propina (Ley 1935 de 2018): es de quienes atienden, se reparte al menos cada mes y el local no se
 * queda con nada. Por horas trabajadas (marcadas con PIN) o en partes iguales entre quienes trabajaron. Suma exacto.
 */
export type TipSplit = "horas" | "partes";

export interface TipPerson {
  id: string;
  name: string;
  minutes: number;
}

export function splitTips(total: number, people: TipPerson[], method: TipSplit) {
  const eligible = people.filter((p) => p.minutes > 0);
  const amount = Math.max(0, Math.round(total));
  if (!eligible.length || !amount) return eligible.map((p) => ({ ...p, amount: 0 }));
  const weights = eligible.map((p) => (method === "horas" ? p.minutes : 1));
  const sum = weights.reduce((s, w) => s + w, 0);
  // Mayor residuo: cada quien recibe su parte entera y los pesos que sobran van a los residuos más grandes
  const exact = weights.map((w) => (amount * w) / sum);
  const out = exact.map((x) => Math.floor(x));
  let left = amount - out.reduce((s, x) => s + x, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    out[i]! += 1;
    left--;
  }
  return eligible.map((p, i) => ({ ...p, amount: out[i]! }));
}
