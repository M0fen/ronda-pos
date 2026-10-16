"use client";

import { Check, Gift, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { btn, Money } from "@/components/ui";
import type { CheckItem } from "@/lib/server/checks";
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

/** Hoja de modificadores: los obligatorios primero y las opciones habituales ya marcadas. */
export function ModifierSheet({
  product,
  groups,
  onClose,
  onAdd,
}: {
  product: MenuProduct | null;
  groups: Record<string, MenuGroup>;
  onClose: () => void;
  onAdd: (input: { modifierIds: string[]; qty: number; note: string }) => void;
}) {
  const list = useMemo(() => (product ? product.groups.map((g) => groups[g]).filter((g): g is MenuGroup => !!g).sort((a, b) => b.min - a.min) : []), [product, groups]);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!product) return;
    setPicked(Object.fromEntries(list.map((g) => [g.id, g.options.filter((o) => o.isDefault).map((o) => o.id)])));
    setQty(1);
    setNote("");
  }, [product, list]);
  if (!product) return null;
  const extra = list.reduce((s, g) => s + g.options.filter((o) => picked[g.id]?.includes(o.id)).reduce((a, o) => a + o.price, 0), 0);
  const missing = list.find((g) => (picked[g.id]?.length ?? 0) < g.min);
  const toggle = (g: MenuGroup, id: string) =>
    setPicked((p) => {
      const cur = p[g.id] ?? [];
      if (cur.includes(id)) return { ...p, [g.id]: g.min === 1 && g.max === 1 ? cur : cur.filter((x) => x !== id) };
      if (g.max === 1) return { ...p, [g.id]: [id] };
      return cur.length >= g.max ? p : { ...p, [g.id]: [...cur, id] };
    });
  return (
    <Sheet
      open
      onClose={onClose}
      title={product.name}
      footer={
        <div className="flex items-center gap-3">
          <Stepper value={qty} onChange={(v) => setQty(Math.max(1, v))} />
          <button
            className={btn("primary", "lg", "flex-1")}
            disabled={!!missing}
            onClick={() => onAdd({ modifierIds: Object.values(picked).flat(), qty, note })}
          >
            {missing ? `Elige ${missing.name.toLowerCase()}` : `Agregar · ${cop((product.price + extra) * qty)}`}
          </button>
        </div>
      }
    >
      {product.description ? <p className="-mt-1 mb-3 text-sm text-humo">{product.description}</p> : null}
      <div className="space-y-5">
        {list.map((g) => (
          <fieldset key={g.id}>
            <legend className="flex w-full items-baseline justify-between text-[15px] font-bold">
              {g.name}
              <span className="text-[13px] font-medium text-humo">{g.min ? (g.max === 1 ? "Elige 1" : `Elige de ${g.min} a ${g.max}`) : g.max === 1 ? "Opcional" : `Hasta ${g.max}`}</span>
            </legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {g.options.map((o) => {
                const on = picked[g.id]?.includes(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => toggle(g, o.id)}
                    className={cn("flex min-h-12 items-center justify-between gap-2 rounded-xl px-3 text-left text-[15px] font-semibold ring-1 transition", on ? "bg-tinto text-cal ring-tinto" : "bg-papel ring-linea-2 hover:ring-tinto")}
                    aria-pressed={on}
                  >
                    <span>{o.name}</span>
                    {o.price ? <span className={cn("text-sm tnum", on ? "text-cal/80" : "text-humo")}>+{cop(o.price)}</span> : null}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
        <label className="block">
          <span className="text-[15px] font-bold">Nota para barra</span>
          <input className="mt-2 h-12 w-full rounded-xl border border-linea-2 px-3 outline-none focus:border-tinto" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej. sin hielo, bien caliente" maxLength={140} />
        </label>
      </div>
    </Sheet>
  );
}

const VOID_REASONS = ["Se marcó dos veces", "El cliente cambió de opinión", "Demoró mucho", "Salió mal preparado"];

export function ItemSheet({
  item,
  onClose,
  onVoid,
  onCourtesy,
  onDelivered,
}: {
  item: CheckItem | null;
  onClose: () => void;
  onVoid: (reason: string, waste: boolean) => void;
  onCourtesy: () => void;
  onDelivered: () => void;
}) {
  const [mode, setMode] = useState<"menu" | "void">("menu");
  const [reason, setReason] = useState("");
  const [waste, setWaste] = useState(false);
  useEffect(() => {
    setMode("menu");
    setReason("");
    setWaste(false);
  }, [item]);
  if (!item) return null;
  const unit = item.unit_price + item.modifiers.reduce((s, m) => s + m.price, 0);
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
        ) : undefined
      }
    >
      {mode === "menu" ? (
        <div className="grid gap-2">
          {item.status === "ready" ? (
            <button className={btn("send", "lg", "w-full")} onClick={onDelivered}>
              <Check size={18} /> Marcar entregado
            </button>
          ) : null}
          <button className={btn("soft", "lg", "w-full justify-start")} onClick={onCourtesy}>
            <Gift size={18} /> {item.courtesy ? "Quitar cortesía" : "Dar como cortesía"}
          </button>
          <button className={btn("soft", "lg", "w-full justify-start text-cereza")} onClick={() => setMode("void")}>
            Anular este producto
          </button>
          <p className="mt-1 text-sm text-humo">Las anulaciones y cortesías quedan registradas con tu nombre y el motivo.</p>
        </div>
      ) : (
        <div>
          <p className="text-[15px] font-bold">¿Por qué se anula?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {VOID_REASONS.map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)} className={cn("rounded-full px-3.5 py-2 text-sm font-semibold ring-1", reason === r ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}>
                {r}
              </button>
            ))}
          </div>
          <input className="mt-3 h-12 w-full rounded-xl border border-linea-2 px-3 outline-none focus:border-tinto" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Otro motivo" />
          <label className="mt-4 flex items-start gap-3 rounded-2xl bg-cal p-3">
            <input type="checkbox" className="mt-1 size-5 accent-[var(--color-cereza)]" checked={waste} onChange={(e) => setWaste(e.target.checked)} />
            <span>
              <span className="block font-semibold">Ya se preparó y se perdió</span>
              <span className="block text-sm text-humo">Cuenta como merma. Si no lo marcas, los insumos vuelven al inventario.</span>
            </span>
          </label>
        </div>
      )}
    </Sheet>
  );
}

/** Autorización de un superior en el momento: PIN del encargado. */
export function AuthSheet({ label, onClose, onPin }: { label: string | null; onClose: () => void; onPin: (pin: string) => void }) {
  const [pin, setPin] = useState("");
  useEffect(() => setPin(""), [label]);
  if (!label) return null;
  return (
    <Sheet open onClose={onClose} title="Autorización del encargado">
      <p className="text-[15px]">{label}. Pide a quien está a cargo que escriba su PIN.</p>
      <div className="my-5 flex justify-center gap-4">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`size-4 rounded-full ${i < pin.length ? "bg-tinto" : "bg-tinto/12"}`} />
        ))}
      </div>
      <Keypad
        onKey={(k) => {
          if (k === "del") return setPin((p) => p.slice(0, -1));
          const next = (pin + k).slice(0, 4);
          setPin(next);
          if (next.length === 4) {
            onPin(next);
            setPin("");
          }
        }}
      />
    </Sheet>
  );
}

export function DiscountSheet({ open, current, limit, onClose, onApply }: { open: boolean; current: number; limit: number; onClose: () => void; onApply: (pct: number, reason: string) => void }) {
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
      <input className="mt-4 h-12 w-full rounded-xl border border-linea-2 px-3 outline-none focus:border-tinto" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (ej. cliente frecuente, error en la orden)" />
      <p className="mt-2 text-sm text-humo">Más de {limit} % necesita el PIN del encargado.</p>
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

export function NoteSheet({ item, onClose, onSave }: { item: CheckItem | null; onClose: () => void; onSave: (note: string) => void }) {
  const [note, setNote] = useState("");
  useEffect(() => setNote(item?.note ?? ""), [item]);
  if (!item) return null;
  return (
    <Sheet open onClose={onClose} title={`Nota · ${item.name}`} footer={<button className={btn("primary", "lg", "w-full")} onClick={() => onSave(note)}>Guardar nota</button>}>
      <input data-autofocus className="h-12 w-full rounded-xl border border-linea-2 px-3 outline-none focus:border-tinto" value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} placeholder="Ej. sin hielo" />
      <div className="mt-3 flex flex-wrap gap-2">
        {["Sin hielo", "Sin azúcar", "Bien caliente", "Para compartir", "Sin cebolla"].map((n) => (
          <button key={n} onClick={() => setNote(n)} className="rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ring-linea-2">
            {n}
          </button>
        ))}
      </div>
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
