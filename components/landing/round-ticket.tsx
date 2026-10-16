"use client";

import { Check, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { checkTotals } from "@/lib/core/pricing";
import { cop } from "@/lib/money";
import { cn } from "@/lib/utils";

const ITEMS = [
  { id: "capuchino", name: "Capuchino", price: 8500, color: "#7A4A2A" },
  { id: "poker", name: "Poker", price: 6000, color: "#B07800" },
  { id: "mojito", name: "Mojito", price: 26000, color: "#D2232A" },
  { id: "empanadas", name: "Empanadas x3", price: 10500, color: "#C2541B" },
];

/** La ronda que se arma en la portada: tocar productos imprime la comanda y se cobra con Bre-B. */
export function RoundTicket() {
  const [lines, setLines] = useState<Record<string, number>>({ capuchino: 2 });
  const [paid, setPaid] = useState(false);
  const [sent, setSent] = useState(false);
  const list = ITEMS.filter((i) => lines[i.id]);
  const totals = useMemo(() => checkTotals(list.map((i) => ({ unitPrice: i.price, qty: lines[i.id]!, taxRate: 8 }))), [list, lines]);

  return (
    <div className="relative">
      <div className="grid grid-cols-2 gap-2">
        {ITEMS.map((i) => (
          <button
            key={i.id}
            onClick={() => {
              setLines((l) => ({ ...l, [i.id]: (l[i.id] ?? 0) + 1 }));
              setPaid(false);
              setSent(false);
            }}
            className="flex min-h-16 flex-col items-start justify-center rounded-2xl bg-papel py-2.5 pr-3 pl-5 text-left ring-1 ring-linea transition active:scale-[0.98] hover:ring-tinto"
            style={{ boxShadow: `inset 5px 0 0 ${i.color}` }}
          >
            <span className="font-semibold leading-tight">{i.name}</span>
            <span className="text-sm text-humo tnum">{cop(i.price)}</span>
          </button>
        ))}
      </div>

      <div className="relative mt-4 rotate-[-1.2deg]">
        <article key={list.map((i) => `${i.id}${lines[i.id]}`).join()} className="ticket-edge print-in relative mx-auto w-full max-w-[360px] bg-white px-6 pt-6 font-mono text-[13px] text-black shadow-[0_18px_40px_-12px_rgba(36,21,15,0.35)]">
          <p className="text-center font-sans text-lg font-extrabold [font-stretch:110%]">Café Bar Villa Verde</p>
          <p className="text-center">Mesa 7 · Ronda 1</p>
          <div className="my-3 border-t border-dashed border-black/40" />
          {list.length ? (
            <table className="w-full">
              <tbody>
                {list.map((i) => (
                  <tr key={i.id}>
                    <td className="w-8 tnum">{lines[i.id]}</td>
                    <td>{i.name}</td>
                    <td className="text-right tnum">{cop(i.price * lines[i.id]!)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-center">Toca un producto</p>
          )}
          <div className="my-3 border-t border-dashed border-black/40" />
          <div className="flex justify-between">
            <span>Base</span>
            <span className="tnum">{cop(totals.base)}</span>
          </div>
          <div className="flex justify-between">
            <span>Impoconsumo 8%</span>
            <span className="tnum">{cop(totals.tax)}</span>
          </div>
          <div className="flex justify-between text-[16px] font-bold">
            <span>TOTAL</span>
            <span className="tnum">{cop(totals.total)}</span>
          </div>
          {paid ? (
            <p className="absolute top-16 right-4 rotate-[-12deg] rounded-md border-[3px] border-puerta px-2 py-1 font-sans text-xl font-black tracking-wide text-puerta">PAGADO · BRE-B</p>
          ) : null}
        </article>
      </div>

      <div className="mt-5 flex gap-2">
        <button
          className={cn("inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl font-semibold", sent ? "bg-puerta-soft text-puerta-2" : "bg-puerta text-white")}
          onClick={() => setSent(true)}
          disabled={!list.length}
        >
          {sent ? (
            <>
              <Check size={18} /> En la barra
            </>
          ) : (
            "Enviar a barra"
          )}
        </button>
        <button className="inline-flex h-12 flex-1 items-center justify-center rounded-xl bg-balcon font-semibold text-white disabled:opacity-40" onClick={() => setPaid(true)} disabled={!list.length || paid}>
          Cobrar {cop(totals.total)}
        </button>
        <button
          className="inline-flex size-12 items-center justify-center rounded-xl ring-1 ring-linea-2"
          onClick={() => {
            setLines({});
            setPaid(false);
            setSent(false);
          }}
          aria-label="Empezar de nuevo"
        >
          <RotateCcw size={18} />
        </button>
      </div>
    </div>
  );
}
