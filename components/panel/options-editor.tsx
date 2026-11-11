"use client";

import { ChevronRight, Minus, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteOptionGroupAction, saveOptionGroupAction } from "@/app/(pos)/panel/actions";
import { btn } from "@/components/ui";
import type { OptionGroupView } from "@/lib/server/catalog";
import { cop, parsePesos, parseQty } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Sheet } from "../sheet";
import { report, toast } from "../toast";
import { type Ingredient, RecipeLines, type RecipeLine, recipeCost } from "./recipe-lines";

type OptionDraft = { key: string; id: string | null; name: string; price: string; isDefault: boolean; code: string; soldOut: boolean; recipe: RecipeLine[]; open: boolean };
type GroupDraft = { id: string | null; name: string; min: number; max: number; options: OptionDraft[] };

const field = "h-11 w-full rounded-lg border border-linea-2 bg-papel px-3 outline-none focus:border-tinto";
let seq = 0;
const blank = (): OptionDraft => ({ key: `n${++seq}`, id: null, name: "", price: "", isDefault: false, code: "", soldOut: false, recipe: [], open: false });

function toDraft(g: OptionGroupView): GroupDraft {
  return {
    id: g.id,
    name: g.name,
    min: g.min,
    max: g.max,
    options: g.options.map((o) => ({
      key: o.id,
      id: o.id,
      name: o.name,
      price: o.price ? String(o.price) : "",
      isDefault: o.isDefault,
      code: o.code ?? "",
      soldOut: o.soldOut,
      recipe: o.recipe.map((r) => ({ ingredientId: r.ingredientId, qty: String(r.qty).replace(".", ",") })),
      open: false,
    })),
  };
}

export function describeRule(min: number, max: number) {
  if (min === max) return `Elige ${max}${min ? "" : " o ninguna"}`;
  if (!min) return max === 1 ? "Opcional, una" : `Opcional, hasta ${max}`;
  return `Elige de ${min} a ${max}`;
}

/** Grupos de opciones (Salsa, Adiciones, Término): sus opciones con precio, código, agotado y lo que gastan. */
export function OptionsSheet({ open, onClose, groups, ingredients }: { open: boolean; onClose: () => void; groups: OptionGroupView[]; ingredients: Ingredient[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [edit, setEdit] = useState<GroupDraft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const close = () => (setEdit(null), setConfirmDelete(false), onClose());
  const setOption = (key: string, patch: Partial<OptionDraft>) => edit && setEdit({ ...edit, options: edit.options.map((o) => (o.key === key ? { ...o, ...patch } : o)) });
  const save = () =>
    edit &&
    start(async () => {
      const bad = edit.options.find((o) => o.recipe.some((r) => !(parseQty(r.qty) > 0)));
      if (bad) return void toast(`Escribe cuánto gasta ${bad.name || "cada opción"}`, { tone: "error" });
      const ok = report(
        await saveOptionGroupAction({
          id: edit.id,
          name: edit.name,
          min: edit.min,
          max: edit.max,
          options: edit.options.map((o) => ({
            id: o.id,
            name: o.name,
            price: parsePesos(o.price) || 0,
            isDefault: o.isDefault,
            code: o.code || null,
            soldOut: o.soldOut,
            recipe: o.recipe.map((r) => ({ ingredientId: r.ingredientId, qty: parseQty(r.qty) })),
          })),
        }),
      );
      if (ok) (setEdit(null), router.refresh());
    });
  const remove = () =>
    edit?.id &&
    start(async () => {
      if (report(await deleteOptionGroupAction(edit.id!))) (setEdit(null), setConfirmDelete(false), router.refresh());
    });

  if (edit)
    return (
      <Sheet
        open={open}
        onClose={close}
        title={edit.id ? edit.name || "Grupo" : "Nuevo grupo de opciones"}
        wide
        footer={
          <div className="flex gap-2">
            <button className={btn("ghost", "lg")} onClick={() => setEdit(null)}>
              Atrás
            </button>
            <button className={btn("primary", "lg", "flex-1")} disabled={pending} onClick={save}>
              Guardar
            </button>
          </div>
        }
      >
        <label className="block">
          <span className="text-sm font-semibold text-humo">Nombre del grupo</span>
          <input className={cn(field, "mt-1 h-12")} value={edit.name} maxLength={40} placeholder="Ej. Salsa, Adiciones, Término" onChange={(e) => setEdit({ ...edit, name: e.target.value })} data-autofocus />
        </label>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Stepper label="Mínimo (1 o más: obligatoria)" value={edit.min} min={0} max={edit.max} onChange={(min) => setEdit({ ...edit, min })} />
          <Stepper label="Máximo" value={edit.max} min={Math.max(1, edit.min)} max={10} onChange={(max) => setEdit({ ...edit, max })} />
        </div>
        <p className="mt-2 text-sm text-humo">{describeRule(edit.min, edit.max)}. Con mínimo 1 y una opción por defecto, se elige sola si nadie cambia.</p>

        <h3 className="mt-5 font-bold">Opciones</h3>
        <ul className="mt-2 space-y-2">
          {edit.options.map((o, i) => {
            const cost = recipeCost(o.recipe, ingredients);
            return (
              <li key={o.key} className={cn("rounded-2xl bg-cal p-3", o.soldOut && "ring-1 ring-cereza")}>
                <div className="grid grid-cols-[minmax(0,1fr)_7.5rem_auto] items-end gap-2">
                  <label className="block">
                    <span className="text-[13px] font-semibold text-humo">Opción {i + 1}</span>
                    <input className={cn(field, "mt-1")} value={o.name} maxLength={40} placeholder="Ej. Tocineta" onChange={(e) => setOption(o.key, { name: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className="text-[13px] font-semibold text-humo">Suma al precio</span>
                    <input
                      className={cn(field, "mt-1 text-right tnum")}
                      inputMode="numeric"
                      placeholder="$0"
                      value={o.price}
                      aria-label={`Precio de ${o.name || `la opción ${i + 1}`}`}
                      onChange={(e) => setOption(o.key, { price: e.target.value.replace(/\D/g, "") })}
                    />
                  </label>
                  <button
                    className="flex size-11 items-center justify-center rounded-lg text-humo hover:bg-tinto/6"
                    aria-label={`Quitar ${o.name || `la opción ${i + 1}`}`}
                    onClick={() => setEdit({ ...edit, options: edit.options.filter((x) => x.key !== o.key) })}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="flex min-h-11 items-center gap-2 rounded-xl bg-papel px-3 font-semibold ring-1 ring-linea-2">
                    <input type="checkbox" className="size-5 accent-[var(--color-balcon)]" checked={o.isDefault} onChange={(e) => setOption(o.key, { isDefault: e.target.checked })} />
                    Por defecto
                  </label>
                  <label className="flex min-h-11 items-center gap-2 rounded-xl bg-papel px-3 font-semibold ring-1 ring-linea-2 has-[:checked]:bg-cereza-soft has-[:checked]:ring-cereza">
                    <input type="checkbox" className="size-5 accent-[var(--color-cereza)]" checked={o.soldOut} onChange={(e) => setOption(o.key, { soldOut: e.target.checked })} />
                    Agotada
                  </label>
                  <input
                    className="h-11 w-36 rounded-xl border border-linea-2 bg-papel px-3 uppercase outline-none focus:border-tinto"
                    value={o.code}
                    maxLength={30}
                    placeholder="Código"
                    aria-label={`Código de ${o.name || `la opción ${i + 1}`}`}
                    onChange={(e) => setOption(o.key, { code: e.target.value })}
                  />
                  <button className="ml-auto flex min-h-11 items-center gap-1 rounded-xl px-3 font-semibold text-balcon hover:bg-tinto/6" onClick={() => setOption(o.key, { open: !o.open })} aria-expanded={o.open}>
                    {o.recipe.length ? `Gasta ${cop(Math.round(cost))}` : "Lo que gasta"} <ChevronRight size={16} className={cn("transition-transform", o.open && "rotate-90")} />
                  </button>
                </div>
                {o.open ? (
                  <div className="mt-3 rounded-xl bg-papel p-3">
                    <p className="mb-2 text-sm text-humo">Por cada vez que se pide. Se descuenta del inventario y suma al costo.</p>
                    <RecipeLines lines={o.recipe} setLines={(recipe) => setOption(o.key, { recipe })} ingredients={ingredients} compact />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        <button className={btn("soft", "md", "mt-3")} onClick={() => setEdit({ ...edit, options: [...edit.options, blank()] })}>
          <Plus size={16} /> Agregar opción
        </button>

        {edit.id ? (
          <div className="mt-6 border-t border-linea pt-4">
            {confirmDelete ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className="flex-1 text-sm">Se quita de todos los productos que lo usan. Lo ya vendido no cambia.</p>
                <button className={btn("ghost", "md")} onClick={() => setConfirmDelete(false)}>
                  No
                </button>
                <button className={btn("danger", "md")} disabled={pending} onClick={remove}>
                  Sí, borrar
                </button>
              </div>
            ) : (
              <button className="flex min-h-11 items-center gap-2 rounded-xl px-2 font-semibold text-cereza hover:bg-cereza-soft" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={16} /> Borrar grupo
              </button>
            )}
          </div>
        ) : null}
      </Sheet>
    );

  return (
    <Sheet open={open} onClose={close} title="Opciones" wide>
      <p className="text-humo">Grupos como Salsa o Adiciones. Cada producto elige los suyos desde su hoja. Una opción puede sumar al precio, gastar insumos y agotarse.</p>
      <ul className="mt-4 space-y-2">
        {groups.map((g) => (
          <li key={g.id}>
            <button className="flex w-full items-center gap-3 rounded-2xl bg-papel px-4 py-3 text-left ring-1 ring-linea hover:ring-tinto" onClick={() => setEdit(toDraft(g))}>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{g.name}</span>
                <span className="block text-sm text-humo">
                  {describeRule(g.min, g.max)} · {g.options.length} {g.options.length === 1 ? "opción" : "opciones"}
                  {g.options.some((o) => o.soldOut) ? ` · ${g.options.filter((o) => o.soldOut).length} agotada${g.options.filter((o) => o.soldOut).length === 1 ? "" : "s"}` : ""} ·{" "}
                  {g.products ? `en ${g.products} ${g.products === 1 ? "producto" : "productos"}` : "sin productos"}
                </span>
              </span>
              <ChevronRight size={18} className="shrink-0 text-humo" />
            </button>
          </li>
        ))}
      </ul>
      {!groups.length ? <p className="mt-2 rounded-2xl bg-cal p-4 text-humo">Todavía no hay grupos. Ej. Salsa (elige 1) o Adiciones (hasta 3, con precio).</p> : null}
      <button className={btn("primary", "md", "mt-4")} onClick={() => setEdit({ id: null, name: "", min: 0, max: 1, options: [blank()] })}>
        <Plus size={16} /> Nuevo grupo
      </button>
    </Sheet>
  );
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div>
      <span className="text-sm font-semibold text-humo">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <button className="flex size-12 items-center justify-center rounded-xl ring-1 ring-linea-2 disabled:opacity-40" disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={`${label}: una menos`}>
          <Minus size={18} />
        </button>
        <span className="w-10 text-center text-xl font-bold tnum">{value}</span>
        <button className="flex size-12 items-center justify-center rounded-xl ring-1 ring-linea-2 disabled:opacity-40" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={`${label}: una más`}>
          <Plus size={18} />
        </button>
      </div>
    </div>
  );
}
