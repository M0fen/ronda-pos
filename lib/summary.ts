import { cop } from "./money";
import { METHOD_LABEL } from "./settings";

/** Mensaje de cierre del día para el WhatsApp del dueño. */
export function ownerSummary(input: {
  business: string;
  dayLabel: string;
  sales: number;
  checks: number;
  avgTicket: number;
  tips: number;
  lastWeek: number;
  weekday: string;
  /** La jornada sigue abierta: la comparación es contra la semana pasada a esta misma hora. */
  partial?: boolean;
  top: { name: string; qty: number }[];
  methods: { method: string; amount: number }[];
  voids: { n: number; amount: number };
  courtesies: number;
  lowStock: string[];
  open: { n: number; amount: number };
}) {
  const delta = input.lastWeek ? Math.round(((input.sales - input.lastWeek) / input.lastWeek) * 100) : null;
  const lines = [
    `*${input.business} · ${input.dayLabel}*`,
    `Ventas: ${cop(input.sales)} en ${input.checks} cuentas${delta !== null ? ` (${delta >= 0 ? "+" : ""}${delta} % frente al ${input.weekday} pasado${input.partial ? " a esta hora" : ""})` : ""}`,
    `Ticket promedio: ${cop(input.avgTicket)} · Propinas: ${cop(input.tips)}`,
    input.top.length ? `Lo más vendido: ${input.top.slice(0, 3).map((t) => `${t.name} (${t.qty})`).join(", ")}` : "",
    input.methods.length ? `Pagos: ${input.methods.map((m) => `${METHOD_LABEL[m.method] ?? m.method} ${cop(m.amount)}`).join(" · ")}` : "",
    input.voids.n ? `Anulaciones: ${input.voids.n} por ${cop(input.voids.amount)}` : "Sin anulaciones",
    input.courtesies ? `Cortesías y premios: ${cop(input.courtesies)}` : "",
    input.lowStock.length ? `Por comprar: ${input.lowStock.slice(0, 5).join(", ")}` : "",
    input.open.n ? `Cuentas abiertas ahora: ${input.open.n} (${cop(input.open.amount)})` : "",
  ];
  return lines.filter(Boolean).join("\n");
}
