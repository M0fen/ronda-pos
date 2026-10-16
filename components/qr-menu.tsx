"use client";

import { BellRing, Check, Loader2, Minus, Plus, Receipt, ShoppingBag, Utensils } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { qrCallAction, qrCheckAction, qrOrderAction, qrPayAction } from "@/app/m/actions";
import { btn } from "@/components/ui";
import { splitEqual, suggestedTip } from "@/lib/core/pricing";
import type { Menu, MenuProduct } from "@/lib/server/menu";
import type { clientCheck } from "@/lib/server/qr";
import { cop } from "@/lib/money";
import { cn } from "@/lib/utils";
import { ModifierSheet, PriceTag } from "./order/order-sheets";
import { toast } from "./toast";

type ClientCheck = Awaited<ReturnType<typeof clientCheck>>;
type CartLine = { key: string; product: MenuProduct; qty: number; modifierIds: string[]; modifiers: { name: string; price: number }[]; note: string };

export function QrMenu({
  token,
  table,
  business,
  theme,
  menu,
  happyText,
  config,
  initialCheck,
}: {
  token: string;
  table: string;
  business: { name: string; instagram: string };
  theme: { primary: string; accent: string };
  menu: Menu;
  happyText: string | null;
  config: { qr: { enabled: boolean; requireApproval: boolean; payAtTable: boolean }; tips: { enabled: boolean; suggestedPct: number }; brebKey: string; nequiPhone: string; breb: boolean; nequi: boolean };
  initialCheck: ClientCheck;
}) {
  const [tab, setTab] = useState<"carta" | "pedido" | "cuenta">("carta");
  const [cat, setCat] = useState(menu.categories[0]?.id ?? "");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [mod, setMod] = useState<MenuProduct | null>(null);
  const [name, setName] = useState("");
  const [sent, setSent] = useState(false);
  const [check, setCheck] = useState<ClientCheck>(initialCheck);
  const [pending, start] = useTransition();
  const count = cart.reduce((s, l) => s + l.qty, 0);
  const cartTotal = cart.reduce((s, l) => s + (l.product.price + l.modifiers.reduce((a, m) => a + m.price, 0)) * l.qty, 0);

  const refresh = useCallback(async () => {
    try {
      setCheck(await qrCheckAction(token));
    } catch {}
  }, [token]);

  useEffect(() => {
    if (tab !== "cuenta") return;
    refresh();
    const t = setInterval(refresh, 6000);
    return () => clearInterval(t);
  }, [tab, refresh]);

  function add(product: MenuProduct, input: { modifierIds: string[]; qty: number; note: string }) {
    const modifiers = product.groups.flatMap((g) => menu.groups[g]?.options.filter((o) => input.modifierIds.includes(o.id)) ?? []).map((o) => ({ name: o.name, price: o.price }));
    const key = `${product.id}|${input.modifierIds.sort().join(",")}|${input.note}`;
    setCart((c) => {
      const ex = c.find((l) => l.key === key);
      if (ex) return c.map((l) => (l.key === key ? { ...l, qty: l.qty + input.qty } : l));
      return [...c, { key, product, qty: input.qty, modifierIds: input.modifierIds, modifiers, note: input.note }];
    });
    setSent(false);
    toast(`${product.name} en tu pedido`);
  }

  function sendOrder() {
    start(async () => {
      const r = await qrOrderAction(
        token,
        cart.map((l) => ({ productId: l.product.id, qty: l.qty, modifierIds: l.modifierIds, note: l.note })),
        name,
      );
      if (r.ok) {
        setCart([]);
        setSent(true);
      } else toast(r.error, { tone: "error" });
    });
  }

  function call(kind: "waiter" | "bill") {
    start(async () => {
      const r = await qrCallAction(token, kind);
      toast(r.ok ? (kind === "bill" ? "Le avisamos al mesero que quieres la cuenta" : "El mesero ya viene") : r.error, { tone: r.ok ? "ok" : "error" });
    });
  }

  const products = menu.products.filter((p) => p.categoryId === cat);

  return (
    <div className={cn("mx-auto min-h-dvh max-w-lg bg-cal", tab === "carta" && count ? "pb-40" : "pb-24")}>
      <header className="px-5 pt-6 pb-5 text-white" style={{ background: theme.primary }}>
        <p className="text-sm font-semibold text-white/80">Mesa {table}</p>
        <h1 className="mt-0.5 text-3xl font-extrabold leading-tight [font-stretch:112%]">{business.name}</h1>
        <div className="mt-4 flex gap-2">
          <button className={btn("light", "sm", "flex-1 bg-white/15")} onClick={() => call("waiter")} disabled={pending}>
            <BellRing size={16} /> Llamar al mesero
          </button>
          <button className={btn("light", "sm", "flex-1 bg-white/15")} onClick={() => call("bill")} disabled={pending}>
            <Receipt size={16} /> Pedir la cuenta
          </button>
        </div>
      </header>
      {menu.happy && happyText ? (
        <p className="px-5 py-2.5 text-sm font-semibold" style={{ background: theme.accent }}>
          {happyText}. Los precios marcados ya tienen el descuento.
        </p>
      ) : null}

      {tab === "carta" ? (
        <>
          <nav className="scrollbar-none sticky top-0 z-20 flex gap-1.5 overflow-x-auto bg-cal/95 px-4 py-3 backdrop-blur">
            {menu.categories.map((c) => (
              <button key={c.id} onClick={() => setCat(c.id)} className={cn("shrink-0 rounded-full px-4 py-2 text-sm font-semibold", cat === c.id ? "bg-tinto text-cal" : "bg-papel ring-1 ring-linea")}>
                {c.name}
              </button>
            ))}
          </nav>
          <ul className="space-y-2 px-4">
            {products.map((p) => (
              <li key={p.id} className={cn("flex items-center gap-3 rounded-2xl bg-papel p-4 ring-1 ring-linea", p.soldOut && "opacity-50")}>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-tight">{p.name}</p>
                  {p.description ? <p className="mt-0.5 text-sm text-humo">{p.description}</p> : null}
                  <div className="mt-1.5">{p.soldOut ? <span className="text-sm font-bold text-cereza">Agotado hoy</span> : <PriceTag value={p.price} base={p.basePrice} happy={p.onHappy} />}</div>
                </div>
                {config.qr.enabled && !p.soldOut ? (
                  <button
                    className="flex size-11 shrink-0 items-center justify-center rounded-full text-white"
                    style={{ background: theme.primary }}
                    onClick={() => (p.groups.length ? setMod(p) : add(p, { modifierIds: [], qty: 1, note: "" }))}
                    aria-label={`Agregar ${p.name}`}
                  >
                    <Plus size={20} />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="px-5 pt-6 text-center text-[13px] text-humo">Precios con impuesto incluido. La propina es voluntaria.</p>
        </>
      ) : tab === "pedido" ? (
        <section className="px-4 pt-4">
          {sent ? (
            <div className="rounded-3xl bg-puerta-soft p-5 text-puerta-2">
              <p className="flex items-center gap-2 text-lg font-bold">
                <Check size={20} /> Tu pedido llegó
              </p>
              <p className="mt-1 text-[15px]">{config.qr.requireApproval ? "El mesero lo confirma en un momento y pasa directo a la barra." : "Ya está en la barra."}</p>
            </div>
          ) : null}
          {cart.length ? (
            <>
              <ul className="mt-3 divide-y divide-linea rounded-2xl bg-papel px-4 ring-1 ring-linea">
                {cart.map((l) => (
                  <li key={l.key} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold leading-tight">{l.product.name}</p>
                      {l.modifiers.length || l.note ? <p className="text-sm text-humo">{[...l.modifiers.map((m) => m.name), l.note].filter(Boolean).join(" · ")}</p> : null}
                      <p className="text-sm tnum">{cop((l.product.price + l.modifiers.reduce((a, m) => a + m.price, 0)) * l.qty)}</p>
                    </div>
                    <div className="flex items-center gap-1 rounded-xl bg-tinto/5 p-1">
                      <button className="flex size-9 items-center justify-center rounded-lg" onClick={() => setCart((c) => c.map((x) => (x.key === l.key ? { ...x, qty: x.qty - 1 } : x)).filter((x) => x.qty > 0))} aria-label="Uno menos">
                        <Minus size={16} />
                      </button>
                      <span className="w-6 text-center font-bold tnum">{l.qty}</span>
                      <button className="flex size-9 items-center justify-center rounded-lg" onClick={() => setCart((c) => c.map((x) => (x.key === l.key ? { ...x, qty: x.qty + 1 } : x)))} aria-label="Uno más">
                        <Plus size={16} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <label className="mt-4 block">
                <span className="text-sm font-semibold text-humo">¿A nombre de quién? (opcional)</span>
                <input className="mt-1 h-12 w-full rounded-xl border border-linea-2 bg-papel px-3 outline-none focus:border-tinto" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Paula" />
              </label>
              <button className={btn("dark", "xl", "mt-4 w-full justify-between")} disabled={pending} onClick={sendOrder}>
                <span>{pending ? <Loader2 className="animate-spin" /> : "Enviar pedido"}</span>
                <span className="tnum">{cop(cartTotal)}</span>
              </button>
            </>
          ) : !sent ? (
            <div className="mt-8 text-center">
              <ShoppingBag className="mx-auto text-humo" />
              <p className="mt-2 font-semibold">Tu pedido está vacío</p>
              <button className={btn("soft", "md", "mt-3")} onClick={() => setTab("carta")}>
                Ver la carta
              </button>
            </div>
          ) : null}
        </section>
      ) : (
        <Bill token={token} check={check} config={config} onPaid={refresh} theme={theme} />
      )}

      {tab === "carta" && count ? (
        <div className="fixed inset-x-0 bottom-[76px] z-30 mx-auto max-w-lg px-3 pb-2">
          <button onClick={() => setTab("pedido")} className="flex h-14 w-full items-center justify-between rounded-2xl px-5 font-bold text-white shadow-lg" style={{ background: theme.primary }}>
            <span className="inline-flex items-center gap-2">
              <ShoppingBag size={20} /> Ver mi pedido · {count}
            </span>
            <span className="tnum">{cop(cartTotal)}</span>
          </button>
        </div>
      ) : null}

      <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-lg gap-1 border-t border-linea bg-papel p-2">
        {(
          [
            ["carta", "Carta", <Utensils key="c" size={20} />],
            ["pedido", count ? `Pedido (${count})` : "Pedido", <ShoppingBag key="p" size={20} />],
            ["cuenta", "Mi cuenta", <Receipt key="r" size={20} />],
          ] as const
        ).map(([k, label, icon]) => (
          <button key={k} onClick={() => setTab(k)} className={cn("flex h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[13px] font-semibold", tab === k ? "bg-tinto text-cal" : "text-tinto-2")}>
            {icon}
            {label}
          </button>
        ))}
      </nav>

      <ModifierSheet
        product={mod}
        groups={menu.groups}
        onClose={() => setMod(null)}
        onAdd={(input) => {
          const p = mod!;
          setMod(null);
          add(p, input);
        }}
      />
    </div>
  );
}

function Bill({
  token,
  check,
  config,
  onPaid,
  theme,
}: {
  token: string;
  check: ClientCheck;
  config: { qr: { payAtTable: boolean }; tips: { enabled: boolean; suggestedPct: number }; brebKey: string; nequiPhone: string; breb: boolean; nequi: boolean };
  onPaid: () => void;
  theme: { primary: string };
}) {
  const [people, setPeople] = useState(1);
  const [tip, setTip] = useState(true);
  const [method, setMethod] = useState<"breb" | "nequi">(config.breb ? "breb" : "nequi");
  const [paying, setPaying] = useState(false);
  const [reference, setReference] = useState("");
  const [pending, start] = useTransition();
  const pendingSum = check?.pending.reduce((s, p) => s + p.amount, 0) ?? 0;
  const left = Math.max(0, (check?.due ?? 0) - pendingSum);
  const share = useMemo(() => splitEqual(left, people)[0] ?? 0, [left, people]);
  const tipShare = tip && config.tips.enabled ? suggestedTip(share, config.tips.suggestedPct) : 0;

  if (!check)
    return (
      <div className="px-5 pt-10 text-center">
        <Receipt className="mx-auto text-humo" />
        <p className="mt-2 font-semibold">Aún no hay cuenta abierta en esta mesa</p>
        <p className="text-sm text-humo">Cuando pidas, aquí ves lo que llevas.</p>
      </div>
    );

  return (
    <section className="px-4 pt-4">
      <div className="rounded-3xl bg-papel p-4 ring-1 ring-linea">
        <p className="font-bold">{check.label}</p>
        <ul className="mt-2 divide-y divide-linea">
          {check.items.map((i) => (
            <li key={i.id} className="flex justify-between gap-3 py-2 text-[15px]">
              <span>
                <span className="font-semibold tnum">{i.qty}</span> {i.name}
                {i.courtesy ? <span className="ml-1 text-sm text-puerta">· cortesía</span> : null}
              </span>
              <span className={cn("tnum", i.courtesy && "text-humo line-through")}>{cop(i.unit * i.qty)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex items-baseline justify-between border-t border-linea pt-2">
          <span className="font-semibold">Total</span>
          <span className="text-2xl font-bold tnum">{cop(check.totals.total)}</span>
        </div>
        {check.paid ? <p className="text-right text-sm text-puerta-2">Ya pagado: {cop(check.paid)}</p> : null}
        {pendingSum ? <p className="text-right text-sm text-[#7a5600]">Por confirmar: {cop(pendingSum)}</p> : null}
      </div>

      {config.qr.payAtTable && left > 0 && (config.breb || config.nequi) ? (
        <div className="mt-4 rounded-3xl bg-papel p-4 ring-1 ring-linea">
          <p className="font-bold">Pagar desde tu celular</p>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-humo">Dividir entre</span>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <button key={n} onClick={() => setPeople(n)} className={cn("size-10 rounded-xl font-bold ring-1 tnum", people === n ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          {config.tips.enabled ? (
            <label className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-cal px-3 py-2.5">
              <span className="text-[15px]">
                Propina voluntaria del {config.tips.suggestedPct} % <span className="text-humo tnum">({cop(tipShare || suggestedTip(share, config.tips.suggestedPct))})</span>
              </span>
              <input type="checkbox" className="size-5" checked={tip} onChange={(e) => setTip(e.target.checked)} />
            </label>
          ) : null}
          <p className="mt-4 text-center text-sm text-humo">{people > 1 ? "Tu parte" : "Total a pagar"}</p>
          <p className="text-center text-4xl font-bold tnum">{cop(share + tipShare)}</p>
          {!paying ? (
            <button className={btn("dark", "xl", "mt-4 w-full")} onClick={() => setPaying(true)}>
              Pagar {people > 1 ? "mi parte" : "la cuenta"}
            </button>
          ) : (
            <div className="mt-4">
              <div className="grid grid-cols-2 gap-2">
                {config.breb ? (
                  <button onClick={() => setMethod("breb")} className={cn("h-12 rounded-xl font-semibold ring-1", method === "breb" ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}>
                    Bre-B
                  </button>
                ) : null}
                {config.nequi ? (
                  <button onClick={() => setMethod("nequi")} className={cn("h-12 rounded-xl font-semibold ring-1", method === "nequi" ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}>
                    Nequi
                  </button>
                ) : null}
              </div>
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-[15px]">
                {method === "breb" ? (
                  <li>
                    Abre la app de tu banco, entra a <b>Bre-B</b> y paga a la llave <b className="font-mono">{config.brebKey}</b>.
                  </li>
                ) : (
                  <li>
                    Envía a Nequi <b className="tnum">{config.nequiPhone}</b>.
                  </li>
                )}
                <li>
                  El valor es <b className="tnum">{cop(share + tipShare)}</b>.
                </li>
                <li>Escribe aquí la referencia que te da tu banco.</li>
              </ol>
              <input className="mt-3 h-12 w-full rounded-xl border border-linea-2 px-3 tnum outline-none focus:border-tinto" placeholder="Referencia del pago" value={reference} onChange={(e) => setReference(e.target.value)} />
              <button
                className={btn("dark", "xl", "mt-3 w-full")}
                style={{ background: theme.primary }}
                disabled={pending || reference.trim().length < 4}
                onClick={() =>
                  start(async () => {
                    const r = await qrPayAction(token, { method, amount: share, tip: tipShare, reference, part: people > 1 ? `Parte de 1/${people}` : "" });
                    if (r.ok) {
                      toast("Listo. El mesero confirma tu pago en un momento.");
                      setPaying(false);
                      setReference("");
                      onPaid();
                    } else toast(r.error, { tone: "error" });
                  })
                }
              >
                Ya pagué
              </button>
            </div>
          )}
        </div>
      ) : left === 0 && check.totals.total > 0 ? (
        <p className="mt-4 rounded-2xl bg-puerta-soft px-4 py-3 font-semibold text-puerta-2">Tu cuenta está pagada. ¡Gracias!</p>
      ) : null}
    </section>
  );
}
