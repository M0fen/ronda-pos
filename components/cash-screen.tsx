"use client";

import { ArrowDownLeft, ArrowUpRight, Lock, LockOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { cashMoveAction, closeCashAction, fixCashCountAction, openCashAction } from "@/app/(pos)/actions";
import { btn, Money, Pill } from "@/components/ui";
import type { CashView, ClosedCash } from "@/lib/core/cash";
import { fmtShort, fmtTime } from "@/lib/format";
import { cop } from "@/lib/money";
import { METHOD_LABEL } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { AuthSheet, type AuthLevel, type AuthRequest, type Authorizer } from "./auth-sheet";
import { Keypad } from "./keypad";
import { Sheet } from "./sheet";
import { report, toast } from "./toast";

type Result = { ok: boolean; error?: string; message?: string; fields?: Record<string, string> };
type Auth = { id: string; pin: string };
const DENOMS = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50];
const typeAmount = (r: string, k: string) => (k === "del" ? r.slice(0, -1) : k === "000" ? (r ? `${r}000` : "") : r + k).slice(0, 8);

/**
 * Caja. El arqueo es a ciegas: a quien no puede ver el esperado (la caja) el servidor no le manda el esperado, la base,
 * el total cobrado ni el efectivo (llegan en null), y la pantalla pinta lo que hay. El dueño y la administración ven todo.
 */
export function CashScreen({
  summary,
  history,
  canClose,
  canFix,
  authorizers,
  meId,
}: {
  summary: CashView | null;
  history: ClosedCash[];
  canClose: boolean;
  canFix: boolean;
  authorizers: Authorizer[];
  meId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [opening, setOpening] = useState("200000");
  const [move, setMove] = useState<"in" | "out" | null>(null);
  const [moveAmount, setMoveAmount] = useState("");
  const [moveReason, setMoveReason] = useState("");
  const [closing, setClosing] = useState<"count" | "confirm" | null>(null);
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ difference: number | null } | null>(null);
  const [auth, setAuth] = useState<(AuthRequest & { run: (a: Auth) => Promise<Result>; done: string }) | null>(null);
  const counted = useMemo(() => DENOMS.reduce((s, d) => s + d * (parseInt(counts[d] || "0", 10) || 0), 0), [counts]);

  if (!summary)
    return (
      <div className="mx-auto max-w-md px-4 py-8">
        {result ? (
          <div className={cn("mb-6 rounded-3xl p-5", result.difference === null || result.difference === 0 ? "bg-puerta-soft" : "bg-fachada-soft")}>
            <p className="text-sm font-semibold">Caja cerrada</p>
            <p className="mt-1 text-3xl font-bold tnum">
              {result.difference === null ? "Cierre guardado" : result.difference === 0 ? "Cuadró exacto" : result.difference > 0 ? `Sobran ${cop(result.difference)}` : `Faltan ${cop(-result.difference)}`}
            </p>
            {result.difference === null ? <p className="mt-1 text-sm">El arqueo fue a ciegas: el dueño ve si cuadró.</p> : null}
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
          <Keypad onKey={(k) => setOpening((o) => typeAmount(o, k))} extra={{ label: "000", value: "000" }} />
          <button
            className={btn("primary", "xl", "mt-4 w-full")}
            disabled={pending || !canClose}
            onClick={() => start(async () => void (report(await openCashAction(parseInt(opening || "0", 10))) && router.refresh()))}
          >
            Abrir caja
          </button>
          {!canClose ? <p className="mt-2 text-center text-sm text-humo">La abre caja o el encargado.</p> : null}
        </div>
        <History history={history} canFix={canFix} />
      </div>
    );

  const s = summary;
  const expected = s.expected;

  function saveMove() {
    const kind = move!;
    const amount = parseInt(moveAmount, 10);
    const reason = moveReason;
    const action = (a?: Auth) => cashMoveAction({ kind, amount, reason, auth: a });
    start(async () => {
      const r = await action();
      if (!r.ok && r.fields?.auth) {
        setAuth({ label: `${kind === "in" ? "Entrada" : "Salida"} de ${cop(amount)} de la caja`, level: r.fields.auth as AuthLevel, run: action, done: "Movimiento guardado" });
        return;
      }
      if (report(r)) {
        setMove(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="mx-auto max-w-5xl px-3 py-4 sm:px-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Caja abierta</h1>
          <p className="text-humo">
            Desde las {fmtTime(s.session.opened_at)} · {s.session.opener}
            {s.session.opening !== null ? ` · base ${cop(s.session.opening)}` : ""}
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
            <button className={btn("dark", "md")} onClick={() => (setCounts({}), setNote(""), setClosing("count"))}>
              <Lock size={18} /> Cerrar caja
            </button>
          ) : null}
        </div>
      </div>
      {s.openChecks ? (
        <p className="mt-3 rounded-2xl bg-fachada-soft px-4 py-2.5 text-sm font-semibold text-[#6b4b00]">
          Hay {s.openChecks} {s.openChecks === 1 ? "cuenta abierta" : "cuentas abiertas"}: lo ideal es cerrarlas antes de cerrar la caja.
        </p>
      ) : null}

      <div className="mt-4 grid gap-4 md:grid-cols-[1.2fr_1fr]">
        <section className="rounded-3xl bg-papel p-4 ring-1 ring-linea">
          <p className="font-bold">Cobrado en este turno</p>
          {s.sales !== null ? (
            <>
              <p className="mt-1 text-4xl font-bold tnum">{cop(s.sales)}</p>
              <p className="text-sm text-humo">
                {s.payments} {s.payments === 1 ? "pago" : "pagos"}, con impuesto{s.tips !== null ? ` · propinas aparte: ${cop(s.tips)}` : ""}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-humo">
              {s.payments} {s.payments === 1 ? "pago" : "pagos"} registrados.
            </p>
          )}
          <ul className="mt-4 divide-y divide-linea">
            {s.byMethod.map((m) => (
              <li key={m.method} className="flex items-center justify-between py-2.5">
                <span className="font-semibold">{METHOD_LABEL[m.method]}</span>
                <span className="text-right">
                  {/* Arqueo a ciegas: el efectivo se cuenta sin saber cuánto debería haber (su valor ni siquiera llega) */}
                  {m.amount === null ? <span className="font-semibold">Se cuenta al cerrar</span> : <Money value={m.amount + (m.tip ?? 0)} className="font-semibold" />}
                  <span className="block text-[13px] text-humo">
                    {m.n} {m.n === 1 ? "pago" : "pagos"}
                    {m.tip ? ` · incluye ${cop(m.tip)} de propina` : ""}
                    {m.method === "plataforma" ? " · no entra al cajón" : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {s.removed.n ? (
            <p className="mt-3 rounded-xl bg-cereza-soft px-3 py-2 text-sm font-semibold text-cereza">
              {s.removed.n} {s.removed.n === 1 ? "pago quitado" : "pagos quitados"} en este turno{s.removed.amount !== null ? ` por ${cop(s.removed.amount)}` : ""}. El detalle está en el panel.
            </p>
          ) : null}
        </section>
        <section className="space-y-4">
          <div className="rounded-3xl bg-tinto p-4 text-cal">
            <p className="font-semibold text-cal/75">Efectivo que debe haber en el cajón</p>
            {expected !== null ? (
              <>
                <p className="mt-1 text-4xl font-bold tnum">{cop(expected)}</p>
                <p className="text-sm text-cal/70">Base, más lo cobrado en efectivo con sus propinas, más entradas y menos salidas.</p>
              </>
            ) : (
              <p className="mt-1 text-[15px] text-cal/80">No se muestra: el arqueo es a ciegas y el dueño ve si cuadró. Así el conteo es más confiable.</p>
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
      <History history={history} canFix={canFix} />

      <Sheet
        open={!!move}
        onClose={() => setMove(null)}
        title={move === "in" ? "Entra dinero a la caja" : "Sale dinero de la caja"}
        footer={
          <button className={btn("primary", "lg", "w-full")} disabled={pending || !moveAmount || moveReason.trim().length < 3} onClick={saveMove}>
            Guardar
          </button>
        }
      >
        <p className="text-center text-4xl font-bold tnum">{cop(parseInt(moveAmount || "0", 10))}</p>
        <input className="mt-4 h-12 w-full rounded-xl border border-linea-2 px-3 outline-none focus:border-tinto" placeholder="Motivo (ej. hielo, pago a proveedor)" value={moveReason} onChange={(e) => setMoveReason(e.target.value)} />
        <div className="mt-3">
          <Keypad onKey={(k) => setMoveAmount((o) => typeAmount(o, k))} extra={{ label: "000", value: "000" }} />
        </div>
        <p className="mt-2 text-sm text-humo">Queda con tu nombre. Si no eres de caja, lo autoriza caja o el encargado.</p>
      </Sheet>

      <Sheet
        open={closing === "count"}
        onClose={() => setClosing(null)}
        title="Arqueo y cierre"
        wide
        footer={
          <button className={btn("dark", "lg", "w-full")} onClick={() => setClosing("confirm")}>
            Revisar el cierre · {cop(counted)}
          </button>
        }
      >
        <p className="text-sm text-humo">Cuenta los billetes y monedas del cajón.{expected !== null ? "" : " El sistema compara después: tú no ves el esperado."}</p>
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

      <Sheet
        open={closing === "confirm"}
        onClose={() => setClosing("count")}
        title="¿Cerrar la caja?"
        footer={
          <div className="flex gap-2">
            <button className={btn("soft", "lg")} onClick={() => setClosing("count")}>
              Volver a contar
            </button>
            <button
              className={btn("dark", "lg", "flex-1")}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await closeCashAction({ counted, note, confirm: true });
                  if (r.ok && r.data) {
                    setClosing(null);
                    setResult({ difference: r.data.difference });
                    toast("Caja cerrada");
                    router.refresh();
                  } else report(r);
                })
              }
            >
              <Lock size={18} /> Cerrar con {cop(counted)}
            </button>
          </div>
        }
      >
        <dl className="space-y-2 text-[15px]">
          <div className="flex justify-between">
            <dt>Contado</dt>
            <dd className="font-bold tnum">{cop(counted)}</dd>
          </div>
          {expected !== null ? (
            <>
              <div className="flex justify-between">
                <dt>Esperado</dt>
                <dd className="tnum">{cop(expected)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Diferencia</dt>
                <dd className={cn("font-bold tnum", counted - expected < 0 ? "text-cereza" : counted - expected > 0 ? "text-[#6b4b00]" : "text-puerta")}>
                  {counted - expected === 0 ? "Cuadra" : counted - expected > 0 ? `Sobran ${cop(counted - expected)}` : `Faltan ${cop(expected - counted)}`}
                </dd>
              </div>
            </>
          ) : null}
        </dl>
        {counted === 0 ? <p className="mt-3 rounded-xl bg-cereza-soft px-3 py-2 text-sm font-semibold text-cereza">Contaste $0. Revisa que hayas escrito los billetes antes de cerrar.</p> : null}
        {s.openChecks ? (
          <p className="mt-3 rounded-xl bg-fachada-soft px-3 py-2 text-sm font-semibold text-[#6b4b00]">
            Siguen {s.openChecks} {s.openChecks === 1 ? "cuenta abierta" : "cuentas abiertas"}: sus pagos quedarán en la próxima caja que se abra.
          </p>
        ) : null}
      </Sheet>

      <AuthSheet
        request={auth}
        authorizers={authorizers}
        meId={meId}
        pending={pending}
        onClose={() => setAuth(null)}
        onAuth={(credentials) => {
          const a = auth!;
          start(async () => {
            if (report(await a.run(credentials), a.done)) {
              setAuth(null);
              setMove(null);
              router.refresh();
            }
          });
        }}
      />
    </div>
  );
}

function History({ history, canFix }: { history: ClosedCash[]; canFix: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [fixing, setFixing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [why, setWhy] = useState("");
  if (!history.length) return null;
  return (
    <section className="mt-6">
      <h2 className="text-lg font-bold">Cierres anteriores</h2>
      <ul className="mt-2 divide-y divide-linea rounded-2xl bg-papel px-4 ring-1 ring-linea">
        {history.map((h) => (
          <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <span>
              <span className="font-semibold">
                {fmtShort(h.closed_at)}, {fmtTime(h.closed_at)}
              </span>
              <span className="block text-[13px] text-humo">
                {h.closer}
                {h.expected !== null && h.counted !== null ? ` · esperado ${cop(h.expected)} · contado ${cop(h.counted)}` : ""}
              </span>
            </span>
            <span className="flex items-center gap-2">
              {/* A quien cuenta a ciegas no le llega si cuadró: solo cuándo y quién cerró */}
              {h.difference === null ? null : h.difference === 0 ? <Pill tone="green">Cuadró</Pill> : <Pill tone={h.difference > 0 ? "yellow" : "red"}>{h.difference > 0 ? `+${cop(h.difference)}` : cop(h.difference)}</Pill>}
              {canFix && h.counted !== null ? (
                <button className={btn("light", "sm")} onClick={() => (setFixing(h.id), setValue(String(h.counted)), setWhy(""))}>
                  Corregir conteo
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <Sheet
        open={!!fixing}
        onClose={() => setFixing(null)}
        title="Corregir el conteo"
        footer={
          <button
            className={btn("primary", "lg", "w-full")}
            disabled={pending || why.trim().length < 3}
            onClick={() =>
              start(async () => {
                if (report(await fixCashCountAction(fixing!, { counted: parseInt(value || "0", 10), note: why }))) {
                  setFixing(null);
                  router.refresh();
                }
              })
            }
          >
            Guardar {cop(parseInt(value || "0", 10))}
          </button>
        }
      >
        <p className="text-center text-4xl font-bold tnum">{cop(parseInt(value || "0", 10))}</p>
        <input className="mt-3 h-12 w-full rounded-xl border border-linea-2 px-3 outline-none focus:border-tinto" placeholder="Por qué se corrige (ej. un billete quedó en la caja fuerte)" value={why} onChange={(e) => setWhy(e.target.value)} />
        <div className="mt-3">
          <Keypad onKey={(k) => setValue((o) => typeAmount(o, k))} extra={{ label: "000", value: "000" }} />
        </div>
        <p className="mt-2 text-sm text-humo">Queda en el registro con tu nombre, el conteo anterior y el nuevo.</p>
      </Sheet>
    </section>
  );
}
