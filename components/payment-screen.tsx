"use client";

import { ArrowLeft, Banknote, Check, CreditCard, Gift, Landmark, Smartphone, Trash2, UserRound, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { closeCheckAction, paymentAction, redeemRewardAction, removePaymentAction, reviewClientPaymentAction } from "@/app/(pos)/actions";
import { btn, Money, Pill } from "@/components/ui";
import { cashSuggestions, splitEqual, suggestedTip } from "@/lib/core/pricing";
import type { CheckView } from "@/lib/server/checks";
import { cop } from "@/lib/money";
import { METHOD_LABEL } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { AuthSheet, type AuthLevel, type AuthRequest, type Authorizer } from "./auth-sheet";
import { Keypad } from "./keypad";
import { Sheet } from "./sheet";
import { report, toast } from "./toast";

type Method = "efectivo" | "tarjeta" | "nequi" | "breb" | "daviplata";
type Result = { ok: boolean; error?: string; message?: string; fields?: Record<string, string> };
type Auth = { id: string; pin: string };

const ICONS: Record<string, React.ReactNode> = {
  efectivo: <Banknote size={20} />,
  tarjeta: <CreditCard size={20} />,
  nequi: <Smartphone size={20} />,
  breb: <Landmark size={20} />,
  daviplata: <Wallet size={20} />,
};

/** Hasta 8 cifras: la tecla "000" no se pasa de ahí */
const typeAmount = (r: string, k: string) => (k === "del" ? r.slice(0, -1) : k === "000" ? (r ? `${r}000` : "") : r + k).slice(0, 8);

type SplitState = { split: "una" | "iguales" | "consumo"; parts: number; owner: Record<string, number> };

export function PaymentScreen({
  check,
  cashOpen,
  canRemove,
  config,
  authorizers,
  meId,
}: {
  check: CheckView;
  cashOpen: boolean;
  canRemove: boolean;
  config: {
    tips: { enabled: boolean; suggestedPct: number };
    methods: Method[];
    brebKey: string;
    nequiPhone: string;
    loyalty: { enabled: boolean; goal: number; reward: string; rewardMax: number };
    taxLabel: string;
  };
  authorizers: Authorizer[];
  meId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const total = check.totals.total;
  const free = total === 0;
  const tipsOn = config.tips.enabled && !free;
  const suggested = suggestedTip(total, config.tips.suggestedPct);
  const [tipMode, setTipMode] = useState<"si" | "otro" | "no" | null>((check.tip_answer as "si" | "no" | null) ?? (check.tips ? "si" : null));
  const [customTip, setCustomTip] = useState("");
  const tipTotal = tipMode === "si" ? suggested : tipMode === "otro" ? parseInt(customTip || "0", 10) : 0;
  const tipPaid = check.tips;
  const [{ split, parts, owner }, setSplitState] = useState<SplitState>({ split: "una", parts: 2, owner: {} });
  const setSplit = (v: SplitState["split"]) => setSplitState((s) => ({ ...s, split: v }));
  const setParts = (v: number) => setSplitState((s) => ({ ...s, parts: v }));
  const setOwner = (fn: (o: Record<string, number>) => Record<string, number>) => setSplitState((s) => ({ ...s, owner: fn(s.owner) }));
  const [part, setPart] = useState(0);
  const [method, setMethod] = useState<Method>(config.methods[0] ?? "efectivo");
  const [received, setReceived] = useState("");
  const [reference, setReference] = useState("");
  const [customAmount, setCustomAmount] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<"consumidor" | "nit">("consumidor");
  const [doc, setDoc] = useState("");
  const [docName, setDocName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [birthday, setBirthday] = useState("");
  const [consent, setConsent] = useState(false);
  const [tipConfirm, setTipConfirm] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; label: string } | null>(null);
  const [removeReason, setRemoveReason] = useState("");
  const [auth, setAuth] = useState<(AuthRequest & { run: (a: Auth) => Promise<Result>; done: string }) | null>(null);
  const payPanel = useRef<HTMLDivElement>(null);

  // La división se guarda en este dispositivo: si la página se recarga a mitad del cobro, no se pierde
  const splitKey = `ronda-split:${check.id}`;
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(splitKey) ?? "null") as SplitState | null;
      if (saved && ["una", "iguales", "consumo"].includes(saved.split)) setSplitState({ split: saved.split, parts: Math.min(6, Math.max(2, saved.parts || 2)), owner: saved.owner ?? {} });
    } catch {}
  }, [splitKey]);
  useEffect(() => {
    try {
      if (split === "una") localStorage.removeItem(splitKey);
      else localStorage.setItem(splitKey, JSON.stringify({ split, parts, owner }));
    } catch {}
  }, [split, parts, owner, splitKey]);

  const payable = check.items.filter((i) => i.status !== "void" && !i.courtesy);
  // El puesto que puso el mesero ya dice de quién es cada cosa: "Cada quien lo suyo" arranca así
  const ownerOf = (i: { id: string; seat: number | null }) => owner[i.id] ?? (i.seat && i.seat <= Math.max(2, parts) ? i.seat - 1 : 0);
  const pendingTotal = check.pendingPayments.reduce((s, p) => s + p.amount, 0);
  const due = Math.max(0, check.due - pendingTotal);

  // Lo que le toca a cada parte (sin propina) y su propina
  const shares = useMemo(() => {
    if (split === "iguales") {
      const amounts = splitEqual(total, parts);
      const tips = splitEqual(tipTotal, parts);
      return amounts.map((a, i) => ({ label: `Parte ${i + 1} de ${parts}`, amount: a, tip: tips[i] ?? 0 }));
    }
    if (split === "consumo") {
      const people = Math.max(2, parts);
      const raw = Array.from({ length: people }, (_, p) =>
        payable.filter((i) => ownerOf(i) === p).reduce((s, i) => s + (i.unit_price + i.modifiers.reduce((a, m) => a + m.price, 0)) * i.qty, 0),
      );
      const gross = raw.reduce((a, b) => a + b, 0) || 1;
      let assigned = 0;
      return raw.map((r, i) => {
        const amount = i === people - 1 ? total - assigned : Math.round((r / gross) * total);
        assigned += amount;
        return { label: `Persona ${i + 1}`, amount, tip: Math.round((tipTotal * amount) / (total || 1)) };
      });
    }
    return [{ label: "", amount: total, tip: tipTotal }];
  }, [split, parts, total, tipTotal, payable, owner]);

  const paidByPart = (label: string) => check.payments.filter((p) => p.part === label).reduce((s, p) => s + p.amount, 0);
  const current = shares[Math.min(part, shares.length - 1)]!;
  const currentLeft = split === "una" ? due : Math.max(0, current.amount - paidByPart(current.label));
  const amount = customAmount !== null ? Math.min(due, parseInt(customAmount || "0", 10)) : Math.min(due, currentLeft);
  const tipNow = split === "una" ? Math.max(0, tipTotal - tipPaid) : Math.max(0, current.tip - check.payments.filter((p) => p.part === current.label).reduce((s, p) => s + p.tip, 0));
  const charge = amount + (amount > 0 ? tipNow : 0);
  const receivedNum = parseInt(received || "0", 10);
  const change = method === "efectivo" && receivedNum ? receivedNum - charge : 0;

  useEffect(() => {
    setReceived("");
    setReference("");
  }, [method, part, split]);
  useEffect(() => setTipConfirm(false), [tipTotal]);

  const hasDrafts = check.items.some((i) => i.status === "draft");
  const chargeable = check.items.some((i) => i.status !== "draft" && i.status !== "void");
  const done = check.due === 0 && chargeable && !check.pendingPayments.length;
  const waiting = check.pendingPayments.length > 0;

  function register(after?: (r: Result) => void, receivedValue?: number) {
    if (!tipMode && tipsOn) return toast("Primero pregunta si incluye la propina", { tone: "error" });
    if (amount <= 0) return toast("No hay nada por cobrar en esta parte", { tone: "error" });
    start(async () => {
      const r = await paymentAction(check.id, {
        method,
        amount,
        tip: tipNow,
        received: method === "efectivo" ? (receivedValue ?? (receivedNum || charge)) : null,
        reference,
        part: current.label,
        confirmTip: tipConfirm,
      });
      if (!r.ok && r.fields?.tipConfirm) {
        setTipConfirm(true);
        report(r);
        return;
      }
      if (r.ok && r.data) {
        toast(r.data.change > 0 ? `Pago registrado. Vueltas: ${cop(r.data.change)}` : "Pago registrado");
        setCustomAmount(null);
        if (split !== "una" && part < shares.length - 1) setPart(part + 1);
        router.refresh();
        after?.(r);
      } else report(r);
    });
  }

  function closeInput() {
    return {
      tipAnswer: (tipTotal > 0 || tipPaid > 0 ? "si" : "no") as "si" | "no",
      invoice: { kind: invoice, doc, name: docName, email },
      customer: phone.trim() ? { phone, consent, birthday: birthday || undefined } : null,
    };
  }

  function finish(r: { ok: boolean; data?: { invoiceId: string | null; stamps: number } }) {
    try {
      localStorage.removeItem(splitKey);
    } catch {}
    if (r.data?.stamps) toast(`Cuenta cerrada · +${r.data.stamps} sello`);
    if (r.data?.invoiceId) router.push(`/recibo/${check.id}?nuevo=1`);
    else {
      toast("Cuenta cerrada sin factura: todo fue cortesía");
      router.push(check.kind === "domicilio" ? "/domicilios" : "/salon");
    }
  }

  function close() {
    if (tipsOn && !tipMode) return toast("Pregunta al cliente si incluye la propina", { tone: "error" });
    start(async () => {
      const r = await closeCheckAction(check.id, closeInput());
      if (r.ok) finish(r);
      else report(r);
    });
  }

  /** Lo más rápido en el mostrador: efectivo exacto, se registra y se cierra de una vez. */
  function exactCash() {
    if (tipsOn && !tipMode) return toast("Primero pregunta si incluye la propina", { tone: "error" });
    start(async () => {
      const p = await paymentAction(check.id, { method: "efectivo", amount: due, tip: Math.max(0, tipTotal - tipPaid), received: due + Math.max(0, tipTotal - tipPaid), part: "", confirmTip: tipConfirm });
      if (!report(p)) {
        if (!p.ok && p.fields?.tipConfirm) setTipConfirm(true);
        return;
      }
      const r = await closeCheckAction(check.id, closeInput());
      if (r.ok) finish(r);
      else {
        report(r);
        router.refresh();
      }
    });
  }

  function removePayment() {
    const target = removing!;
    const reason = removeReason;
    const action = (a?: Auth) => removePaymentAction(target.id, { reason, auth: a });
    start(async () => {
      const r = await action();
      if (!r.ok && r.fields?.auth) return setAuth({ label: `Quitar el pago de ${target.label}`, level: r.fields.auth as AuthLevel, run: action, done: "Pago quitado" });
      if (report(r)) {
        setRemoving(null);
        router.refresh();
      }
    });
  }

  const canExact = !done && !waiting && split === "una" && customAmount === null && config.methods.includes("efectivo") && cashOpen && due > 0 && !hasDrafts;

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4 px-3 py-4 pb-28 sm:px-5 lg:grid-cols-[1fr_1.1fr] lg:pb-4">
      {/* Resumen, propina, división, cliente y factura */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Link href={`/cuenta/${check.id}`} className="flex size-10 items-center justify-center rounded-xl hover:bg-tinto/6" aria-label="Volver a la cuenta">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold leading-tight">Cobrar · {check.label}</h1>
            <p className="text-sm text-humo">
              #{check.number} · {check.guests} personas · {check.waiter_name}
            </p>
          </div>
        </div>
        {hasDrafts ? <p className="rounded-2xl bg-cereza-soft px-4 py-3 font-semibold text-cereza">Hay productos sin enviar. Envíalos o quítalos antes de cobrar.</p> : null}
        {!cashOpen && !done ? <p className="rounded-2xl bg-fachada-soft px-4 py-3 font-semibold text-[#6b4b00]">La caja está cerrada: ábrela en Caja para cobrar. Así cada pago queda en un cierre.</p> : null}

        <div className="rounded-3xl bg-papel p-4 ring-1 ring-linea">
          <ul className="divide-y divide-linea">
            {check.items
              .filter((i) => i.status !== "void")
              .map((i) => (
                <li key={i.id} className="flex items-center gap-2 py-2">
                  {split === "consumo" ? (
                    <button
                      onClick={() => setOwner((o) => ({ ...o, [i.id]: (ownerOf(i) + 1) % Math.max(2, parts) }))}
                      className="flex h-8 min-w-14 items-center justify-center rounded-lg bg-balcon px-2 text-sm font-bold text-white"
                      disabled={i.courtesy}
                    >
                      P{ownerOf(i) + 1}
                    </button>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-semibold tnum">{i.qty}</span> {i.name}
                    {i.modifiers.length ? <span className="text-sm text-humo"> · {i.modifiers.map((m) => m.name).join(", ")}</span> : null}
                  </span>
                  {i.courtesy ? <Pill tone="green">Cortesía</Pill> : null}
                  <Money value={(i.unit_price + i.modifiers.reduce((s, m) => s + m.price, 0)) * i.qty} className={cn(i.courtesy && "text-humo line-through")} />
                </li>
              ))}
          </ul>
          <dl className="mt-3 space-y-1 border-t border-linea pt-3 text-[15px]">
            {check.totals.discount ? (
              <div className="flex justify-between text-humo">
                <dt>Descuento {check.discount_pct} %</dt>
                <dd className="tnum">−{cop(check.totals.discount)}</dd>
              </div>
            ) : null}
            {check.totals.taxes.map((t) => (
              <div key={t.rate} className="flex justify-between text-humo">
                <dt>
                  Base {cop(t.base)} · {config.taxLabel} {t.rate} %
                </dt>
                <dd className="tnum">{cop(t.tax)}</dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between pt-1">
              <dt className="font-semibold">Total consumo</dt>
              <dd className="text-2xl font-bold tnum">{cop(total)}</dd>
            </div>
          </dl>
        </div>

        {tipsOn ? (
          <div className="rounded-3xl bg-papel p-4 ring-1 ring-linea">
            <p className="font-bold">¿Incluye la propina voluntaria?</p>
            <p className="text-sm text-humo">Hay que preguntarle al cliente. La sugerida es del {config.tips.suggestedPct} % y no hace parte del impuesto.</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button onClick={() => setTipMode("si")} className={cn("h-14 rounded-xl font-semibold ring-1", tipMode === "si" ? "bg-puerta text-white ring-puerta" : "ring-linea-2")}>
                Sí · {cop(suggested)}
              </button>
              <button onClick={() => setTipMode("otro")} className={cn("h-14 rounded-xl font-semibold ring-1", tipMode === "otro" ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}>
                Otro valor
              </button>
              <button onClick={() => setTipMode("no")} className={cn("h-14 rounded-xl font-semibold ring-1", tipMode === "no" ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}>
                No
              </button>
            </div>
            {tipMode === "otro" ? (
              <div className="mt-3">
                <p className="text-center text-3xl font-bold tnum">{cop(parseInt(customTip || "0", 10))}</p>
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  {[2000, 5000, 10000].map((v) => (
                    <button key={v} onClick={() => setCustomTip(String(v))} className="h-10 rounded-xl px-3 font-semibold ring-1 ring-linea-2 tnum">
                      {cop(v)}
                    </button>
                  ))}
                </div>
                <div className="mx-auto mt-3 max-w-xs">
                  <Keypad onKey={(k) => setCustomTip((r) => typeAmount(r, k).slice(0, 7))} extra={{ label: "000", value: "000" }} />
                </div>
                {tipConfirm ? <p className="mt-3 rounded-xl bg-fachada-soft px-3 py-2 text-sm font-semibold text-[#6b4b00]">Es más del 20 % de la cuenta. Si el cliente la confirma, vuelve a registrar el pago.</p> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {!free ? (
          <div className="rounded-3xl bg-papel p-4 ring-1 ring-linea">
            <p className="font-bold">¿Cómo pagan?</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {(
                [
                  ["una", "Todo junto"],
                  ["iguales", "Partes iguales"],
                  ["consumo", "Cada quien lo suyo"],
                ] as const
              ).map(([k, label]) => (
                <button key={k} onClick={() => (setSplit(k), setPart(0), setCustomAmount(null))} className={cn("h-12 rounded-xl text-[15px] font-semibold ring-1", split === k ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}>
                  {label}
                </button>
              ))}
            </div>
            {split !== "una" ? (
              <>
                <div className="mt-3 flex flex-wrap items-center gap-2 sm:gap-3">
                  <span className="mr-1 text-sm font-semibold text-humo">{split === "iguales" ? "Partes" : "Personas"}</span>
                  {[2, 3, 4, 5, 6].map((n) => (
                    <button key={n} onClick={() => (setParts(n), setPart(0))} className={cn("size-11 rounded-xl font-bold ring-1 tnum", parts === n ? "bg-balcon text-white ring-balcon" : "ring-linea-2")}>
                      {n}
                    </button>
                  ))}
                </div>
                {split === "consumo" ? (
                  <p className="mt-2 text-sm text-humo">
                    Toca P1, P2… en cada producto para asignarlo a una persona. ¿Cada uno necesita su factura?{" "}
                    <Link href={`/cuenta/${check.id}`} className="font-semibold text-balcon underline-offset-2 hover:underline">
                      Sepárala desde la cuenta
                    </Link>{" "}
                    (Más opciones → Separar cuenta).
                  </p>
                ) : null}
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {shares.map((s, i) => {
                    const paid = paidByPart(s.label);
                    const isPaid = paid >= s.amount && s.amount > 0;
                    return (
                      <li key={s.label}>
                        <button
                          onClick={() => (setPart(i), setCustomAmount(null))}
                          className={cn("flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left ring-1", part === i ? "ring-2 ring-balcon" : "ring-linea-2", isPaid && "bg-puerta-soft")}
                        >
                          <span className="font-semibold">{s.label}</span>
                          <span className="text-right">
                            <Money value={s.amount + s.tip} className="font-bold" />
                            {isPaid ? <span className="block text-[12px] font-semibold text-puerta-2">Pagado</span> : s.tip ? <span className="block text-[12px] text-humo">con {cop(s.tip)} de propina</span> : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}

        {config.loyalty.enabled && !free ? (
          <div className="rounded-3xl bg-papel p-4 ring-1 ring-linea">
            <p className="flex items-center gap-2 font-bold">
              <Gift size={18} /> Sellos
            </p>
            {check.customer ? (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <UserRound size={18} className="text-humo" />
                <span className="font-semibold">{check.customer.name || check.customer.phone}</span>
                <span className="text-sm text-humo tnum">
                  {check.customer.stamps} de {config.loyalty.goal}
                </span>
                {check.customer.stamps >= config.loyalty.goal ? (
                  <button className={btn("warn", "sm")} disabled={pending} onClick={() => start(async () => void (report(await redeemRewardAction(check.id)) && router.refresh()))}>
                    Canjear: {config.loyalty.reward.toLowerCase()}
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="mt-2 grid gap-2">
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <input inputMode="tel" className="h-12 rounded-xl border border-linea-2 px-3 tnum outline-none focus:border-tinto" placeholder="Celular del cliente (opcional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
                  {phone.trim() ? (
                    <input
                      className="h-12 w-40 rounded-xl border border-linea-2 px-3 tnum outline-none focus:border-tinto"
                      placeholder="Cumpleaños MM-DD"
                      value={birthday}
                      onChange={(e) => setBirthday(e.target.value.replace(/[^\d-]/g, "").slice(0, 5))}
                      aria-label="Cumpleaños (mes y día)"
                    />
                  ) : null}
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5 size-5 accent-[var(--color-balcon)]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span>Autoriza usar su celular para el programa de sellos y recibir novedades del local. Puede pedir que lo borren cuando quiera (Ley 1581 de 2012).</span>
                </label>
              </div>
            )}
          </div>
        ) : null}

        {!free ? (
          <div className="rounded-3xl bg-papel p-4 ring-1 ring-linea">
            <p className="font-bold">Factura electrónica</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={() => setInvoice("consumidor")} className={cn("h-12 rounded-xl font-semibold ring-1", invoice === "consumidor" ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}>
                Consumidor final
              </button>
              <button onClick={() => setInvoice("nit")} className={cn("h-12 rounded-xl font-semibold ring-1", invoice === "nit" ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}>
                Con NIT o cédula
              </button>
            </div>
            {invoice === "nit" ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <input className="h-12 rounded-xl border border-linea-2 px-3 outline-none focus:border-tinto" placeholder="NIT o cédula" value={doc} onChange={(e) => setDoc(e.target.value)} />
                <input className="h-12 rounded-xl border border-linea-2 px-3 outline-none focus:border-tinto" placeholder="Nombre o razón social" value={docName} onChange={(e) => setDocName(e.target.value)} />
                <input className="h-12 rounded-xl border border-linea-2 px-3 outline-none focus:border-tinto sm:col-span-2" type="email" placeholder="Correo del cliente (opcional)" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* Pagos */}
      <section ref={payPanel} className="scroll-mt-4 space-y-4 lg:sticky lg:top-[72px] lg:self-start">
        {check.pendingPayments.map((p) => (
          <div key={p.id} className="rounded-3xl bg-fachada-soft p-4 ring-1 ring-fachada">
            <p className="font-bold">
              El cliente reportó un pago con {METHOD_LABEL[p.method]} de {cop(p.amount + p.tip)}
            </p>
            <p className="text-sm">Referencia {p.reference}. Confírmalo solo si ya llegó a la cuenta del local. Mientras tanto no se puede cobrar lo demás.</p>
            <div className="mt-3 flex gap-2">
              <button className={btn("soft", "md")} disabled={pending} onClick={() => start(async () => void (report(await reviewClientPaymentAction(p.id, false)) && router.refresh()))}>
                No llegó
              </button>
              <button className={btn("send", "md")} disabled={pending} onClick={() => start(async () => void (report(await reviewClientPaymentAction(p.id, true)) && router.refresh()))}>
                <Check size={18} /> Sí, llegó
              </button>
            </div>
          </div>
        ))}

        <div className="rounded-3xl bg-tinto p-4 text-cal sm:p-5">
          <div className="flex items-baseline justify-between">
            <p className="text-cal/75">{done ? (free ? "Todo fue cortesía" : "Pagado completo") : current.label ? `Cobrar ${current.label.toLowerCase()}` : "Falta por pagar"}</p>
            {check.paid ? <p className="text-sm text-cal/70">Pagado {cop(check.paid + tipPaid)}</p> : null}
          </div>
          <p className="mt-1 text-5xl font-bold tracking-tight tnum [font-stretch:105%]">{cop(done ? 0 : charge)}</p>
          {!done && tipNow ? <p className="text-sm text-cal/70">Incluye {cop(tipNow)} de propina</p> : null}
          {waiting ? <p className="mt-2 text-sm text-cal/80">{cop(pendingTotal)} por confirmar del pago que reportó el cliente.</p> : null}

          {!done ? (
            <>
              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
                {config.methods.map((m) => (
                  <button
                    key={m}
                    onClick={() => setMethod(m)}
                    className={cn("flex h-16 flex-col items-center justify-center gap-1 rounded-2xl text-[13px] font-semibold", method === m ? "bg-cal text-tinto" : "bg-white/8 hover:bg-white/14")}
                    aria-pressed={method === m}
                  >
                    {ICONS[m]}
                    {METHOD_LABEL[m]}
                  </button>
                ))}
              </div>

              {method === "efectivo" ? (
                <div className="mt-4">
                  <div className="flex items-baseline justify-between">
                    <span className="text-cal/75">Recibido</span>
                    <span className="text-3xl font-bold tnum">{received ? cop(receivedNum) : "—"}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {cashSuggestions(charge).map((v) => (
                      <button key={v} onClick={() => setReceived(String(v))} className={cn("h-11 rounded-xl px-3 font-semibold tnum", receivedNum === v ? "bg-fachada text-tinto" : "bg-white/8")}>
                        {v === charge ? "Exacto" : cop(v)}
                      </button>
                    ))}
                  </div>
                  {change > 0 ? (
                    <p className="mt-3 rounded-2xl bg-fachada px-4 py-3 text-tinto">
                      <span className="block text-sm font-semibold">Vueltas</span>
                      <span className="block text-4xl font-bold tnum">{cop(change)}</span>
                    </p>
                  ) : null}
                  <div className="mt-3">
                    <Keypad dark onKey={(k) => setReceived((r) => typeAmount(r, k))} extra={{ label: "000", value: "000" }} />
                  </div>
                </div>
              ) : (
                <div className="mt-4 space-y-2">
                  {method === "breb" ? (
                    <div className="rounded-2xl bg-white/8 px-4 py-3">
                      <p className="text-sm text-cal/75">El cliente abre su banco, entra a Bre-B y paga a la llave</p>
                      <p className="mt-1 break-all font-mono text-2xl font-bold">{config.brebKey || "— (ponla en Ajustes)"}</p>
                    </div>
                  ) : method === "nequi" ? (
                    <div className="rounded-2xl bg-white/8 px-4 py-3">
                      <p className="text-sm text-cal/75">Pago a Nequi</p>
                      <p className="mt-1 text-2xl font-bold tnum">{config.nequiPhone || "— (ponlo en Ajustes)"}</p>
                    </div>
                  ) : method === "tarjeta" ? (
                    <p className="text-[15px]">Cobra {cop(charge)} en el datáfono y escribe el número de aprobación.</p>
                  ) : (
                    <p className="text-[15px]">Pago a Daviplata del local.</p>
                  )}
                  <input
                    className="h-12 w-full rounded-xl bg-white/10 px-3 text-cal tnum outline-none placeholder:text-cal/50 focus:ring-2 focus:ring-fachada"
                    placeholder={method === "tarjeta" ? "Número de aprobación" : "Referencia del pago"}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    inputMode="numeric"
                  />
                </div>
              )}

              {customAmount !== null ? (
                <label className="mt-4 flex items-center gap-3 rounded-2xl bg-white/8 px-3 py-2">
                  <span className="text-sm text-cal/75">Valor de este pago, sin propina</span>
                  <input
                    autoFocus
                    inputMode="numeric"
                    className="h-11 flex-1 rounded-xl bg-white/10 px-3 text-right text-lg font-bold text-cal tnum outline-none focus:ring-2 focus:ring-fachada"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value.replace(/\D/g, "").slice(0, 9))}
                  />
                </label>
              ) : null}
              <div className="mt-4 flex gap-2">
                <button className={btn("light", "lg", "px-4")} onClick={() => setCustomAmount((v) => (v === null ? String(amount) : null))} aria-pressed={customAmount !== null}>
                  {customAmount === null ? "Otro valor" : "Valor completo"}
                </button>
                <button
                  className={btn("warn", "lg", "flex-1")}
                  disabled={pending || hasDrafts || waiting || !cashOpen || amount <= 0 || (method === "efectivo" && receivedNum > 0 && receivedNum < charge)}
                  onClick={() => register()}
                >
                  {tipConfirm ? "Confirmar propina y registrar" : <>Registrar <span className="max-sm:hidden">pago de</span> {cop(charge)}</>}
                </button>
              </div>
              {canExact ? (
                <button className={btn("light", "lg", "mt-2 w-full")} disabled={pending} onClick={exactCash}>
                  <Banknote size={18} /> Efectivo exacto y cerrar
                </button>
              ) : null}
            </>
          ) : (
            <button className={btn("warn", "xl", "mt-4 w-full")} disabled={pending} onClick={close}>
              <Check size={22} /> {free ? "Cerrar cuenta (sin factura)" : "Cerrar cuenta y facturar"}
            </button>
          )}
        </div>

        {check.payments.length ? (
          <div className="rounded-3xl bg-papel p-4 ring-1 ring-linea">
            <p className="font-bold">Pagos registrados</p>
            <ul className="mt-2 divide-y divide-linea">
              {check.payments.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2">
                  <span className="text-humo">{ICONS[p.method]}</span>
                  <span className="flex-1">
                    <span className="font-semibold">{METHOD_LABEL[p.method]}</span>
                    {p.part ? <span className="text-sm text-humo"> · {p.part}</span> : null}
                    {p.reference ? <span className="block text-[13px] text-humo">Ref. {p.reference}</span> : null}
                  </span>
                  <span className="text-right">
                    <Money value={p.amount + p.tip} className="font-semibold" />
                    {p.tip ? <span className="block text-[12px] text-humo">propina {cop(p.tip)}</span> : null}
                  </span>
                  {canRemove ? (
                    <button
                      className="flex size-9 items-center justify-center rounded-lg text-humo hover:bg-cereza-soft hover:text-cereza"
                      aria-label="Quitar pago"
                      onClick={() => (setRemoveReason(""), setRemoving({ id: p.id, label: `${METHOD_LABEL[p.method]} por ${cop(p.amount + p.tip)}` }))}
                    >
                      <Trash2 size={16} />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {/* En el celular el cobro queda lejos: una barra fija lleva a él (o cierra cuando ya está pagado) */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-linea bg-papel p-3 lg:hidden">
        {done ? (
          <button className={btn("warn", "lg", "w-full")} disabled={pending} onClick={close}>
            <Check size={20} /> {free ? "Cerrar cuenta" : "Cerrar cuenta y facturar"}
          </button>
        ) : (
          <button className={btn("dark", "lg", "w-full justify-between")} onClick={() => payPanel.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
            <span>{waiting ? "Pago del cliente por confirmar" : "Ir a cobrar"}</span>
            <span className="tnum">{cop(charge)}</span>
          </button>
        )}
      </div>

      <Sheet
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Quitar el pago"
        footer={
          <button className={btn("danger", "lg", "w-full")} disabled={pending || removeReason.trim().length < 3} onClick={removePayment}>
            Quitar el pago
          </button>
        }
      >
        <p className="text-[15px]">{removing?.label}. Queda en el registro con el motivo y sale en el panel del día.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {["Se registró dos veces", "Método equivocado", "El datáfono lo rechazó"].map((r) => (
            <button key={r} type="button" onClick={() => setRemoveReason(r)} className={cn("rounded-full px-3.5 py-2 text-sm font-semibold ring-1", removeReason === r ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}>
              {r}
            </button>
          ))}
        </div>
        <input className="mt-3 h-12 w-full rounded-xl border border-linea-2 px-3 outline-none focus:border-tinto" value={removeReason} onChange={(e) => setRemoveReason(e.target.value)} placeholder="Otro motivo" />
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
              setRemoving(null);
              router.refresh();
            }
          });
        }}
      />
    </div>
  );
}
