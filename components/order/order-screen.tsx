"use client";

import { ArrowLeft, Ban, Check, CheckCheck, ChefHat, Clock, Gift, MoreHorizontal, Receipt, Search, Send, Star, StickyNote, UserRound, Users, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useOptimistic, useState, useTransition } from "react";
import {
  addItemsAction,
  attachCustomerAction,
  billAction,
  changeDraftAction,
  courtesyAction,
  deliveredAction,
  discardCheckAction,
  discountAction,
  sendRoundAction,
  soldOutAction,
  updateCheckAction,
  voidItemAction,
} from "@/app/(pos)/actions";
import { btn, Money, Pill } from "@/components/ui";
import { checkTotals } from "@/lib/core/pricing";
import { fmtTime, minutesAgo } from "@/lib/format";
import type { CheckItem, CheckView } from "@/lib/server/checks";
import type { Menu, MenuProduct } from "@/lib/server/menu";
import { cop } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Sheet } from "../sheet";
import { report, toast } from "../toast";
import { AuthSheet, CustomerSheet, DiscountSheet, GuestsSheet, ItemSheet, ModifierSheet, MoveSheet, NoteSheet, PriceTag, Stepper } from "./order-sheets";

type Result = { ok: boolean; error?: string; message?: string; data?: unknown; fields?: Record<string, string> };
type Optimistic = { type: "add"; item: CheckItem } | { type: "qty"; id: string; qty: number };

let tmp = 0;

export function OrderScreen({
  check,
  menu,
  freeTables,
  perms,
  rules,
}: {
  check: CheckView;
  menu: Menu;
  freeTables: { id: string; name: string; zone: string }[];
  perms: { voidSent: boolean; manage: boolean; charge: boolean };
  rules: { discountLimitPct: number; loyaltyGoal: number; reward: string; loyalty: boolean };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [items, apply] = useOptimistic(check.items, (state: CheckItem[], op: Optimistic) => {
    if (op.type === "add") return [...state, op.item];
    return op.qty <= 0 ? state.filter((i) => i.id !== op.id) : state.map((i) => (i.id === op.id ? { ...i, qty: op.qty } : i));
  });
  const favorites = menu.products.filter((p) => p.favorite);
  const [category, setCategory] = useState<string>(favorites.length ? "fav" : (menu.categories[0]?.id ?? ""));
  const [query, setQuery] = useState("");
  const [stockMode, setStockMode] = useState(false);
  const [modProduct, setModProduct] = useState<MenuProduct | null>(null);
  const [itemSheet, setItemSheet] = useState<CheckItem | null>(null);
  const [noteItem, setNoteItem] = useState<CheckItem | null>(null);
  const [sheet, setSheet] = useState<"menu" | "discount" | "customer" | "move" | "guests" | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [auth, setAuth] = useState<{ label: string; run: (pin: string) => Promise<Result> } | null>(null);

  const totals = useMemo(
    () => checkTotals(items.map((i) => ({ unitPrice: i.unit_price, qty: i.qty, modifiers: i.modifiers, taxRate: Number(i.tax_rate), status: i.status, courtesy: i.courtesy })), check.discount_pct),
    [items, check.discount_pct],
  );
  const drafts = items.filter((i) => i.status === "draft");
  const ready = items.filter((i) => i.status === "ready");
  const readyUnits = ready.reduce((s, i) => s + i.qty, 0);
  const sentRounds = useMemo(() => {
    const map = new Map<number, CheckItem[]>();
    for (const i of items.filter((x) => x.status !== "draft")) map.set(i.round, [...(map.get(i.round) ?? []), i]);
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [items]);
  const countByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) if (i.status !== "void" && i.product_id) m.set(i.product_id, (m.get(i.product_id) ?? 0) + i.qty);
    return m;
  }, [items]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) return menu.products.filter((p) => p.name.toLowerCase().includes(q));
    if (category === "fav") return favorites;
    return menu.products.filter((p) => p.categoryId === category);
  }, [query, category, menu.products, favorites]);

  /** Ejecuta una acción; si pide autorización, abre el PIN del encargado y reintenta. */
  function run(action: (pin?: string) => Promise<Result>, label: string, done?: string, after?: () => void) {
    start(async () => {
      const r = await action();
      if (!r.ok && r.fields?.auth) {
        setAuth({ label, run: (pin) => action(pin) });
        return;
      }
      if (report(r, done)) {
        after?.();
        router.refresh();
      }
    });
  }

  function add(product: MenuProduct, input: { modifierIds: string[]; qty: number; note: string } = { modifierIds: [], qty: 1, note: "" }) {
    if (stockMode) {
      start(async () => {
        if (report(await soldOutAction(product.id, !product.soldOut))) router.refresh();
      });
      return;
    }
    if (product.soldOut) return toast(`${product.name} está agotado`, { tone: "error" });
    const chosen = product.groups.flatMap((g) => menu.groups[g]?.options.filter((o) => input.modifierIds.includes(o.id)) ?? []);
    start(async () => {
      apply({
        type: "add",
        item: {
          id: `tmp-${++tmp}`,
          product_id: product.id,
          name: product.name,
          unit_price: product.price,
          qty: input.qty,
          modifiers: chosen.map((o) => ({ name: o.name, price: o.price })),
          note: input.note,
          station: product.station,
          tax_rate: product.taxRate,
          status: "draft",
          round: 0,
          courtesy: false,
          source: "staff",
          sent_at: null,
          ready_at: null,
          delivered_at: null,
          void_reason: null,
          created_at: new Date().toISOString(),
        },
      });
      const r = await addItemsAction(check.id, [{ productId: product.id, qty: input.qty, modifierIds: input.modifierIds, note: input.note }]);
      if (!report(r)) return;
      router.refresh();
    });
  }

  function tapProduct(p: MenuProduct) {
    if (!stockMode && p.groups.length && !p.soldOut) return setModProduct(p);
    add(p);
  }

  function changeQty(item: CheckItem, qty: number) {
    if (item.id.startsWith("tmp-")) return;
    start(async () => {
      apply({ type: "qty", id: item.id, qty });
      if (report(await changeDraftAction(item.id, { qty }))) router.refresh();
    });
  }

  function send() {
    start(async () => {
      const r = await sendRoundAction(check.id);
      if (r.ok && r.data) {
        const st = r.data.stations.map((s: string) => (s === "cocina" ? "cocina" : "barra")).join(" y ");
        toast(`Enviado a ${st}`);
        setPanelOpen(false);
        router.refresh();
      } else report(r);
    });
  }

  const header = (
    <div className="flex items-center gap-2 border-b border-linea px-4 py-3">
      <Link href="/salon" className="-ml-2 flex size-10 items-center justify-center rounded-xl hover:bg-tinto/6" aria-label="Volver al salón">
        <ArrowLeft size={20} />
      </Link>
      <div className="min-w-0 flex-1">
        <p className="truncate text-lg font-bold leading-tight">{check.label}</p>
        <p className="text-[13px] text-humo">
          #{check.number} · {check.waiter_name ?? "—"} · <span suppressHydrationWarning>{minutesAgo(check.opened_at)}</span> min
        </p>
      </div>
      <button className={btn("ghost", "sm")} onClick={() => setSheet("guests")} aria-label="Personas">
        <Users size={16} /> {check.guests}
      </button>
      <button className={btn("ghost", "sm", "w-10 px-0")} onClick={() => setSheet("menu")} aria-label="Más opciones">
        <MoreHorizontal size={20} />
      </button>
    </div>
  );

  const lines = (
    <div className="flex-1 overflow-y-auto px-4 py-3">
      {check.customer ? (
        <button onClick={() => setSheet("customer")} className="mb-3 flex w-full items-center gap-2 rounded-xl bg-puerta-soft px-3 py-2 text-left text-sm">
          <UserRound size={16} className="text-puerta-2" />
          <span className="flex-1 truncate font-semibold">{check.customer.name || check.customer.phone}</span>
          <span className="tnum text-puerta-2">
            {check.customer.stamps}/{rules.loyaltyGoal} sellos
          </span>
        </button>
      ) : null}
      {drafts.length ? (
        <section>
          <p className="mb-1.5 text-[13px] font-bold text-balcon">Por enviar</p>
          <ul className="divide-y divide-linea rounded-2xl bg-balcon-soft/60 px-3">
            {drafts.map((i) => (
              <li key={i.id} className="flex items-center gap-2 py-2.5">
                <Stepper size="sm" value={i.qty} onChange={(v) => changeQty(i, v)} min={1} />
                <button className="min-w-0 flex-1 text-left" onClick={() => !i.id.startsWith("tmp-") && setNoteItem(i)}>
                  <span className="block truncate font-semibold leading-tight">{i.name}</span>
                  {i.modifiers.length || i.note ? (
                    <span className="block truncate text-[13px] text-humo">{[...i.modifiers.map((m) => m.name), i.note && `“${i.note}”`].filter(Boolean).join(" · ")}</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[12px] text-humo">
                      <StickyNote size={12} /> Nota
                    </span>
                  )}
                </button>
                <Money value={(i.unit_price + i.modifiers.reduce((s, m) => s + m.price, 0)) * i.qty} className="text-[15px] font-semibold" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {sentRounds.map(([round, list]) => (
        <section key={round} className="mt-4 first:mt-0">
          <p className="mb-1 text-[13px] font-bold text-humo">
            Ronda {round}
            {list[0]?.sent_at ? ` · ${fmtTime(list[0].sent_at)}` : ""}
            {list.some((i) => i.source === "qr") ? " · por QR" : ""}
          </p>
          <ul className="divide-y divide-linea">
            {list.map((i) => (
              <li key={i.id}>
                <button className="flex w-full items-center gap-2.5 py-2 text-left" onClick={() => i.status !== "void" && setItemSheet(i)} disabled={i.status === "void"}>
                  <StatusIcon status={i.status} />
                  <span className={cn("min-w-0 flex-1", i.status === "void" && "text-humo line-through")}>
                    <span className="block truncate leading-tight">
                      <span className="font-semibold tnum">{i.qty}</span> {i.name}
                    </span>
                    {i.modifiers.length || i.note || i.void_reason ? (
                      <span className="block truncate text-[13px] text-humo no-underline">{[...i.modifiers.map((m) => m.name), i.note, i.void_reason && `Anulado: ${i.void_reason}`].filter(Boolean).join(" · ")}</span>
                    ) : null}
                  </span>
                  {i.courtesy ? <Pill tone="green">Cortesía</Pill> : null}
                  <Money
                    value={(i.unit_price + i.modifiers.reduce((s, m) => s + m.price, 0)) * i.qty}
                    className={cn("text-[15px]", (i.courtesy || i.status === "void") && "text-humo line-through")}
                  />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!items.length ? (
        <div className="flex h-full flex-col items-center justify-center py-10 text-center text-humo">
          <p className="font-semibold text-tinto">La cuenta está vacía</p>
          <p className="mt-1 text-sm">Toca un producto para agregarlo.</p>
        </div>
      ) : null}
    </div>
  );

  const footer = (
    <div className="border-t border-linea bg-papel px-4 py-3">
      {ready.length ? (
        <div className="mb-3 flex items-center gap-2 rounded-xl bg-puerta-soft px-3 py-2 text-puerta-2">
          <Check size={18} />
          <span className="flex-1 text-sm font-semibold">
            {readyUnits} {readyUnits === 1 ? "listo" : "listos"} para llevar a la mesa
          </span>
          <button className={btn("send", "sm")} disabled={pending} onClick={() => run(() => deliveredAction(check.id), "", "Entregado")}>
            Entregado
          </button>
        </div>
      ) : null}
      <dl className="space-y-0.5 text-[15px]">
        {totals.discount ? (
          <>
            <div className="flex justify-between text-humo">
              <dt>Subtotal</dt>
              <dd className="tnum">{cop(totals.gross)}</dd>
            </div>
            <div className="flex justify-between text-humo">
              <dt>Descuento {check.discount_pct} %</dt>
              <dd className="tnum">−{cop(totals.discount)}</dd>
            </div>
          </>
        ) : null}
        <div className="flex items-baseline justify-between">
          <dt className="font-semibold">Total</dt>
          <dd className="text-2xl font-bold tnum">{cop(totals.total)}</dd>
        </div>
      </dl>
      <div className="mt-3 flex gap-2">
        {drafts.length ? (
          <button className={btn("send", "xl", "flex-1")} disabled={pending || drafts.some((d) => d.id.startsWith("tmp-"))} onClick={send}>
            <Send size={20} /> Enviar {drafts.reduce((s, i) => s + i.qty, 0)}
          </button>
        ) : (
          <>
            <a
              href={`/recibo/${check.id}?modo=precuenta`}
              target="_blank"
              className={btn("soft", "xl", "px-4")}
              onClick={() => check.status === "open" && totals.total > 0 && start(async () => void (await billAction(check.id, true)))}
            >
              <Receipt size={20} /> <span className="hidden sm:inline">Pre-cuenta</span>
            </a>
            {perms.charge ? (
              <Link href={`/cuenta/${check.id}/cobro`} className={btn("primary", "xl", cn("flex-1", !totals.total && "pointer-events-none opacity-40"))} aria-disabled={!totals.total}>
                Cobrar {cop(totals.total)}
              </Link>
            ) : (
              <span className="flex flex-1 items-center justify-center text-sm text-humo">El cobro lo hace caja</span>
            )}
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="grid h-[calc(100dvh-57px)] grid-cols-1 md:grid-cols-[1fr_340px] lg:grid-cols-[190px_1fr_380px]">
      {/* Categorías en columna (tablet horizontal) */}
      <nav className="hidden overflow-y-auto border-r border-linea bg-papel/50 p-2 lg:block" aria-label="Categorías">
        <CategoryButtons menu={menu} favorites={favorites.length > 0} category={category} setCategory={(c) => (setCategory(c), setQuery(""))} vertical />
      </nav>

      {/* Productos */}
      <section className="flex min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-linea px-3 py-2.5">
          <label className="relative flex-1">
            <Search size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-humo" />
            <input className="h-11 w-full rounded-xl bg-tinto/5 pr-3 pl-10 outline-none focus:bg-papel focus:ring-2 focus:ring-tinto" placeholder="Buscar en la carta" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <button onClick={() => setStockMode((s) => !s)} className={btn(stockMode ? "danger" : "soft", "sm")} aria-pressed={stockMode}>
            <Ban size={16} /> {stockMode ? "Listo" : "Agotados"}
          </button>
        </div>
        <div className="scrollbar-none flex gap-1.5 overflow-x-auto border-b border-linea px-3 py-2 lg:hidden">
          <CategoryButtons menu={menu} favorites={favorites.length > 0} category={category} setCategory={(c) => (setCategory(c), setQuery(""))} />
        </div>
        {stockMode ? <p className="bg-cereza-soft px-4 py-2 text-sm font-semibold text-cereza">Toca un producto para marcarlo agotado o disponible.</p> : null}
        {menu.happy ? <p className="bg-fachada-soft px-4 py-2 text-sm font-semibold text-[#6b4b00]">{menu.happyLabel} activo: los precios en amarillo ya tienen el descuento.</p> : null}
        <div className="flex-1 overflow-y-auto p-3 pb-28 md:pb-3">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-2">
            {visible.map((p) => {
              const color = menu.categories.find((c) => c.id === p.categoryId)?.color ?? "#24150F";
              const n = countByProduct.get(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => tapProduct(p)}
                  className={cn(
                    "relative flex min-h-[88px] flex-col justify-between rounded-2xl bg-papel p-3 pl-4 text-left ring-1 ring-linea transition active:scale-[0.98] hover:ring-tinto",
                    p.soldOut && "opacity-45",
                    stockMode && "ring-2 ring-cereza/40",
                  )}
                  style={{ boxShadow: `inset 5px 0 0 ${color}` }}
                >
                  <span className="line-clamp-2 text-[15px] font-semibold leading-tight">{p.name}</span>
                  <span className="mt-2 flex items-center justify-between gap-1">
                    {p.soldOut ? <span className="text-sm font-bold text-cereza">Agotado</span> : <PriceTag value={p.price} base={p.basePrice} happy={p.onHappy} />}
                    {p.groups.length ? <span className="text-[12px] text-humo">opciones</span> : null}
                  </span>
                  {n ? <span className="absolute -top-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full bg-tinto text-[12px] font-bold text-cal tnum">{n}</span> : null}
                </button>
              );
            })}
          </div>
          {!visible.length ? <p className="py-10 text-center text-humo">No hay productos con ese nombre.</p> : null}
        </div>
      </section>

      {/* Cuenta: columna fija en tablet, hoja inferior en el teléfono */}
      <aside className="hidden min-h-0 flex-col border-l border-linea bg-papel md:flex">
        {header}
        {lines}
        {footer}
      </aside>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-linea bg-papel p-3 md:hidden">
        <button className={btn(drafts.length ? "send" : "dark", "lg", "w-full justify-between")} onClick={() => setPanelOpen(true)}>
          <span>{drafts.length ? `Ver y enviar (${drafts.reduce((s, i) => s + i.qty, 0)})` : `Ver cuenta · ${check.label}`}</span>
          <span className="tnum">{cop(totals.total)}</span>
        </button>
      </div>
      {panelOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-papel md:hidden" role="dialog" aria-modal="true" aria-label="Cuenta">
          <div className="flex justify-end px-2 pt-2">
            <button className="flex size-10 items-center justify-center rounded-full hover:bg-tinto/6" onClick={() => setPanelOpen(false)} aria-label="Cerrar cuenta">
              <X size={20} />
            </button>
          </div>
          {header}
          {lines}
          {footer}
        </div>
      ) : null}

      <ModifierSheet
        product={modProduct}
        groups={menu.groups}
        onClose={() => setModProduct(null)}
        onAdd={(input) => {
          const p = modProduct!;
          setModProduct(null);
          add(p, input);
        }}
      />
      <NoteSheet
        item={noteItem}
        onClose={() => setNoteItem(null)}
        onSave={(note) => {
          const id = noteItem!.id;
          setNoteItem(null);
          run(() => changeDraftAction(id, { note }), "", "Nota guardada");
        }}
      />
      <ItemSheet
        item={itemSheet}
        onClose={() => setItemSheet(null)}
        onDelivered={() => {
          setItemSheet(null);
          run(() => deliveredAction(check.id), "", "Entregado");
        }}
        onCourtesy={() => {
          const id = itemSheet!.id;
          setItemSheet(null);
          run((pin) => courtesyAction(id, pin), "Dar una cortesía", "Listo");
        }}
        onVoid={(reason, waste) => {
          const it = itemSheet!;
          setItemSheet(null);
          run((pin) => voidItemAction(it.id, { reason, waste, pin }), `Anular ${it.qty} ${it.name}`, "Anulado");
        }}
      />
      <AuthSheet
        label={auth?.label ?? null}
        onClose={() => setAuth(null)}
        onPin={(pin) => {
          const a = auth!;
          start(async () => {
            const r = await a.run(pin);
            if (report(r, "Autorizado")) {
              setAuth(null);
              router.refresh();
            }
          });
        }}
      />
      <DiscountSheet
        open={sheet === "discount"}
        current={check.discount_pct}
        limit={rules.discountLimitPct}
        onClose={() => setSheet(null)}
        onApply={(pct, reason) => {
          setSheet(null);
          run((pin) => discountAction(check.id, { pct, reason, pin }), `Descuento del ${pct} %`, pct ? "Descuento aplicado" : "Descuento quitado");
        }}
      />
      <CustomerSheet
        open={sheet === "customer"}
        customer={check.customer}
        goal={rules.loyaltyGoal}
        reward={rules.reward}
        onClose={() => setSheet(null)}
        onSave={(input) => {
          setSheet(null);
          run(() => attachCustomerAction(check.id, input), "", "Cliente agregado");
        }}
      />
      <MoveSheet
        open={sheet === "move"}
        tables={freeTables}
        onClose={() => setSheet(null)}
        onMove={(tableId) => {
          setSheet(null);
          run(() => updateCheckAction(check.id, { tableId }), "", "Cuenta movida");
        }}
      />
      <GuestsSheet
        open={sheet === "guests"}
        value={check.guests}
        onClose={() => setSheet(null)}
        onSave={(guests) => {
          setSheet(null);
          run(() => updateCheckAction(check.id, { guests }), "", "Listo");
        }}
      />
      <Sheet open={sheet === "menu"} onClose={() => setSheet(null)} title={check.label}>
        <div className="grid gap-2">
          <button className={btn("soft", "lg", "justify-start")} onClick={() => setSheet("move")}>
            Mover a otra mesa
          </button>
          <button className={btn("soft", "lg", "justify-start")} onClick={() => setSheet("guests")}>
            Cambiar personas ({check.guests})
          </button>
          <button className={btn("soft", "lg", "justify-start")} onClick={() => setSheet("discount")}>
            Descuento {check.discount_pct ? `(${check.discount_pct} %)` : ""}
          </button>
          {rules.loyalty ? (
            <button className={btn("soft", "lg", "justify-start")} onClick={() => setSheet("customer")}>
              <Gift size={18} /> Cliente y sellos
            </button>
          ) : null}
          {check.status === "bill" ? (
            <button className={btn("soft", "lg", "justify-start")} onClick={() => (setSheet(null), run(() => billAction(check.id, false), "", "La cuenta sigue abierta"))}>
              Seguir pidiendo (quitar pre-cuenta)
            </button>
          ) : null}
          {!items.some((i) => i.status !== "draft" && i.status !== "void") ? (
            <button
              className={btn("soft", "lg", "justify-start text-cereza")}
              onClick={() => {
                setSheet(null);
                start(async () => {
                  const r = await discardCheckAction(check.id);
                  if (report(r)) router.replace("/salon");
                });
              }}
            >
              Descartar cuenta vacía
            </button>
          ) : null}
        </div>
      </Sheet>
    </div>
  );
}

function CategoryButtons({ menu, favorites, category, setCategory, vertical }: { menu: Menu; favorites: boolean; category: string; setCategory: (c: string) => void; vertical?: boolean }) {
  const items = [...(favorites ? [{ id: "fav", name: "Lo más pedido", color: "#24150F" }] : []), ...menu.categories];
  return (
    <>
      {items.map((c) => (
        <button
          key={c.id}
          onClick={() => setCategory(c.id)}
          className={cn(
            "flex items-center gap-2.5 rounded-xl text-left font-semibold transition",
            vertical ? "mb-1 w-full px-3 py-3 text-[15px]" : "shrink-0 px-3 py-2 text-sm",
            category === c.id ? "bg-tinto text-cal" : "text-tinto-2 hover:bg-tinto/6",
          )}
        >
          {c.id === "fav" ? <Star size={14} className="shrink-0" /> : <span className="size-3 shrink-0 rounded-full" style={{ background: c.color }} />}
          {c.name}
        </button>
      ))}
    </>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "sent") return <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-fachada-soft text-[#7a5600]" title="En preparación"><Clock size={15} /></span>;
  if (status === "ready") return <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-puerta text-white" title="Listo"><ChefHat size={15} /></span>;
  if (status === "delivered") return <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-tinto/6 text-humo" title="Entregado"><CheckCheck size={15} /></span>;
  if (status === "void") return <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-cereza-soft text-cereza" title="Anulado"><X size={15} /></span>;
  return null;
}
