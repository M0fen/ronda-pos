"use client";

import { ArrowDown, ArrowUp, Pencil, Plus, Star, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createProductAction, deleteCategoryAction, moveCategoryAction, saveCategoryAction, setRecipeAction, updateProductAction } from "@/app/(pos)/panel/actions";
import { btn } from "@/components/ui";
import { fmtQty } from "@/lib/format";
import type { Menu, MenuCategory, MenuProduct } from "@/lib/server/menu";
import { cop, parsePesos, parseQty } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Sheet } from "../sheet";
import { report, toast } from "../toast";

type Ingredient = { id: string; name: string; unit: string; cost: number };
type Recipe = Record<string, { ingredientId: string; qty: number }[]>;

const COLORS = ["#7A4A2A", "#C2541B", "#D2232A", "#B07800", "#E0A100", "#0B7A55", "#1E4FB8", "#6B3FA0"];
const input = "mt-1 h-12 w-full rounded-xl border border-linea-2 bg-papel px-3 outline-none focus:border-tinto";

export function MenuEditor({ menu, costs, ingredients, recipes }: { menu: Menu; costs: Record<string, { cost: number; margin: number }>; ingredients: Ingredient[]; recipes: Recipe }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [cats, setCats] = useState(false);
  const [editing, setEditing] = useState<MenuProduct | null>(null);
  const [draft, setDraft] = useState({ name: "", categoryId: menu.categories[0]?.id ?? "", price: "" });
  const save = (id: string, patch: Parameters<typeof updateProductAction>[1]) =>
    new Promise<boolean>((resolve) =>
      start(async () => {
        const ok = report(await updateProductAction(id, patch));
        if (ok) router.refresh();
        resolve(ok);
      }),
    );
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Carta</h1>
          <p className="text-humo">Los cambios se ven al instante en la caja y en la carta QR. El margen sale de la receta y el costo de los insumos.</p>
        </div>
        <div className="flex gap-2">
          <button className={btn("soft", "md")} onClick={() => setCats(true)}>
            Categorías
          </button>
          <button
            className={btn("primary", "md")}
            onClick={() => (menu.categories.length ? (setDraft((d) => ({ ...d, categoryId: d.categoryId || menu.categories[0]!.id })), setAdding(true)) : setCats(true))}
          >
            <Plus size={18} /> Nuevo producto
          </button>
        </div>
      </div>
      {!menu.categories.length ? (
        <div className="mt-6 rounded-3xl bg-papel p-6 text-center ring-1 ring-linea">
          <p className="font-bold">Empieza por las categorías</p>
          <p className="mt-1 text-humo">Ej. Café, Bebidas frías, Cocina, Cervezas. Cada una va a la pantalla de barra o de cocina.</p>
          <button className={btn("primary", "lg", "mt-4")} onClick={() => setCats(true)}>
            Crear categorías
          </button>
        </div>
      ) : null}
      <div className="mt-4 space-y-5">
        {menu.categories.map((c) => {
          const products = menu.products.filter((p) => p.categoryId === c.id);
          return (
            <section key={c.id}>
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <span className="size-3 rounded-full" style={{ background: c.color }} /> {c.name}
                <span className="text-sm font-normal text-humo">· {c.station === "cocina" ? "cocina" : "barra"}</span>
              </h2>
              {products.length ? (
                <div className="mt-2 rounded-2xl bg-papel text-[15px] ring-1 ring-linea">
                  <div className={cn(ROW_GRID, "hidden border-b border-linea px-4 py-2 text-[13px] font-semibold text-humo lg:grid")}>
                    <span className="[grid-area:name]">Producto</span>
                    <span className="[grid-area:price]">Precio</span>
                    <span className="[grid-area:happy]">Happy hour</span>
                    <span className="[grid-area:cost]">Costo y margen</span>
                    <span className="text-center [grid-area:soldout]">Agotado</span>
                    <span className="text-center [grid-area:visible]">Visible</span>
                    <span className="text-center [grid-area:fav]">Favorito</span>
                  </div>
                  {products.map((p) => (
                    <Row key={`${p.id}:${p.basePrice}:${p.happyPrice}`} p={p} cost={costs[p.id]} save={save} disabled={pending} onEdit={() => setEditing(p)} />
                  ))}
                </div>
              ) : (
                <p className="mt-2 rounded-2xl bg-papel px-4 py-3 text-humo ring-1 ring-linea">Sin productos todavía.</p>
              )}
            </section>
          );
        })}
      </div>

      <Sheet
        open={adding}
        onClose={() => setAdding(false)}
        title="Nuevo producto"
        footer={
          <button
            className={btn("primary", "lg", "w-full")}
            disabled={pending}
            onClick={() => {
              if (draft.name.trim().length < 2) return toast("Escribe el nombre", { tone: "error" });
              if (!parsePesos(draft.price)) return toast("Escribe el precio", { tone: "error" });
              start(async () => {
                if (report(await createProductAction({ name: draft.name, categoryId: draft.categoryId, price: parsePesos(draft.price) }))) {
                  setAdding(false);
                  setDraft((d) => ({ ...d, name: "", price: "" }));
                  router.refresh();
                }
              });
            }}
          >
            Crear producto
          </button>
        }
      >
        <label className="block">
          <span className="text-sm font-semibold text-humo">Nombre</span>
          <input className={input} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label className="mt-3 block">
          <span className="text-sm font-semibold text-humo">Categoría</span>
          <select className={input} value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>
            {menu.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block">
          <span className="text-sm font-semibold text-humo">Precio con impuesto</span>
          <input inputMode="numeric" className={cn(input, "tnum")} value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value.replace(/\D/g, "") })} placeholder="$0" />
        </label>
        <p className="mt-3 text-sm text-humo">Después le pones la receta: tócalo en la lista.</p>
      </Sheet>

      <CategoriesSheet open={cats} onClose={() => setCats(false)} categories={menu.categories} counts={countBy(menu.products)} />
      {editing ? (
        <ProductSheet
          key={editing.id}
          product={editing}
          categories={menu.categories}
          ingredients={ingredients}
          recipe={recipes[editing.id] ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => (setEditing(null), router.refresh())}
        />
      ) : null}
    </div>
  );
}

function countBy(products: MenuProduct[]) {
  const out: Record<string, number> = {};
  for (const p of products) out[p.categoryId] = (out[p.categoryId] ?? 0) + 1;
  return out;
}

function Row({
  p,
  cost,
  save,
  disabled,
  onEdit,
}: {
  p: MenuProduct;
  cost?: { cost: number; margin: number };
  save: (id: string, patch: Parameters<typeof updateProductAction>[1]) => Promise<boolean>;
  disabled: boolean;
  onEdit: () => void;
}) {
  const [price, setPrice] = useState(String(p.basePrice));
  const [happy, setHappy] = useState(p.happyPrice ? String(p.happyPrice) : "");
  const [soldOut, setSoldOut] = useState(p.soldOut);
  const [active, setActive] = useState(p.active);
  const savePrice = async () => {
    const value = parsePesos(price);
    if (value === p.basePrice) return;
    // Un precio vacío o en $0 no se guarda: vuelve al que tenía
    if (!value) return setPrice(String(p.basePrice)), toast("El precio no puede quedar vacío", { tone: "error" });
    if (p.happyPrice && value <= p.happyPrice) return setPrice(String(p.basePrice)), toast("Queda igual o por debajo del happy hour: cambia ese primero", { tone: "error" });
    if (!(await save(p.id, { price: value }))) setPrice(String(p.basePrice));
  };
  const saveHappy = async () => {
    const value = parsePesos(happy) || null;
    if (value === p.happyPrice) return;
    if (value !== null && value >= p.basePrice) return setHappy(p.happyPrice ? String(p.happyPrice) : ""), toast("El happy hour tiene que ser más barato que el precio normal", { tone: "error" });
    if (!(await save(p.id, { happyPrice: value }))) setHappy(p.happyPrice ? String(p.happyPrice) : "");
  };
  return (
    <div className={cn(ROW_GRID, "border-b border-linea px-4 py-3 last:border-0 lg:py-2", !active && "opacity-50")}>
      <button className="flex min-h-10 items-center gap-2 text-left font-semibold underline-offset-4 [grid-area:name] hover:underline" onClick={onEdit}>
        {p.name} <Pencil size={14} className="shrink-0 text-humo" />
      </button>
      <label className="grid gap-1 [grid-area:price]">
        <span className="text-[13px] font-semibold text-humo lg:sr-only">Precio</span>
        <input
          inputMode="numeric"
          className="h-11 w-full rounded-lg border border-linea-2 px-2 text-right tnum outline-none focus:border-tinto lg:h-10 lg:w-28"
          value={price}
          onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))}
          onBlur={savePrice}
          aria-label={`Precio de ${p.name}`}
        />
      </label>
      <label className="grid gap-1 [grid-area:happy]">
        <span className="text-[13px] font-semibold text-humo lg:sr-only">Happy hour</span>
        <input
          inputMode="numeric"
          className="h-11 w-full rounded-lg border border-linea-2 px-2 text-right tnum outline-none focus:border-tinto lg:h-10 lg:w-28"
          value={happy}
          placeholder="—"
          onChange={(e) => setHappy(e.target.value.replace(/\D/g, ""))}
          onBlur={saveHappy}
          aria-label={`Precio de happy hour de ${p.name}`}
        />
      </label>
      <div className="text-[14px] [grid-area:cost]">
        {cost && cost.cost ? (
          <span>
            <span className="text-humo lg:hidden">Costo </span>
            {cop(cost.cost)} · <span className="text-humo lg:hidden">margen </span>
            <span className={cn("font-semibold", cost.margin < 60 ? "text-cereza" : "text-puerta-2")}>{cost.margin} %</span>
          </span>
        ) : (
          <button className="min-h-10 text-humo underline underline-offset-4" onClick={onEdit}>
            Sin receta
          </button>
        )}
      </div>
      {/* En el celular, interruptores grandes con su nombre; en la tabla, una casilla por columna */}
      <div className="flex gap-2 [grid-area:flags] lg:contents">
        <label className={cn(TOGGLE, "has-[:checked]:bg-cereza-soft has-[:checked]:ring-cereza lg:[grid-area:soldout] lg:has-[:checked]:bg-transparent")}>
          <input type="checkbox" className="size-5 accent-[var(--color-cereza)]" checked={soldOut} onChange={(e) => (setSoldOut(e.target.checked), save(p.id, { soldOut: e.target.checked }))} aria-label={`${p.name} agotado`} />
          <span className="lg:sr-only">Agotado</span>
        </label>
        <label className={cn(TOGGLE, "lg:[grid-area:visible]")}>
          <input type="checkbox" className="size-5 accent-[var(--color-balcon)]" checked={active} onChange={(e) => (setActive(e.target.checked), save(p.id, { active: e.target.checked }))} aria-label={`${p.name} visible`} />
          <span className="lg:sr-only">Visible</span>
        </label>
      </div>
      <button
        onClick={() => save(p.id, { favorite: !p.favorite })}
        disabled={disabled}
        aria-pressed={p.favorite}
        aria-label={`${p.name} favorito`}
        className="inline-flex size-11 items-center justify-center justify-self-end rounded-lg [grid-area:fav] hover:bg-tinto/6 lg:size-9 lg:justify-self-center"
      >
        <Star size={18} className={p.favorite ? "fill-fachada text-fachada" : "text-humo"} />
      </button>
    </div>
  );
}

// Una fila por producto. Desde la tablet horizontal, columnas de tabla; en el celular y la tablet vertical, una tarjeta con todo a la vista
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-x-3 gap-y-2 [grid-template-areas:'name_name_fav'_'price_happy_happy'_'cost_cost_cost'_'flags_flags_flags'] lg:grid-cols-[minmax(0,1fr)_7.5rem_7.5rem_10rem_5rem_5rem_4.5rem] lg:items-center lg:gap-y-0 lg:[grid-template-areas:'name_price_happy_cost_soldout_visible_fav']";
const TOGGLE =
  "flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-3 font-semibold ring-1 ring-linea-2 lg:min-h-10 lg:flex-none lg:rounded-lg lg:px-0 lg:ring-0";

/** Nombre, descripción, categoría, pantalla y receta de un producto. */
function ProductSheet({
  product,
  categories,
  ingredients,
  recipe,
  onClose,
  onSaved,
}: {
  product: MenuProduct;
  categories: MenuCategory[];
  ingredients: Ingredient[];
  recipe: { ingredientId: string; qty: number }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const [f, setF] = useState({ name: product.name, description: product.description, categoryId: product.categoryId, station: product.station });
  const [lines, setLines] = useState(recipe.map((r) => ({ ingredientId: r.ingredientId, qty: String(r.qty).replace(".", ",") })));
  const [pick, setPick] = useState("");
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const cost = lines.reduce((s, l) => s + (parseQty(l.qty) || 0) * (byId.get(l.ingredientId)?.cost ?? 0), 0);
  const base = product.basePrice / (1 + product.taxRate / 100);
  const margin = base ? Math.round(((base - cost) / base) * 100) : 0;
  const recipeChanged = JSON.stringify(lines.map((l) => [l.ingredientId, parseQty(l.qty)])) !== JSON.stringify(recipe.map((r) => [r.ingredientId, r.qty]));
  const submit = () =>
    start(async () => {
      const bad = lines.find((l) => !(parseQty(l.qty) > 0));
      if (bad) return void toast(`Escribe cuánto lleva de ${byId.get(bad.ingredientId)?.name ?? "cada insumo"}`, { tone: "error" });
      const patch: Parameters<typeof updateProductAction>[1] = {};
      if (f.name.trim() !== product.name) patch.name = f.name;
      if (f.description.trim() !== product.description) patch.description = f.description;
      if (f.categoryId !== product.categoryId) patch.categoryId = f.categoryId;
      if (f.station !== product.station) patch.station = f.station;
      if (Object.keys(patch).length && !report(await updateProductAction(product.id, patch))) return;
      if (recipeChanged && !report(await setRecipeAction(product.id, lines.map((l) => ({ ingredientId: l.ingredientId, qty: parseQty(l.qty) }))))) return;
      if (!Object.keys(patch).length && !recipeChanged) toast("Sin cambios");
      onSaved();
    });
  return (
    <Sheet
      open
      onClose={onClose}
      title={product.name}
      wide
      footer={
        <button className={btn("primary", "lg", "w-full")} disabled={pending} onClick={submit}>
          Guardar
        </button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="text-sm font-semibold text-humo">Nombre</span>
          <input className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-sm font-semibold text-humo">Descripción para la carta QR (opcional)</span>
          <input className={input} value={f.description} maxLength={200} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-humo">Categoría</span>
          <select className={input} value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div>
          <span className="text-sm font-semibold text-humo">Se prepara en</span>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {(["barra", "cocina"] as const).map((s) => (
              <button key={s} onClick={() => setF({ ...f, station: s })} className={cn("h-12 rounded-xl font-semibold ring-1", f.station === s ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}>
                {s === "barra" ? "Barra" : "Cocina"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-2xl bg-cal p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-bold">Receta</p>
          <p className="text-sm">
            Costo <b className="tnum">{cop(Math.round(cost))}</b> · margen <b className={cn("tnum", margin < 60 ? "text-cereza" : "text-puerta-2")}>{lines.length ? `${margin} %` : "—"}</b>
          </p>
        </div>
        <p className="text-sm text-humo">Lo que lleva una unidad. Con cada venta se descuenta del inventario.</p>
        <ul className="mt-3 space-y-2">
          {lines.map((l, i) => {
            const ing = byId.get(l.ingredientId);
            return (
              <li key={l.ingredientId} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{ing?.name ?? "Insumo borrado"}</span>
                <input
                  inputMode="decimal"
                  className="h-11 w-24 rounded-lg border border-linea-2 bg-papel px-2 text-right tnum outline-none focus:border-tinto"
                  value={l.qty}
                  aria-label={`Cantidad de ${ing?.name ?? "insumo"}`}
                  onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value.replace(/[^\d.,]/g, "") } : x)))}
                />
                <span className="w-9 text-sm text-humo">{ing?.unit}</span>
                <span className="w-20 text-right text-sm tnum text-humo">{cop(Math.round((parseQty(l.qty) || 0) * (ing?.cost ?? 0)))}</span>
                <button className="flex size-10 items-center justify-center rounded-lg hover:bg-tinto/6" aria-label={`Quitar ${ing?.name ?? "insumo"}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                  <X size={16} />
                </button>
              </li>
            );
          })}
        </ul>
        {ingredients.length ? (
          <div className="mt-3 flex gap-2">
            <select className="h-11 min-w-0 flex-1 rounded-xl border border-linea-2 bg-papel px-3 outline-none focus:border-tinto" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Insumo para agregar">
              <option value="">Agregar insumo…</option>
              {ingredients
                .filter((i) => !lines.some((l) => l.ingredientId === i.id))
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.unit})
                  </option>
                ))}
            </select>
            <button className={btn("soft", "md")} disabled={!pick} onClick={() => (setLines([...lines, { ingredientId: pick, qty: "" }]), setPick(""))}>
              <Plus size={16} /> Agregar
            </button>
          </div>
        ) : (
          <p className="mt-3 text-sm">Primero crea los insumos en Panel → Inventario.</p>
        )}
        {lines.length ? (
          <p className="mt-2 text-[13px] text-humo">
            Ej. un capuchino: {fmtQty(18, "g")} de café y {fmtQty(150, "ml")} de leche.
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

/** Categorías: nombre, color, pantalla (barra o cocina) y orden en la caja y en la carta QR. */
function CategoriesSheet({ open, onClose, categories, counts }: { open: boolean; onClose: () => void; categories: MenuCategory[]; counts: Record<string, number> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [edit, setEdit] = useState<{ id: string | null; name: string; color: string; station: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) =>
    start(async () => {
      if (report(await fn())) {
        after?.();
        router.refresh();
      }
    });
  return (
    <Sheet
      open={open}
      onClose={() => (setEdit(null), onClose())}
      title={edit ? (edit.id ? "Editar categoría" : "Nueva categoría") : "Categorías"}
      footer={
        edit ? (
          <button className={btn("primary", "lg", "w-full")} disabled={pending} onClick={() => run(() => saveCategoryAction(edit), () => setEdit(null))}>
            Guardar
          </button>
        ) : (
          <button className={btn("primary", "lg", "w-full")} onClick={() => (setConfirmDelete(false), setEdit({ id: null, name: "", color: COLORS[categories.length % COLORS.length]!, station: "barra" }))}>
            <Plus size={18} /> Nueva categoría
          </button>
        )
      }
    >
      {edit ? (
        <div>
          <label className="block">
            <span className="text-sm font-semibold text-humo">Nombre</span>
            <input className={input} value={edit.name} data-autofocus onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Ej. Café, Cervezas, Platos" />
          </label>
          <p className="mt-3 text-sm font-semibold text-humo">Color</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button key={c} onClick={() => setEdit({ ...edit, color: c })} aria-label={`Color ${c}`} aria-pressed={edit.color === c} className={cn("size-11 rounded-full ring-offset-2", edit.color === c && "ring-2 ring-tinto")} style={{ background: c }} />
            ))}
          </div>
          <p className="mt-3 text-sm font-semibold text-humo">Sus productos salen en</p>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {(["barra", "cocina"] as const).map((s) => (
              <button key={s} onClick={() => setEdit({ ...edit, station: s })} className={cn("h-12 rounded-xl font-semibold ring-1", edit.station === s ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}>
                {s === "barra" ? "Barra" : "Cocina"}
              </button>
            ))}
          </div>
          {edit.id ? (
            <div className="mt-5 border-t border-linea pt-4">
              {confirmDelete ? (
                <button className={btn("danger", "md", "w-full")} disabled={pending} onClick={() => run(() => deleteCategoryAction(edit.id!), () => setEdit(null))}>
                  Sí, borrar la categoría
                </button>
              ) : (
                <button className={btn("ghost", "md", "text-cereza")} onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={16} /> Borrar categoría
                </button>
              )}
            </div>
          ) : null}
          <button className={btn("ghost", "md", "mt-2")} onClick={() => setEdit(null)}>
            Volver a la lista
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-linea">
          {categories.map((c, i) => (
            <li key={c.id} className="flex items-center gap-2 py-2">
              <span className="size-4 shrink-0 rounded-full" style={{ background: c.color }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{c.name}</span>
                <span className="text-[13px] text-humo">
                  {c.station === "cocina" ? "Cocina" : "Barra"} · {counts[c.id] ?? 0} productos
                </span>
              </span>
              <button className="flex size-10 items-center justify-center rounded-lg hover:bg-tinto/6 disabled:opacity-30" disabled={pending || i === 0} aria-label={`Subir ${c.name}`} onClick={() => run(() => moveCategoryAction(c.id, -1))}>
                <ArrowUp size={16} />
              </button>
              <button
                className="flex size-10 items-center justify-center rounded-lg hover:bg-tinto/6 disabled:opacity-30"
                disabled={pending || i === categories.length - 1}
                aria-label={`Bajar ${c.name}`}
                onClick={() => run(() => moveCategoryAction(c.id, 1))}
              >
                <ArrowDown size={16} />
              </button>
              <button className="flex size-10 items-center justify-center rounded-lg hover:bg-tinto/6" aria-label={`Editar ${c.name}`} onClick={() => (setConfirmDelete(false), setEdit({ id: c.id, name: c.name, color: c.color, station: c.station }))}>
                <Pencil size={16} />
              </button>
            </li>
          ))}
          {!categories.length ? <li className="py-4 text-center text-humo">Todavía no hay categorías.</li> : null}
        </ul>
      )}
    </Sheet>
  );
}
