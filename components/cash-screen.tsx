"use client";

import { ArrowDownLeft, ArrowUpRight, Lock, LockOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { cashMoveAction, closeCashAction, openCashAction } from "@/app/(pos)/actions";
import { btn, Money, Pill } from "@/components/ui";
import { fmtShort, fmtTime } from "@/lib/format";
import type { cashSummary } from "@/lib/server/payments";
import { cop } from "@/lib/money";
import { METHOD_LABEL } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { Keypad } from "./keypad";
import { Sheet } from "./sheet";
import { report, toast } from "./toast";

type Summary = NonNullable<Awaited<ReturnType<typeof cashSummary>>>;
const DENOMS = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50];

export function CashScreen({
  summary,
  history,
  canClose,
  seeExpected,
}: {
  summary: Summary | null;
  history: { id: string; opened_at: string; closed_at: string; expected: number; counted: number; difference: number; closer: string | null }[];
  canClose: boolean;
  seeExpected: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [opening, setOpening] = useState("200000");
  const [move, setMove] = useState<"in" | "out" | null>(null);
  const [moveAmount, setMoveAmount] = useState("");
  const [moveReason, setMoveReason] = useState("");
  const [closing, setClosing] = useState(false);
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ difference: number } | null>(null);
  const counted = useMemo(() => DENOMS.reduce((s, d) => s + d * (parseInt(counts[d] || "0", 10) || 0), 0), [counts]);

  if (!summary)
    return (
      <div className="mx-auto max-w-md px-4 py-8">
        {result ? (
          <div className={cn("mb-6 rounded-3xl p-5", result.difference === 0 ? "bg-puerta-soft" : "bg-fachada-soft")}>
            <p className="text-sm font-semibold">Caja cerrada</p>
            <p className="mt-1 text-3xl font-bold tnum">{result.difference === 0 ? "Cuadró exacto" : result.difference > 0 ? `Sobran ${cop(result.difference)}` : `Faltan ${cop(-result.difference)}`}</p>
          </div>
        ) : null}
        <div className="rounded-3xl bg-papel p-5 ring-1 ring-linea">
          <p className="flex items-center gap-2 text-xl font-bold">
            <LockOpen size={22} /> Abrir caja
          </p>
          <p className="mt-1 text-humo">¿Con cuánto efectivo empiezas el turno?</p>
          <p className="my-4 text-center text-5xl font-bold tnum">{cop(parseInt(opening || "0", 10))}</p>
          <div className="mb-3 flex justify-center gap-2">
            {[100000, 200000, 300000].map((v) => (
              <button key={v} onClick={() => setOpening(String(v))} className="h-10 rounded-xl px-3 font-semibold ring-1 ring-linea-2 tnum">
                {cop(v)}
              </button>
            ))}
          </div>
          <Keypad onKey={(k) => setOpening((o) => (k === "del" ? o.slice(0, -1) : k === "000" ? `${o}000` : (o + k).slice(0, 8)))} extra={{ label: "000", value: "000" }} />
          <button
            className={btn("primary", "xl", "mt-4 w-full")}
            disabled={pending}
            onClick={() => start(async () => void (report(await openCashAction(parseInt(opening || "0", 10))) && router.refresh()))}
          >
            Abrir caja
          </button>
        </div>
        <History history={history} />
      </div>
    );

  const s = summary;
  return (
    <div className="mx-auto max-w-5xl px-3 py-4 sm:px-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Caja abierta</h1>
          <p className="text-humo">
            Desde las {fmtTime(s.session.opened_at)} · {s.session.opener} · base {cop(s.session.opening)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={btn("soft", "md")} onClick={() => (setMove("in"), setMoveAmount(""), setMoveReason(""))}>
            <ArrowDownLeft size={18} /> Entra dinero
          </button>
          <button className={btn("soft", "md")} onClick={() => (setMove("out"), setMoveAmount(""), setMoveReason(""))}>
            <ArrowUpRight size={18} /> Sale dinero
          </button>
          {canClose ? (
            <button className={btn("dark", "md")} onClick={() => setClosing(true)}>
              <Lock size={18} /> Cerrar caja
            </button>
          ) : null}
        </div>
      </div>
      {s.openChecks ? <p className="mt-3 rounded-2xl bg-fachada-soft px-4 py-2.5 text-sm font-semibold text-[#6b4b00]">Hay {s.openChecks} cuentas abiertas: ciérralas antes de cerrar la caja.</p> : null}

      <div className="mt-4 grid gap-4 md:grid-cols-[1.2fr_1fr]">
        <section className="rounded-3xl bg-papel p-4 ring-1 ring-linea">
          <p className="font-bold">Ventas del turno</p>
          <p className="mt-1 text-4xl font-bold tnum">{cop(s.sales)}</p>
          <p className="text-sm text-humo">
            {s.payments} {s.payments === 1 ? "pago" : "pagos"} · {cop(s.tips)} en propinas
          </p>
          <ul className="mt-4 divide-y divide-linea">
            {s.byMethod.map((m) => (
              <li key={m.method} className="flex items-center justify-between py-2.5">
                <span className="font-semibold">{METHOD_LABEL[m.method]}</span>
                <span className="text-right">
                  <Money value={m.amount + m.tip} className="font-semibold" />
                  <span className="block text-[13px] text-humo">
                    {m.n} {m.n === 1 ? "pago" : "pagos"}{m.tip ? ` · propina ${cop(m.tip)}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="space-y-4">
          <div className="rounded-3xl bg-tinto p-4 text-cal">
            <p className="font-semibold text-cal/75">Efectivo que debe haber en el cajón</p>
            {seeExpected ? (
              <p className="mt-1 text-4xl font-bold tnum">{cop(s.expected)}</p>
            ) : (
              <p className="mt-1 text-[15px] text-cal/80">Se muestra después del arqueo: así el conteo es a ciegas y más confiable.</p>
            )}
          </div>
          <div className="rounded-3xl bg-papel p-4 ring-1 ring-linea">
            <p className="font-bold">Entradas y salidas</p>
            {s.moves.length ? (
              <ul className="mt-2 divide-y divide-linea">
                {s.moves.map((m) => (
                  <li key={m.id} className="flex items-center justify-between py-2">
                    <span>
                      <span className="font-semibold">{m.reason}</span>
                      <span className="block text-[13px] text-humo">
                        {fmtTime(m.created_at)} · {m.staff}
                      </span>
                    </span>
                    <span className={cn("font-semibold tnum", m.kind === "out" ? "text-cereza" : "text-puerta")}>
                      {m.kind === "out" ? "−" : "+"}
                      {cop(m.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-humo">Ninguna todavía.</p>
            )}
          </div>
        </section>
      </div>
      <History history={history} />

      <Sheet
        open={!!move}
        onClose={() => setMove(null)}
        title={move === "in" ? "Entra dinero a la caja" : "Sale dinero de la caja"}
        footer={
          <button
            className={btn("primary", "lg", "w-full")}
            disabled={pending || !moveAmount || moveReason.trim().length < 3}
            onClick={() =>
              start(async () => {
                if (report(await cashMoveAction({ kind: move!, amount: parseInt(moveAmount, 10), reason: moveReason }))) {
                  setMove(null);
                  router.refresh();
                }
              })
            }
          >
            Guardar
          </button>
        }
      >
        <p className="text-center text-4xl font-bold tnum">{cop(parseInt(moveAmount || "0", 10))}</p>
        <input className="mt-4 h-12 w-full rounded-xl border border-linea-2 px-3 outline-none focus:border-tinto" placeholder="Motivo (ej. hielo, pago a proveedor)" value={moveReason} onChange={(e) => setMoveReason(e.target.value)} />
        <div className="mt-3">
          <Keypad onKey={(k) => setMoveAmount((o) => (k === "del" ? o.slice(0, -1) : k === "000" ? `${o}000` : (o + k).slice(0, 8)))} extra={{ label: "000", value: "000" }} />
        </div>
      </Sheet>

      <Sheet
        open={closing}
        onClose={() => setClosing(false)}
        title="Arqueo y cierre"
        wide
        footer={
          <button
            className={btn("dark", "lg", "w-full")}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await closeCashAction(counted, note);
                if (r.ok && r.data) {
                  setClosing(false);
                  setResult({ difference: r.data.difference });
                  toast("Caja cerrada");
                  router.refresh();
                } else report(r);
              })
            }
          >
            Cerrar caja con {cop(counted)}
          </button>
        }
      >
        <p className="text-sm text-humo">Cuenta los billetes y monedas del cajón. El sistema compara al final.</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {DENOMS.map((d) => (
            <label key={d} className="flex items-center gap-2 rounded-xl bg-cal px-3 py-2">
              <span className="w-20 text-sm font-semibold tnum">{cop(d)}</span>
              <span className="text-humo">×</span>
              <input
                inputMode="numeric"
                className="h-10 w-full rounded-lg border border-linea-2 bg-papel px-2 text-right tnum outline-none focus:border-tinto"
                value={counts[d] ?? ""}
                onChange={(e) => setCounts((c) => ({ ...c, [d]: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
                aria-label={`Cantidad de ${cop(d)}`}
              />
            </label>
          ))}
        </div>
        <p className="mt-4 flex items-baseline justify-between text-lg">
          <span className="font-semibold">Contado</span>
          <span className="text-3xl font-bold tnum">{cop(counted)}</span>
        </p>
        <input className="mt-3 h-12 w-full rounded-xl border border-linea-2 px-3 outline-none focus:border-tinto" placeholder="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
      </Sheet>
    </div>
  );
}

function History({ history }: { history: { id: string; closed_at: string; expected: number; counted: number; difference: number; closer: string | null }[] }) {
  if (!history.length) return null;
  return (
    <section className="mt-6">
      <h2 className="text-lg font-bold">Cierres anteriores</h2>
      <ul className="mt-2 divide-y divide-linea rounded-2xl bg-papel px-4 ring-1 ring-linea">
        {history.map((h) => (
          <li key={h.id} className="flex items-center justify-between py-3">
            <span>
              <span className="font-semibold">
                {fmtShort(h.closed_at)}, {fmtTime(h.closed_at)}
              </span>
              <span className="block text-[13px] text-humo">
                {h.closer} · esperado {cop(h.expected)} · contado {cop(h.counted)}
              </span>
            </span>
            {h.difference === 0 ? <Pill tone="green">Cuadró</Pill> : <Pill tone={h.difference > 0 ? "yellow" : "red"}>{h.difference > 0 ? `+${cop(h.difference)}` : cop(h.difference)}</Pill>}
          </li>
        ))}
      </ul>
    </section>
  );
}
