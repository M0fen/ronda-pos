"use client";

import Link from "next/link";
import { useState } from "react";
import { cop } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Columnas de una sola serie: barras finas, punta redondeada, grilla tenue y valor al pasar el dedo. */
export function ColumnChart({ data, highlight, height = 180, label }: { data: { key: string; label: string; value: number; sub?: string; href?: string }[]; highlight?: string; height?: number; label: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const peak = data.reduce((a, b) => (b.value > a.value ? b : a), data[0]!);
  const shown = hover ? data.find((d) => d.key === hover) : null;
  return (
    <figure className="pt-2">
      <div className="relative" style={{ height }}>
        {ticks.map((t) => (
          // La fila se centra en su valor: la línea queda justo a la altura que marca
          <div key={t} className="absolute inset-x-0 flex translate-y-1/2 items-center gap-2" style={{ bottom: `${(t / top) * 100}%` }}>
            <span className="w-11 text-right text-[11px] leading-4 text-humo tnum">{compact(t)}</span>
            <span className="h-px flex-1 bg-linea" />
          </div>
        ))}
        <div className="absolute inset-y-0 right-0 left-[52px] flex items-end gap-[2px]">
          {data.map((d) => {
            const h = (d.value / top) * 100;
            const props = {
              className: "group relative flex h-full flex-1 items-end justify-center rounded-t-md outline-none focus-visible:ring-2 focus-visible:ring-balcon",
              onMouseEnter: () => setHover(d.key),
              onMouseLeave: () => setHover(null),
              onFocus: () => setHover(d.key),
              onBlur: () => setHover(null),
              "aria-label": `${d.label}: ${cop(d.value)}`,
            };
            const inner = (
              <>
                <span
                  className={cn("w-full max-w-6 rounded-t-[4px] transition-opacity", d.key === highlight ? "bg-balcon" : "bg-balcon/55", hover && hover !== d.key && "opacity-50")}
                  style={{ height: `${Math.max(d.value ? 1.5 : 0, h)}%` }}
                />
                {d.key === peak.key && d.value > 0 && !hover ? <span className="absolute whitespace-nowrap text-[11px] font-semibold text-tinto tnum" style={{ bottom: `calc(${h}% + 4px)` }}>{compact(d.value)}</span> : null}
              </>
            );
            return d.href ? (
              <Link key={d.key} href={d.href} scroll={false} aria-current={d.key === highlight ? "date" : undefined} {...props}>
                {inner}
              </Link>
            ) : (
              <button key={d.key} type="button" {...props}>
                {inner}
              </button>
            );
          })}
        </div>
        {shown ? (
          <div className="pointer-events-none absolute top-0 right-0 rounded-xl bg-tinto px-3 py-2 text-[13px] text-cal shadow-lg">
            <p className="font-semibold">{shown.label}</p>
            <p className="tnum">{cop(shown.value)}</p>
            {shown.sub ? <p className="text-cal/70">{shown.sub}</p> : null}
          </div>
        ) : null}
      </div>
      <div className="ml-[52px] mt-1.5 flex gap-[2px]">
        {data.map((d, i) => (
          <span key={d.key} className="flex-1 text-center text-[11px] text-humo tnum">
            {data.length > 12 && i % 2 === 1 && d.key !== highlight ? "" : d.label}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.key}>
              <th>{d.label}</th>
              <td>{cop(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function niceStep(max: number) {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

function compact(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toLocaleString("es-CO", { maximumFractionDigits: 1 })} M`;
  if (v >= 1000) return `${Math.round(v / 1000)} mil`;
  return String(v);
}

/** Lista con barra horizontal: una medida por elemento, un solo color. */
export function BarList({ rows, format = "money" }: { rows: { label: string; value: number; sub?: string }[]; format?: "money" | "count" }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between gap-3 text-[15px]">
            <span className="truncate font-semibold">{r.label}</span>
            <span className="shrink-0 tnum">
              {format === "money" ? cop(r.value) : r.value}
              {r.sub ? <span className="ml-1 text-[13px] text-humo">{r.sub}</span> : null}
            </span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-tinto/6">
            <div className="h-2 rounded-full bg-balcon" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
