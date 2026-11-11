"use client";

import {
  ArrowLeft,
  ArrowRightLeft,
  Ban,
  Check,
  CheckCheck,
  ChefHat,
  Clock,
  Gift,
  LayoutGrid,
  Merge,
  MoreHorizontal,
  Pause,
  Percent,
  Play,
  Receipt,
  Repeat2,
  Search,
  Send,
  Split,
  Star,
  StickyNote,
  Trash2,
  TriangleAlert,
  UserRound,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useOptimistic, useState, useTransition } from "react";
import {
  addItemsAction,
  attachCustomerAction,
  billAction,
  changeDraftAction,
  changeWaiterAction,
  courtesyAction,
  deliveredAction,
  discardCheckAction,
  discountAction,
  mergeChecksAction,
  moveItemsAction,
  repeatRoundAction,
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
import { AuthSheet, type AuthLevel, type AuthRequest, type Authorizer } from "../auth-sheet";
import {
  CustomerSheet,
  DiscountSheet,
  DraftSheet,
  GuestsSheet,
  ItemSheet,
  MergeSheet,
  ModifierSheet,
  MoveItemsSheet,
  MoveSheet,
  PriceTag,
  Stepper,
  WaiterSheet,
  type OpenCheckOption,
} from "./order-sheets";

type Result = { ok: boolean; error?: string; message?: string; data?: unknown; fields?: Record<string, string> };
type Auth = { id: string; pin: string };
type Optimistic = { type: "add"; item: CheckItem } | { type: "qty"; id: string; qty: number };

let tmp = 0;

export function OrderScreen({
  check,
  menu,
  freeTables,
  perms,
  rules,
  authorizers,
  meId,
  siblings,
  others,
  team,
  lists,
}: {
  check: CheckView;
  menu: Menu;
  freeTables: { id: string; name: string; zone: string }[];
  perms: { voidSent: boolean; manage: boolean; charge: boolean };
  rules: { discountLimitPct: number; loyaltyGoal: number; reward: string; loyalty: boolean };
  authorizers: Authorizer[];
  meId: string;
  /** Las otras cuentas de la misma mesa (cuentas aparte) */
  siblings: { id: string; label: string; total: number }[];
  /** Otras cuentas abiertas, para pasar productos o unirlas */
  others: OpenCheckOption[];
  /** Quiénes pueden llevar la cuenta */
  team: { id: string; name: string; color: string }[];
  /** Motivos y notas rápidas del local */
  lists: { void: string[]; courtesy: string[]; discount: string[]; notes: string[] };
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
  const [draftItem, setDraftItem] = useState<CheckItem | null>(null);
  const [moving, setMoving] = useState<{ mode: "move" | "split"; preselect: string | null } | null>(null);
  const [sheet, setSheet] = useState<"menu" | "discount" | "customer" | "move" | "guests" | "merge" | "waiter" | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [auth, setAuth] = useState<(AuthRequest & { run: (auth: Auth) => Promise<Result>; done?: string }) | null>(null);

  const totals = useMemo(
    () => checkTotals(items.map((i) => ({ unitPrice: i.unit_price, qty: i.qty, modifiers: i.modifiers, taxRate: Number(i.tax_rate), status: i.status, courtesy: i.courtesy })), check.discount_pct),
    [items, check.discount_pct],
  );
  const drafts = items.filter((i) => i.status === "draft");
  // Lo retenido no sale con el envío: se manda aparte cuando la mesa esté lista
  const sendNow = drafts.filter((i) => !i.held);
  const heldDrafts = drafts.filter((i) => i.held);
  const sendUnits = sendNow.reduce((s, i) => s + i.qty, 0);
  const heldUnits = heldDrafts.reduce((s, i) => s + i.qty, 0);
  const movable = items.filter((i) => i.status !== "void" && !i.id.startsWith("tmp-"));
  // Una cuenta toda en cortesía (total $0) también se cierra
  const chargeable = items.some((i) => i.status !== "draft" && i.status !== "void");
  const ready = items.filter((i) => i.status === "ready");
  const readyUnits = ready.reduce((s, i) => s + i.qty, 0);
  const sentRounds = useMemo(() => {
    const map = new Map<number, CheckItem[]>();
    for (const i of items.filter((x) => x.status !== "draft")) map.set(i.round, [...(map.get(i.round) ?? []), i]);
    // Dentro de cada ronda, por puesto: así se lee quién pidió qué
    for (const list of map.values()) list.sort((a, b) => (a.seat ?? 99) - (b.seat ?? 99));
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

  /** Ejecuta una acción; si pide autorización, abre la hoja para que otra persona autorice con su PIN, y reintenta. */
  function run(action: (auth?: Auth) => Promise<Result>, label: string, done?: string, after?: () => void) {
    start(async () => {
      const r = await action();
      if (!r.ok && r.fields?.auth) {
        setAuth({ label, level: r.fields.auth as AuthLevel, run: (a) => action(a), done });
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
          allergy: false,
          held: false,
          seat: null,
          voided_at: null,
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

  function send(held = false) {
    start(async () => {
      const r = await sendRoundAction(check.id, held);
      if (r.ok && r.data) {
        const st = r.data.stations.map((s: string) => (s === "cocina" ? "cocina" : "barra")).join(" y ");
        toast(held ? `Lo retenido salió a ${st}` : `Enviado a ${st}`);
        setPanelOpen(false);
        router.refresh();
      } else report(r);
    });
  }

  /** Otra ronda igual: queda por enviar para revisarla. */
  function repeat(round: number) {
    start(async () => {
      const r = await repeatRoundAction(check.id, round);
      if (!r.ok || !r.data) return void report(r);
      toast(r.data.missing.length ? `Agregado para enviar. No hay: ${r.data.missing.join(", ")}` : `Ronda ${round} agregada: revísala y envíala`);
      router.refresh();
    });
  }

  function move(input: Parameters<typeof moveItemsAction>[1]) {
    setMoving(null);
    start(async () => {
      const r = await moveItemsAction(check.id, input);
      if (!r.ok || !r.data) return void report(r);
      const d = r.data;
      toast("split" in input.to ? `Listo: ${d.name || `cuenta #${d.number}`} en la mesa` : `Pasado a la cuenta #${d.number}`);
      // Si esta cuenta quedó vacía se cerró: se sigue en la cuenta a donde se fue todo
      if (d.closed) router.replace(`/cuenta/${d.id}`);
      else router.refresh();
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
      {siblings.length ? (
        <div className="mb-3 rounded-2xl bg-tinto/5 p-2">
          <p className="px-1 pb-1.5 text-[12px] font-semibold text-humo">En esta mesa también</p>
          <div className="flex flex-wrap gap-1.5">
            {siblings.map((x) => (
              <Link key={x.id} href={`/cuenta/${x.id}`} className="inline-flex items-center gap-2 rounded-xl bg-papel px-3 py-1.5 text-sm font-semibold ring-1 ring-linea hover:ring-tinto">
                {x.label}
                <Money value={x.total} className="text-humo" />
              </Link>
            ))}
          </div>
        </div>
      ) : null}
      {check.customer ? (
        <button onClick={() => setSheet("customer")} className="mb-3 flex w-full items-center gap-2 rounded-xl bg-puerta-soft px-3 py-2 text-left text-sm">
          <UserRound size={16} className="text-puerta-2" />
          <span className="flex-1 truncate font-semibold">{check.customer.name || check.customer.phone}</span>
          <span className="tnum text-puerta-2">
            {check.customer.stamps}/{rules.loyaltyGoal} sellos
          </span>
        </button>
      ) : null}
      {sendNow.length ? (
        <section>
          <p className="mb-1.5 text-[13px] font-bold text-balcon">Por enviar</p>
          <ul className="divide-y divide-linea rounded-2xl bg-balcon-soft/60 px-3">
            {sendNow.map((i) => (
              <DraftLine key={i.id} item={i} onQty={(v) => changeQty(i, v)} onOpen={() => !i.id.startsWith("tmp-") && setDraftItem(i)} />
            ))}
          </ul>
        </section>
      ) : null}
      {heldDrafts.length ? (
        <section className={cn(sendNow.length > 0 && "mt-4")}>
          <p className="mb-1.5 flex items-center gap-2 text-[13px] font-bold text-tinto-2">
            <Pause size={14} />
            <span className="flex-1">Retenido: sale después</span>
            {sendNow.length ? (
              <button className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-balcon hover:bg-balcon-soft" disabled={pending} onClick={() => send(true)}>
                <Play size={14} /> Enviar ahora
              </button>
            ) : null}
          </p>
          <ul className="divide-y divide-linea rounded-2xl bg-tinto/5 px-3">
            {heldDrafts.map((i) => (
              <DraftLine key={i.id} item={i} onQty={(v) => changeQty(i, v)} onOpen={() => setDraftItem(i)} />
            ))}
          </ul>
        </section>
      ) : null}
      {sentRounds.map(([round, list]) => (
        <section key={round} className="mt-4 first:mt-0">
          <p className="mb-1 flex items-center gap-2 text-[13px] font-bold text-humo">
            <span className="min-w-0 flex-1 truncate">
              Ronda {round}
              {list[0]?.sent_at ? ` · ${fmtTime(list[0].sent_at)}` : ""}
              {list.some((i) => i.source === "qr") ? " · por QR" : ""}
            </span>
            {list.some((i) => i.status !== "void") ? (
              <button className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-balcon hover:bg-balcon-soft" disabled={pending} onClick={() => repeat(round)} aria-label={`Repetir la ronda ${round}`}>
                <Repeat2 size={14} /> Repetir
              </button>
            ) : null}
          </p>
          <ul className="divide-y divide-linea">
            {list.map((i) => (
              <li key={i.id}>
                <button className="flex w-full items-center gap-2.5 py-2 text-left" onClick={() => i.status !== "void" && setItemSheet(i)} disabled={i.status === "void"}>
                  <StatusIcon status={i.status} />
                  <span className={cn("min-w-0 flex-1", i.status === "void" && "text-humo line-through")}>
                    <span className="block truncate leading-tight">
                      <span className="font-semibold tnum">{i.qty}</span> {i.name}
                      {i.seat ? <SeatChip n={i.seat} /> : null}
                    </span>
                    {i.allergy || i.modifiers.length || i.note || i.void_reason ? (
                      <span className="block truncate text-[13px] text-humo no-underline">
                        {i.allergy ? <TriangleAlert size={12} className="mr-1 inline text-cereza" aria-label="Alergia" /> : null}
                        {[...i.modifiers.map((m) => m.name), i.note, i.void_reason && `Anulado: ${i.void_reason}`].filter(Boolean).join(" · ")}
                      </span>
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
        {sendNow.length ? (
          <button className={btn("send", "xl", "flex-1")} disabled={pending || sendNow.some((d) => d.id.startsWith("tmp-"))} onClick={() => send()}>
            <Send size={20} /> Enviar {sendUnits}
            {heldUnits ? <span className="text-[15px] font-semibold opacity-80">· {heldUnits} esperan</span> : null}
          </button>
        ) : heldDrafts.length ? (
          <button className={btn("dark", "xl", "flex-1")} disabled={pending} onClick={() => send(true)}>
            <Play size={20} /> Enviar lo retenido ({heldUnits})
          </button>
        ) : (
          <>
            {totals.total > 0 ? (
              <a
                href={`/recibo/${check.id}?modo=precuenta`}
                target="_blank"
                className={btn("soft", "xl", "px-4")}
                onClick={() => check.status === "open" && start(async () => void (await billAction(check.id, true)))}
              >
                <Receipt size={20} /> <span className="hidden max-md:sm:inline lg:inline">Pre-cuenta</span>
              </a>
            ) : null}
            {perms.charge ? (
              <Link href={`/cuenta/${check.id}/cobro`} className={btn("primary", "xl", cn("flex-1", !chargeable && "pointer-events-none opacity-40"))} aria-disabled={!chargeable}>
                {totals.total > 0 ? `Cobrar ${cop(totals.total)}` : "Cerrar cuenta"}
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
    // minmax(0, 1fr): la columna de productos se encoge en una tablet en vertical y la cuenta no se sale de la pantalla
    <div className="grid h-[calc(100dvh-57px)] grid-cols-1 md:grid-cols-[minmax(0,1fr)_340px] lg:grid-cols-[190px_minmax(0,1fr)_380px]">
      {/* Categorías en columna (tablet horizontal) */}
      <nav className="hidden overflow-y-auto border-r border-linea bg-papel/50 p-2 lg:block" aria-label="Categorías">
        <CategoryButtons menu={menu} favorites={favorites.length > 0} category={category} setCategory={(c) => (setCategory(c), setQuery(""))} vertical />
      </nav>

      {/* Productos */}
      <section className="flex min-h-0 min-w-0 flex-col">
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
        <div className="pb-safe-28 flex-1 overflow-y-auto p-3 md:pb-3">
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
      <div className="pb-safe-3 fixed inset-x-0 bottom-0 z-30 border-t border-linea bg-papel p-3 md:hidden">
        <button className={btn(sendNow.length ? "send" : "dark", "lg", "w-full justify-between")} onClick={() => setPanelOpen(true)}>
          <span className="truncate">
            {sendNow.length ? `Ver y enviar (${sendUnits}) · ${check.label}` : heldDrafts.length ? `${heldUnits} retenidos · ${check.label}` : `Ver cuenta · ${check.label}`}
          </span>
          <span className="tnum">{cop(totals.total)}</span>
        </button>
      </div>
      {panelOpen ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-papel pb-[env(safe-area-inset-bottom)] md:hidden" role="dialog" aria-modal="true" aria-label="Cuenta">
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
        notes={lists.notes}
        onClose={() => setModProduct(null)}
        onAdd={(input) => {
          const p = modProduct!;
          setModProduct(null);
          add(p, input);
        }}
      />
      <DraftSheet
        item={draftItem}
        product={draftItem?.product_id ? menu.products.find((p) => p.id === draftItem.product_id) : undefined}
        groups={menu.groups}
        guests={check.guests}
        notes={lists.notes}
        onClose={() => setDraftItem(null)}
        onSave={(patch) => {
          const id = draftItem!.id;
          setDraftItem(null);
          run(() => changeDraftAction(id, patch), "", patch.held ? "Retenido: sale cuando lo mandes" : "Guardado");
        }}
        onRemove={() => {
          const it = draftItem!;
          setDraftItem(null);
          changeQty(it, 0);
        }}
      />
      <ItemSheet
        item={itemSheet}
        reasons={{ void: lists.void, courtesy: lists.courtesy }}
        onClose={() => setItemSheet(null)}
        onDelivered={() => {
          const id = itemSheet!.id;
          setItemSheet(null);
          run(() => deliveredAction(check.id, id), "", "Entregado");
        }}
        onCourtesy={(reason) => {
          const it = itemSheet!;
          setItemSheet(null);
          run((a) => courtesyAction(it.id, { reason, auth: a }), it.courtesy ? `Quitar la cortesía de ${it.name}` : `Dar ${it.qty} ${it.name} como cortesía`, "Listo");
        }}
        onVoid={(reason, waste) => {
          const it = itemSheet!;
          setItemSheet(null);
          run((a) => voidItemAction(it.id, { reason, waste, auth: a }), `Anular ${it.qty} ${it.name}`, "Anulado");
        }}
        onMove={() => {
          const it = itemSheet!;
          setItemSheet(null);
          setMoving({ mode: "move", preselect: it.id });
        }}
      />
      <MoveItemsSheet
        open={!!moving}
        mode={moving?.mode ?? "move"}
        items={movable}
        preselect={moving?.preselect ?? null}
        checks={others}
        tables={freeTables}
        onClose={() => setMoving(null)}
        onMove={move}
      />
      <MergeSheet
        open={sheet === "merge"}
        here={check.label}
        checks={others}
        onClose={() => setSheet(null)}
        onMerge={(id) => {
          setSheet(null);
          run(() => mergeChecksAction(check.id, id), "", "Cuentas unidas");
        }}
      />
      <WaiterSheet
        open={sheet === "waiter"}
        current={check.opened_by}
        team={team}
        onClose={() => setSheet(null)}
        onPick={(id) => {
          setSheet(null);
          const name = team.find((p) => p.id === id)?.name ?? "otra persona";
          run((a) => changeWaiterAction(check.id, { staffId: id, auth: a }), `Pasar la cuenta a ${name}`, `Ahora la atiende ${name}`);
        }}
      />
      <AuthSheet
        request={auth}
        authorizers={authorizers}
        meId={meId}
        pending={pending}
        onClose={() => setAuth(null)}
        onAuth={(credentials) => {
          const a = auth!;
          start(async () => {
            const r = await a.run(credentials);
            if (report(r, a.done ?? "Autorizado")) {
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
        reasons={lists.discount}
        onClose={() => setSheet(null)}
        onApply={(pct, reason) => {
          setSheet(null);
          run((a) => discountAction(check.id, { pct, reason, auth: a }), `Descuento del ${pct} %`, pct ? "Descuento aplicado" : "Descuento quitado");
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
      <Sheet open={sheet === "menu"} onClose={() => setSheet(null)} title={check.label} wide>
        <div className="space-y-4">
          <MenuGroup title="Productos">
            <MenuButton icon={<Split size={18} />} label="Separar cuenta" hint="Otra cuenta en la misma mesa" disabled={!movable.length} onClick={() => (setSheet(null), setMoving({ mode: "split", preselect: null }))} />
            <MenuButton icon={<ArrowRightLeft size={18} />} label="Pasar productos" hint="A otra cuenta o a una mesa libre" disabled={!movable.length} onClick={() => (setSheet(null), setMoving({ mode: "move", preselect: null }))} />
            <MenuButton icon={<Merge size={18} />} label="Unir otra cuenta a esta" hint={others.length ? "Se cobran juntas" : "No hay otras abiertas"} disabled={!others.length} onClick={() => setSheet("merge")} />
          </MenuGroup>
          <MenuGroup title="Mesa y equipo">
            {check.kind !== "domicilio" ? <MenuButton icon={<LayoutGrid size={18} />} label="Cambiar de mesa" hint={check.table_name ? `Ahora en la mesa ${check.table_name}` : "Pasarla a una mesa"} onClick={() => setSheet("move")} /> : null}
            <MenuButton icon={<UserRound size={18} />} label="Cambiar mesero" hint={check.waiter_name ? `La lleva ${check.waiter_name}` : "Sin mesero"} onClick={() => setSheet("waiter")} />
            <MenuButton icon={<Users size={18} />} label="Personas" hint={`${check.guests} en la cuenta`} onClick={() => setSheet("guests")} />
          </MenuGroup>
          <MenuGroup title="Cobro">
            <MenuButton icon={<Percent size={18} />} label="Descuento" hint={check.discount_pct ? `${check.discount_pct} % · ${check.discount_reason ?? ""}` : "Con motivo"} onClick={() => setSheet("discount")} />
            {rules.loyalty ? <MenuButton icon={<Gift size={18} />} label="Cliente y sellos" hint={check.customer ? (check.customer.name || check.customer.phone) : "Programa de sellos"} onClick={() => setSheet("customer")} /> : null}
            {check.status === "bill" ? (
              <MenuButton icon={<Receipt size={18} />} label="Seguir pidiendo" hint="Quita la pre-cuenta" onClick={() => (setSheet(null), run(() => billAction(check.id, false), "", "La cuenta sigue abierta"))} />
            ) : null}
            {!items.some((i) => i.status !== "draft" && i.status !== "void") ? (
              <MenuButton
                icon={<Trash2 size={18} />}
                label="Descartar cuenta vacía"
                hint="Se abrió por error"
                danger
                onClick={() => {
                  setSheet(null);
                  start(async () => {
                    const r = await discardCheckAction(check.id);
                    if (report(r)) router.replace("/salon");
                  });
                }}
              />
            ) : null}
          </MenuGroup>
        </div>
      </Sheet>
    </div>
  );
}

function MenuGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="mb-1.5 text-[13px] font-bold text-humo">{title}</p>
      <div className="grid gap-2 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function MenuButton({ icon, label, hint, onClick, disabled, danger }: { icon: React.ReactNode; label: string; hint?: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn("flex min-h-14 items-center gap-3 rounded-2xl bg-papel px-3.5 py-2.5 text-left ring-1 ring-linea-2 transition hover:ring-tinto disabled:opacity-45 disabled:hover:ring-linea-2", danger && "text-cereza")}
    >
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", danger ? "bg-cereza-soft" : "bg-tinto/5")}>{icon}</span>
      <span className="min-w-0">
        <span className="block font-semibold leading-tight">{label}</span>
        {hint ? <span className="block truncate text-[13px] text-humo">{hint}</span> : null}
      </span>
    </button>
  );
}

function SeatChip({ n }: { n: number }) {
  return <span className="ml-1.5 rounded bg-tinto/8 px-1 align-middle text-[12px] font-bold text-tinto-2">P{n}</span>;
}

/** Un producto por enviar: la cantidad se cambia aquí mismo; lo demás (opciones, nota, alergia, puesto, retener), en su hoja. */
function DraftLine({ item: i, onQty, onOpen }: { item: CheckItem; onQty: (v: number) => void; onOpen: () => void }) {
  const details = [...i.modifiers.map((m) => m.name), i.note && `“${i.note}”`].filter(Boolean).join(" · ");
  return (
    <li className="flex items-center gap-2 py-2.5">
      <Stepper size="sm" value={i.qty} onChange={onQty} min={1} />
      <button className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <span className="block truncate font-semibold leading-tight">
          {i.name}
          {i.seat ? <SeatChip n={i.seat} /> : null}
        </span>
        {details || i.allergy ? (
          <span className="block truncate text-[13px] text-humo">
            {i.allergy ? (
              <span className="mr-1 inline-flex items-center gap-0.5 font-semibold text-cereza">
                <TriangleAlert size={12} /> Alergia
              </span>
            ) : null}
            {details}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[12px] text-humo">
            <StickyNote size={12} /> Nota, puesto, retener
          </span>
        )}
      </button>
      <Money value={(i.unit_price + i.modifiers.reduce((s, m) => s + m.price, 0)) * i.qty} className="text-[15px] font-semibold" />
    </li>
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
