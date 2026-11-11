"use client";

import { ArrowRightLeft, Check, Gift, Merge, Minus, Pause, Plus, Split, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Avatar, btn, Money } from "@/components/ui";
import type { CheckItem, DraftPatch, Mod } from "@/lib/server/checks";
import type { MenuGroup, MenuProduct } from "@/lib/server/menu";
import { cop } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Keypad } from "../keypad";
import { Sheet } from "../sheet";

export function Stepper({ value, onChange, min = 1, max = 99, size = "md" }: { value: number; onChange: (v: number) => void; min?: number; max?: number; size?: "sm" | "md" }) {
  const s = size === "sm" ? "size-9" : "size-12";
  return (
    <div className="inline-flex items-center gap-1 rounded-2xl bg-tinto/5 p-1">
      <button type="button" className={cn(s, "flex items-center justify-center rounded-xl hover:bg-tinto/8")} onClick={() => onChange(Math.max(min - 1, value - 1))} aria-label="Uno menos">
        <Minus size={size === "sm" ? 16 : 20} />
      </button>
      <span className={cn("min-w-8 text-center font-bold tnum", size === "sm" ? "text-base" : "text-xl")}>{value}</span>
      <button type="button" className={cn(s, "flex items-center justify-center rounded-xl hover:bg-tinto/8")} onClick={() => onChange(Math.min(max, value + 1))} aria-label="Uno más">
        <Plus size={size === "sm" ? 16 : 20} />
      </button>
    </div>
  );
}

/** Grupos de opciones de un producto, los obligatorios primero. */
function groupsOf(product: MenuProduct | null | undefined, groups: Record<string, MenuGroup>) {
  return product ? product.groups.map((g) => groups[g]).filter((g): g is MenuGroup => !!g).sort((a, b) => b.min - a.min) : [];
}

/** Las opciones de cada grupo, para elegir con toques grandes. */
function ModifierGroups({ list, picked, setPicked }: { list: MenuGroup[]; picked: Record<string, string[]>; setPicked: (fn: (p: Record<string, string[]>) => Record<string, string[]>) => void }) {
  const toggle = (g: MenuGroup, id: string) =>
    setPicked((p) => {
      const cur = p[g.id] ?? [];
      if (cur.includes(id)) return { ...p, [g.id]: g.min === 1 && g.max === 1 ? cur : cur.filter((x) => x !== id) };
      if (g.max === 1) return { ...p, [g.id]: [id] };
      return cur.length >= g.max ? p : { ...p, [g.id]: [...cur, id] };
    });
  return (
    <>
      {list.map((g) => (
        <fieldset key={g.id}>
          <legend className="flex w-full items-baseline justify-between text-[15px] font-bold">
            {g.name}
            <span className="text-[13px] font-medium text-humo">{g.min ? (g.max === 1 ? "Elige 1" : `Elige de ${g.min} a ${g.max}`) : g.max === 1 ? "Opcional" : `Hasta ${g.max}`}</span>
          </legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {g.options.map((o) => {
              const on = picked[g.id]?.includes(o.id);
              // Una opción agotada se ve, pero no se puede elegir
              const out = o.soldOut && !on;
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => !out && toggle(g, o.id)}
                  disabled={out}
                  className={cn(
                    "flex min-h-12 items-center justify-between gap-2 rounded-xl px-3 text-left text-[15px] font-semibold ring-1 transition",
                    on ? "bg-tinto text-cal ring-tinto" : "bg-papel ring-linea-2 hover:ring-tinto",
                    out && "cursor-not-allowed opacity-45 hover:ring-linea-2",
                  )}
                  aria-pressed={on}
                >
                  <span>{o.name}</span>
                  {out ? <span className="text-[13px] text-cereza">Agotada</span> : o.price ? <span className={cn("text-sm tnum", on ? "text-cal/80" : "text-humo")}>+{cop(o.price)}</span> : null}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </>
  );
}

/** Notas rápidas del local: un toque la agrega a la nota y otro la quita. */
function QuickNotes({ notes, value, onChange }: { notes: string[]; value: string; onChange: (v: string) => void }) {
  if (!notes.length) return null;
  const parts = value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const has = (n: string) => parts.some((p) => p.toLowerCase() === n.toLowerCase());
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {notes.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange((has(n) ? parts.filter((p) => p.toLowerCase() !== n.toLowerCase()) : [...parts, n]).join(", ").slice(0, 140))}
          className={cn("rounded-full px-3 py-1.5 text-sm font-semibold ring-1", has(n) ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}
          aria-pressed={has(n)}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

/** Hoja de modificadores: los obligatorios primero y las opciones habituales ya marcadas. */
export function ModifierSheet({
  product,
  groups,
  notes = [],
  onClose,
  onAdd,
}: {
  product: MenuProduct | null;
  groups: Record<string, MenuGroup>;
  /** Notas rápidas del local (solo para el equipo; la carta QR no las muestra) */
  notes?: string[];
  onClose: () => void;
  onAdd: (input: { modifierIds: string[]; qty: number; note: string }) => void;
}) {
  const list = useMemo(() => groupsOf(product, groups), [product, groups]);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  // Se reinicia solo al abrir otro producto: si la pantalla se refresca (otra tablet hizo algo), lo elegido no se pierde
  useEffect(() => {
    if (!product) return;
    setPicked(Object.fromEntries(list.map((g) => [g.id, g.options.filter((o) => o.isDefault && !o.soldOut).map((o) => o.id)])));
    setQty(1);
    setNote("");
  }, [product?.id]);
  if (!product) return null;
  const extra = list.reduce((s, g) => s + g.options.filter((o) => picked[g.id]?.includes(o.id)).reduce((a, o) => a + o.price, 0), 0);
  const missing = list.find((g) => (picked[g.id]?.length ?? 0) < g.min);
  return (
    <Sheet
      open
      onClose={onClose}
      title={product.name}
      footer={
        <div className="flex items-center gap-3">
          <Stepper value={qty} onChange={(v) => setQty(Math.max(1, v))} />
          <button className={btn("primary", "lg", "flex-1")} disabled={!!missing} onClick={() => onAdd({ modifierIds: Object.values(picked).flat(), qty, note })}>
            {missing ? `Elige ${missing.name.toLowerCase()}` : `Agregar · ${cop((product.price + extra) * qty)}`}
          </button>
        </div>
      }
    >
      {product.description ? <p className="-mt-1 mb-3 text-sm text-humo">{product.description}</p> : null}
      <div className="space-y-5">
        <ModifierGroups list={list} picked={picked} setPicked={setPicked} />
        <label className="block">
          <span className="text-[15px] font-bold">Nota para barra y cocina</span>
          <input className="mt-2 h-12 w-full rounded-xl border border-linea-2 px-3 outline-none focus:border-tinto" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej. sin hielo, bien caliente" maxLength={140} />
        </label>
        <QuickNotes notes={notes} value={note} onChange={setNote} />
      </div>
    </Sheet>
  );
}

/** Lo elegido en una línea, con los ids de la carta (las líneas viejas solo traen el nombre). */
function pickedFrom(list: MenuGroup[], mods: Mod[]) {
  return Object.fromEntries(
    list.map((g) => [g.id, g.options.filter((o) => mods.some((m) => (m.id ? m.id === o.id : m.name === o.name && (!m.group || m.group === g.name)))).map((o) => o.id)]),
  );
}

/**
 * Un producto por enviar: cantidad, opciones, nota, alergia, puesto y si se retiene para mandarlo después.
 * Es lo que antes era solo la nota.
 */
export function DraftSheet({
  item,
  product,
  groups,
  guests,
  notes,
  onClose,
  onSave,
  onRemove,
}: {
  item: CheckItem | null;
  product: MenuProduct | undefined;
  groups: Record<string, MenuGroup>;
  guests: number;
  notes: string[];
  onClose: () => void;
  onSave: (patch: DraftPatch) => void;
  onRemove: () => void;
}) {
  const list = useMemo(() => groupsOf(product, groups), [product, groups]);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [allergy, setAllergy] = useState(false);
  const [seat, setSeat] = useState<number | null>(null);
  const [held, setHeld] = useState(false);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  // Se reinicia solo al abrir otro producto, no cada vez que la pantalla se refresca
  useEffect(() => {
    if (!item) return;
    setQty(item.qty);
    setNote(item.note);
    setAllergy(item.allergy);
    setSeat(item.seat);
    setHeld(item.held);
    setPicked(pickedFrom(list, item.modifiers));
  }, [item?.id]);
  if (!item) return null;
  const missing = list.find((g) => (picked[g.id]?.length ?? 0) < g.min);
  const ids = Object.values(picked).flat();
  const before = pickedFrom(list, item.modifiers);
  const modsChanged = list.length > 0 && JSON.stringify(Object.values(before).flat().sort()) !== JSON.stringify([...ids].sort());
  const seats = Array.from({ length: Math.min(12, Math.max(guests, seat ?? 0, 2)) }, (_, i) => i + 1);
  const needsNote = allergy && note.trim().length < 3;
  return (
    <Sheet
      open
      onClose={onClose}
      title={item.name}
      footer={
        <div className="flex items-center gap-2">
          <button className={btn("ghost", "lg")} onClick={onRemove}>
            <span className="text-cereza">Quitar</span>
          </button>
          <button
            className={btn("primary", "lg", "flex-1")}
            disabled={!!missing || needsNote}
            onClick={() =>
              onSave({
                qty,
                note,
                allergy,
                seat,
                held,
                ...(modsChanged ? { modifierIds: ids } : {}),
              })
            }
          >
            {missing ? `Elige ${missing.name.toLowerCase()}` : needsNote ? "Escribe a qué es la alergia" : "Guardar"}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[15px] font-bold">Cantidad</span>
          <Stepper value={qty} onChange={(v) => setQty(Math.max(1, v))} />
        </div>
        {list.length ? <ModifierGroups list={list} picked={picked} setPicked={setPicked} /> : null}
        <div>
          <label className="block">
            <span className="text-[15px] font-bold">Nota para barra y cocina</span>
            <input
              className={cn("mt-2 h-12 w-full rounded-xl border px-3 outline-none focus:border-tinto", needsNote ? "border-cereza" : "border-linea-2")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={140}
              placeholder={allergy ? "¿A qué? Ej. maní, lácteos, mariscos" : "Ej. sin cebolla, bien asada"}
            />
          </label>
          <QuickNotes notes={notes} value={note} onChange={setNote} />
        </div>
        <label className={cn("flex items-start gap-3 rounded-2xl p-3", allergy ? "bg-cereza-soft" : "bg-cal")}>
          <input type="checkbox" className="mt-1 size-5 accent-[var(--color-cereza)]" checked={allergy} onChange={(e) => setAllergy(e.target.checked)} />
          <span>
            <span className="flex items-center gap-1.5 font-semibold">
              <TriangleAlert size={16} className="text-cereza" /> Alergia o intolerancia
            </span>
            <span className="block text-sm text-humo">Barra y cocina lo ven en rojo. Escribe en la nota a qué.</span>
          </span>
        </label>
        <div>
          <p className="text-[15px] font-bold">Puesto</p>
          <p className="text-sm text-humo">Quién se lo come: así se entrega sin preguntar y la cuenta se separa fácil.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {[null, ...seats].map((n) => (
              <button
                key={n ?? "sin"}
                type="button"
                onClick={() => setSeat(n)}
                className={cn("h-11 min-w-11 rounded-xl px-3 text-[15px] font-bold ring-1 tnum", seat === n ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}
                aria-pressed={seat === n}
              >
                {n ?? "Sin puesto"}
              </button>
            ))}
          </div>
        </div>
        <label className={cn("flex items-start gap-3 rounded-2xl p-3", held ? "bg-balcon-soft" : "bg-cal")}>
          <input type="checkbox" className="mt-1 size-5 accent-[var(--color-balcon)]" checked={held} onChange={(e) => setHeld(e.target.checked)} />
          <span>
            <span className="flex items-center gap-1.5 font-semibold">
              <Pause size={16} /> Retener: sale después
            </span>
            <span className="block text-sm text-humo">No va con este envío. Lo mandas cuando la mesa esté lista (el plato fuerte, el postre); cocina ya lo ve anunciado.</span>
          </span>
        </label>
      </div>
    </Sheet>
  );
}

/** Motivos: los de la lista del local y, si no está, uno escrito. */
function Reasons({ options, value, onChange, placeholder }: { options: string[]; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <>
      {options.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {options.map((r) => (
            <button key={r} type="button" onClick={() => onChange(r)} className={cn("rounded-full px-3.5 py-2 text-sm font-semibold ring-1", value === r ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")} aria-pressed={value === r}>
              {r}
            </button>
          ))}
        </div>
      ) : null}
      <input className="mt-3 h-12 w-full rounded-xl border border-linea-2 px-3 outline-none focus:border-tinto" value={options.includes(value) ? "" : value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} maxLength={120} />
    </>
  );
}

export function ItemSheet({
  item,
  reasons,
  onClose,
  onVoid,
  onCourtesy,
  onDelivered,
  onMove,
}: {
  item: CheckItem | null;
  reasons: { void: string[]; courtesy: string[] };
  onClose: () => void;
  onVoid: (reason: string, waste: boolean) => void;
  onCourtesy: (reason: string) => void;
  onDelivered: () => void;
  onMove: () => void;
}) {
  const [mode, setMode] = useState<"menu" | "void" | "courtesy">("menu");
  const [reason, setReason] = useState("");
  const [waste, setWaste] = useState(false);
  useEffect(() => {
    setMode("menu");
    setReason("");
    setWaste(false);
  }, [item]);
  if (!item) return null;
  const unit = item.unit_price + item.modifiers.reduce((s, m) => s + m.price, 0);
  const details = [...item.modifiers.map((m) => m.name), item.note && `“${item.note}”`].filter(Boolean).join(" · ");
  return (
    <Sheet
      open
      onClose={onClose}
      title={`${item.qty} × ${item.name}`}
      footer={
        mode === "void" ? (
          <button className={btn("danger", "lg", "w-full")} disabled={reason.trim().length < 3} onClick={() => onVoid(reason, waste)}>
            Anular {cop(unit * item.qty)}
          </button>
        ) : mode === "courtesy" ? (
          <button className={btn("primary", "lg", "w-full")} disabled={reason.trim().length < 3} onClick={() => onCourtesy(reason)}>
            <Gift size={18} /> Dar {cop(unit * item.qty)} como cortesía
          </button>
        ) : undefined
      }
    >
      {mode === "menu" ? (
        <div className="grid gap-2">
          {details || item.allergy || item.seat ? (
            <p className="mb-1 flex flex-wrap items-center gap-1.5 text-sm text-humo">
              {item.allergy ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-cereza-soft px-2 py-0.5 font-semibold text-cereza">
                  <TriangleAlert size={13} /> Alergia
                </span>
              ) : null}
              {item.seat ? <span className="rounded-full bg-tinto/6 px-2 py-0.5 font-semibold text-tinto">Puesto {item.seat}</span> : null}
              {details}
            </p>
          ) : null}
          {item.status === "ready" ? (
            <button className={btn("send", "lg", "w-full")} onClick={onDelivered}>
              <Check size={18} /> Marcar entregado
            </button>
          ) : null}
          <button className={btn("soft", "lg", "w-full justify-start")} onClick={onMove}>
            <ArrowRightLeft size={18} /> Pasar a otra cuenta
          </button>
          <button className={btn("soft", "lg", "w-full justify-start")} onClick={() => (item.courtesy ? onCourtesy("") : setMode("courtesy"))}>
            <Gift size={18} /> {item.courtesy ? "Quitar cortesía" : "Dar como cortesía"}
          </button>
          <button className={btn("soft", "lg", "w-full justify-start text-cereza")} onClick={() => setMode("void")}>
            Anular este producto
          </button>
          <p className="mt-1 text-sm text-humo">Las anulaciones y cortesías quedan registradas con tu nombre y el motivo.</p>
        </div>
      ) : mode === "courtesy" ? (
        <div>
          <p className="text-[15px] font-bold">¿Por qué es cortesía?</p>
          <Reasons options={reasons.courtesy} value={reason} onChange={setReason} placeholder="Otro motivo" />
          <p className="mt-3 text-sm text-humo">La autoriza el dueño o la administración.</p>
        </div>
      ) : (
        <div>
          <p className="text-[15px] font-bold">¿Por qué se anula?</p>
          <Reasons options={reasons.void} value={reason} onChange={setReason} placeholder="Otro motivo" />
          <label className="mt-4 flex items-start gap-3 rounded-2xl bg-cal p-3">
            <input type="checkbox" className="mt-1 size-5 accent-[var(--color-cereza)]" checked={waste} onChange={(e) => setWaste(e.target.checked)} />
            <span>
              <span className="block font-semibold">Ya se preparó y se perdió</span>
              <span className="block text-sm text-humo">Cuenta como merma. Si no lo marcas, los insumos vuelven al inventario.</span>
            </span>
          </label>
          {item.status === "sent" || item.status === "ready" ? <p className="mt-3 text-sm text-humo">Barra y cocina lo ven en rojo apenas lo anules.</p> : null}
        </div>
      )}
    </Sheet>
  );
}

export function DiscountSheet({
  open,
  current,
  limit,
  reasons,
  onClose,
  onApply,
}: {
  open: boolean;
  current: number;
  limit: number;
  reasons: string[];
  onClose: () => void;
  onApply: (pct: number, reason: string) => void;
}) {
  const [pct, setPct] = useState(current);
  const [reason, setReason] = useState("");
  useEffect(() => {
    setPct(current);
    setReason("");
  }, [open, current]);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Descuento a la cuenta"
      footer={
        <button className={btn("primary", "lg", "w-full")} disabled={pct > 0 && reason.trim().length < 3} onClick={() => onApply(pct, reason)}>
          {pct ? `Aplicar ${pct} %` : "Quitar descuento"}
        </button>
      }
    >
      <div className="grid grid-cols-4 gap-2">
        {[0, 5, 10, 15, 20, 30, 50, 100].map((p) => (
          <button key={p} onClick={() => setPct(p)} className={cn("h-14 rounded-xl text-lg font-bold ring-1 tnum", pct === p ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}>
            {p ? `${p} %` : "Sin"}
          </button>
        ))}
      </div>
      {pct > 0 ? (
        <div className="mt-4">
          <p className="text-[15px] font-bold">Motivo</p>
          <Reasons options={reasons} value={reason} onChange={setReason} placeholder="Otro motivo" />
        </div>
      ) : null}
      <p className="mt-3 text-sm text-humo">Más de {limit} % lo autoriza el dueño o la administración.</p>
    </Sheet>
  );
}

export function CustomerSheet({
  open,
  customer,
  goal,
  reward,
  onClose,
  onSave,
}: {
  open: boolean;
  customer: { name: string; phone: string; stamps: number } | null;
  goal: number;
  reward: string;
  onClose: () => void;
  onSave: (input: { phone: string; name: string; consent: boolean }) => void;
}) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  useEffect(() => {
    setPhone("");
    setName("");
    setConsent(false);
  }, [open]);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Cliente y sellos"
      footer={
        <button className={btn("primary", "lg", "w-full")} disabled={phone.replace(/\D/g, "").length !== 10} onClick={() => onSave({ phone, name, consent })}>
          Agregar a la cuenta
        </button>
      }
    >
      {customer ? (
        <div className="mb-4 rounded-2xl bg-cal p-4">
          <p className="font-semibold">{customer.name || "Cliente"}</p>
          <p className="text-sm text-humo">{customer.phone}</p>
          <div className="mt-3 flex gap-1.5" aria-label={`${customer.stamps} de ${goal} sellos`}>
            {Array.from({ length: goal }, (_, i) => (
              <span key={i} className={cn("size-6 rounded-full border-2", i < customer.stamps ? "border-puerta bg-puerta" : "border-linea-2")} />
            ))}
          </div>
          <p className="mt-2 text-sm">{customer.stamps >= goal ? `Ya puede reclamar: ${reward.toLowerCase()}` : `Le faltan ${goal - customer.stamps} para ${reward.toLowerCase()}`}</p>
        </div>
      ) : null}
      <label className="block">
        <span className="text-sm font-semibold text-humo">Celular</span>
        <input data-autofocus inputMode="tel" className="mt-1 h-14 w-full rounded-xl border border-linea-2 px-3 text-lg tnum outline-none focus:border-tinto" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="300 123 4567" />
      </label>
      <label className="mt-3 block">
        <span className="text-sm font-semibold text-humo">Nombre (opcional)</span>
        <input className="mt-1 h-12 w-full rounded-xl border border-linea-2 px-3 outline-none focus:border-tinto" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="mt-4 flex items-start gap-3 rounded-2xl bg-cal p-3">
        <input type="checkbox" className="mt-1 size-5 accent-[var(--color-balcon)]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span className="text-sm">
          El cliente autoriza usar su celular para el programa de sellos y recibir novedades. Puede darse de baja cuando quiera (Ley 1581 de 2012).
        </span>
      </label>
    </Sheet>
  );
}

export function MoveSheet({ open, tables, onClose, onMove }: { open: boolean; tables: { id: string; name: string; zone: string }[]; onClose: () => void; onMove: (id: string) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Mover a otra mesa">
      {tables.length ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {tables.map((t) => (
            <button key={t.id} onClick={() => onMove(t.id)} className="flex h-16 flex-col items-center justify-center rounded-xl ring-1 ring-linea-2 hover:ring-tinto">
              <span className="text-lg font-bold">{t.name}</span>
              <span className="text-[12px] text-humo">{t.zone}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-humo">No hay mesas libres.</p>
      )}
    </Sheet>
  );
}

export function GuestsSheet({ open, value, onClose, onSave }: { open: boolean; value: number; onClose: () => void; onSave: (n: number) => void }) {
  const [n, setN] = useState(value);
  useEffect(() => setN(value), [value, open]);
  return (
    <Sheet open={open} onClose={onClose} title="Personas en la cuenta" footer={<button className={btn("primary", "lg", "w-full")} onClick={() => onSave(n)}>Guardar</button>}>
      <div className="flex justify-center py-2">
        <Stepper value={n} onChange={(v) => setN(Math.max(1, v))} max={40} />
      </div>
    </Sheet>
  );
}

export type OpenCheckOption = { id: string; label: string; total: number; waiter: string | null };

/**
 * Mover o separar productos: se eligen los productos (y cuántos de cada línea) y luego a dónde van:
 * una cuenta aparte en la misma mesa, otra cuenta abierta o una mesa libre. Separar va directo a la cuenta aparte.
 */
export function MoveItemsSheet({
  open,
  mode,
  items,
  preselect,
  checks,
  tables,
  onClose,
  onMove,
}: {
  open: boolean;
  mode: "move" | "split";
  items: CheckItem[];
  preselect: string | null;
  checks: OpenCheckOption[];
  tables: { id: string; name: string; zone: string }[];
  onClose: () => void;
  onMove: (input: { items: { id: string; qty: number }[]; to: { checkId: string } | { tableId: string } | { split: true } }) => void;
}) {
  const [step, setStep] = useState<"items" | "to">("items");
  const [chosen, setChosen] = useState<Record<string, number>>({});
  // Se reinicia al abrir; un refresco de la pantalla mientras se eligen productos no borra lo elegido
  useEffect(() => {
    if (!open) return;
    setStep("items");
    const first = preselect ? items.find((i) => i.id === preselect) : null;
    setChosen(first ? { [first.id]: first.qty } : {});
  }, [open, preselect]);
  const picked = Object.entries(chosen).filter(([, q]) => q > 0);
  const units = picked.reduce((n, [, q]) => n + q, 0);
  const value = picked.reduce((s, [id, q]) => {
    const i = items.find((x) => x.id === id);
    return i && !i.courtesy ? s + (i.unit_price + i.modifiers.reduce((a, m) => a + m.price, 0)) * q : s;
  }, 0);
  const payload = picked.map(([id, qty]) => ({ id, qty }));
  const title = mode === "split" ? "Separar en otra cuenta" : step === "items" ? "¿Qué productos pasan?" : `¿A dónde van? · ${units} ${units === 1 ? "producto" : "productos"}`;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      wide
      footer={
        step === "items" ? (
          <button
            className={btn("primary", "lg", "w-full")}
            disabled={!units}
            onClick={() => (mode === "split" ? onMove({ items: payload, to: { split: true } }) : setStep("to"))}
          >
            {!units ? "Toca los productos" : mode === "split" ? `Separar ${units} · ${cop(value)}` : `Siguiente · ${units} ${units === 1 ? "producto" : "productos"}`}
          </button>
        ) : (
          <button className={btn("ghost", "lg", "w-full")} onClick={() => setStep("items")}>
            Volver a los productos
          </button>
        )
      }
    >
      {step === "items" ? (
        <>
          <p className="-mt-1 mb-3 text-sm text-humo">
            {mode === "split"
              ? "Lo que elijas pasa a una cuenta nueva en la misma mesa, que se cobra y se factura aparte."
              : "Lo que ya está en barra y cocina no se vuelve a preparar: solo cambia de cuenta."}
          </p>
          <ul className="divide-y divide-linea rounded-2xl ring-1 ring-linea">
            {items.map((i) => {
              const q = chosen[i.id] ?? 0;
              const on = q > 0;
              return (
                <li key={i.id} className={cn("flex items-center gap-2 px-3 py-2", on && "bg-balcon-soft/60")}>
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-3 py-1 text-left" onClick={() => setChosen((c) => ({ ...c, [i.id]: on ? 0 : i.qty }))} aria-pressed={on}>
                    <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-md ring-1", on ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}>{on ? <Check size={15} /> : null}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold leading-tight">
                        <span className="tnum">{i.qty}</span> {i.name}
                        {i.seat ? <span className="ml-1.5 rounded bg-tinto/6 px-1 text-[12px] font-bold">P{i.seat}</span> : null}
                      </span>
                      <span className="block truncate text-[13px] text-humo">
                        {i.status === "draft" ? (i.held ? "Retenido" : "Por enviar") : `Ronda ${i.round}`}
                        {i.modifiers.length ? ` · ${i.modifiers.map((m) => m.name).join(", ")}` : ""}
                      </span>
                    </span>
                  </button>
                  {on && i.qty > 1 ? <Stepper size="sm" value={q} min={1} max={i.qty} onChange={(v) => setChosen((c) => ({ ...c, [i.id]: Math.min(i.qty, Math.max(1, v)) }))} /> : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <div className="space-y-5">
          <button type="button" className={btn("soft", "lg", "w-full justify-start")} onClick={() => onMove({ items: payload, to: { split: true } })}>
            <Split size={18} /> Cuenta aparte en esta mesa
          </button>
          {checks.length ? (
            <section>
              <p className="mb-2 text-sm font-bold text-humo">Otra cuenta abierta</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {checks.map((c) => (
                  <button key={c.id} type="button" onClick={() => onMove({ items: payload, to: { checkId: c.id } })} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left ring-1 ring-linea-2 hover:ring-tinto">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{c.label}</span>
                      <span className="block truncate text-[13px] text-humo">{c.waiter ?? "Sin mesero"}</span>
                    </span>
                    <Money value={c.total} className="text-sm font-semibold" />
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          {tables.length ? (
            <section>
              <p className="mb-2 text-sm font-bold text-humo">Mesa libre</p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {tables.map((t) => (
                  <button key={t.id} type="button" onClick={() => onMove({ items: payload, to: { tableId: t.id } })} className="flex h-16 flex-col items-center justify-center rounded-xl ring-1 ring-linea-2 hover:ring-tinto">
                    <span className="text-lg font-bold">{t.name}</span>
                    <span className="text-[12px] text-humo">{t.zone}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

/** Traer otra cuenta a esta: se elige y se confirma, porque la otra deja de existir como cuenta. */
export function MergeSheet({ open, here, checks, onClose, onMerge }: { open: boolean; here: string; checks: OpenCheckOption[]; onClose: () => void; onMerge: (id: string) => void }) {
  const [pick, setPick] = useState<OpenCheckOption | null>(null);
  useEffect(() => setPick(null), [open]);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={pick ? "¿Unir las cuentas?" : "Unir otra cuenta a esta"}
      footer={
        pick ? (
          <div className="flex gap-2">
            <button className={btn("ghost", "lg")} onClick={() => setPick(null)}>
              Volver
            </button>
            <button className={btn("primary", "lg", "flex-1")} onClick={() => onMerge(pick.id)}>
              <Merge size={18} /> Unir a {here}
            </button>
          </div>
        ) : undefined
      }
    >
      {pick ? (
        <p className="text-[15px]">
          Todo lo de <b>{pick.label}</b> ({cop(pick.total)}) pasa a <b>{here}</b>, con sus personas. {pick.label} queda libre y la cuenta se cobra junta.
        </p>
      ) : checks.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {checks.map((c) => (
            <button key={c.id} type="button" onClick={() => setPick(c)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left ring-1 ring-linea-2 hover:ring-tinto">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{c.label}</span>
                <span className="block truncate text-[13px] text-humo">{c.waiter ?? "Sin mesero"}</span>
              </span>
              <Money value={c.total} className="text-sm font-semibold" />
            </button>
          ))}
        </div>
      ) : (
        <p className="text-humo">No hay otras cuentas abiertas.</p>
      )}
    </Sheet>
  );
}

/** Pasar la cuenta a otra persona del equipo. */
export function WaiterSheet({
  open,
  current,
  team,
  onClose,
  onPick,
}: {
  open: boolean;
  current: string | null;
  team: { id: string; name: string; color: string }[];
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="¿Quién atiende esta cuenta?">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {team.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={p.id === current}
            onClick={() => onPick(p.id)}
            className={cn("flex h-14 items-center gap-2.5 rounded-xl px-3 text-left font-semibold ring-1", p.id === current ? "bg-tinto/5 text-humo ring-linea" : "ring-linea-2 hover:ring-tinto")}
          >
            <Avatar name={p.name} color={p.color} size={32} />
            <span className="min-w-0 truncate">{p.name}</span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-sm text-humo">Quien la lleva la puede pasar. Si es de otra persona, la autoriza el dueño o la administración.</p>
    </Sheet>
  );
}

export function PriceTag({ value, base, happy }: { value: number; base: number; happy: boolean }) {
  return happy ? (
    <span className="flex items-baseline gap-1.5">
      <Money value={value} className="rounded-md bg-fachada px-1.5 font-bold" />
      <s className="text-[12px] text-humo tnum">{cop(base)}</s>
    </span>
  ) : (
    <Money value={value} className="font-semibold text-tinto-2" />
  );
}
