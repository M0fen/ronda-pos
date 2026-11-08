"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveIngredientAction, stockMoveAction } from "@/app/(pos)/panel/actions";
import { btn, Pill } from "@/components/ui";
import { fmtQty, fmtShort, fmtTime } from "@/lib/format";
import type { IngredientView, ProductCost } from "@/lib/server/inventory";
import { cop, parseQty } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Sheet } from "../sheet";
import { report } from "../toast";

type Ing = IngredientView & { label: string };
const KIND_LABEL: Record<string, string> = { compra: "Compra", merma: "Merma", conteo: "Conteo", anulacion: "Anulación", ajuste: "Ajuste" };

export function InventoryView({
  ingredients,
  costs,
  moves,
  canManage,
}: {
  ingredients: Ing[];
  costs: ProductCost[];
  moves: { id: string; name: string; unit: string; delta: number; reason: string; ref: string; created_at: string; staff: string | null }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<"insumos" | "recetas">("insumos");
  const [action, setAction] = useState<{ ing: Ing; kind: "compra" | "merma" | "conteo" } | null>(null);
  const [qty, setQty] = useState("");
  const [inPacks, setInPacks] = useState(true);
  const [total, setTotal] = useState("");
  const [confirmBig, setConfirmBig] = useState(false);
  const [editing, setEditing] = useState<Ing | "new" | null>(null);
  const low = ingredients.filter((i) => i.low).length;
  const value = ingredients.reduce((s, i) => s + i.value, 0);

  // "2.400" es dos mil cuatrocientos (punto de miles), no 2,4
  const typed = parseQty(qty);
  const realQty = action && Number.isFinite(typed) ? typed * (inPacks && action.ing.pack_size ? action.ing.pack_size : 1) : 0;
  // Un conteo o una merma que cambian más de la mitad de lo que hay piden confirmación
  const big = !!action && action.ing.stock > 0 && (action.kind === "conteo" ? Math.abs(realQty - action.ing.stock) / action.ing.stock > 0.5 : action.kind === "merma" ? realQty / action.ing.stock > 0.5 : false);
  const open = (ing: Ing, kind: "compra" | "merma" | "conteo") => (setAction({ ing, kind }), setQty(""), setTotal(""), setInPacks(!!ing.pack_size), setConfirmBig(false));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Inventario</h1>
          <p className="text-humo">
            Se descuenta solo con cada pedido, según la receta de cada producto. {low ? `${low} insumos bajo el mínimo.` : ""} Valor en bodega: {cop(value)}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage ? (
            <button className={btn("primary", "md")} onClick={() => setEditing("new")}>
              <Plus size={18} /> Nuevo insumo
            </button>
          ) : null}
          <div className="flex rounded-2xl bg-tinto/6 p-1">
            {(
              [
                ["insumos", "Insumos"],
                ["recetas", "Recetas y márgenes"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={cn("rounded-xl px-4 py-2 font-semibold", tab === k ? "bg-papel shadow-sm" : "text-tinto-2")}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>
      {!ingredients.length ? (
        <div className="mt-4 rounded-3xl bg-papel p-6 text-center ring-1 ring-linea">
          <p className="font-bold">Todavía no hay insumos</p>
          <p className="mt-1 text-humo">Crea lo que compras (café, leche, pan, cerveza) y luego ponle receta a cada producto en Carta: así se descuenta solo con cada venta.</p>
        </div>
      ) : null}

      {tab === "insumos" ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_340px]">
          {/* En el celular, una tarjeta por insumo con sus acciones a la vista */}
          <ul className="space-y-2 md:hidden">
            {ingredients.map((i) => (
              <li key={i.id} className="rounded-2xl bg-papel p-4 ring-1 ring-linea">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 font-semibold">
                      {i.name}
                      {canManage ? (
                        <button className="flex size-8 items-center justify-center rounded-lg hover:bg-tinto/6" aria-label={`Editar ${i.name}`} onClick={() => setEditing(i)}>
                          <Pencil size={14} />
                        </button>
                      ) : null}
                    </span>
                    <span className="block text-sm tnum">{i.label}</span>
                  </span>
                  {i.low ? <Pill tone="red">Bajo</Pill> : i.daysLeft !== null && i.daysLeft <= 3 ? <Pill tone="yellow">{i.daysLeft} días</Pill> : null}
                </div>
                <p className="mt-1 text-[13px] text-humo">
                  mínimo {fmtQty(i.min_stock, i.unit)}
                  {i.daysLeft !== null ? ` · alcanza ${i.daysLeft} días` : ""}
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {(["compra", "merma", "conteo"] as const).map((k) => (
                    <button key={k} className={btn("soft", "sm", "w-full")} onClick={() => open(i, k)}>
                      {KIND_LABEL[k]}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-3xl bg-papel ring-1 ring-linea md:block">
            <table className="w-full min-w-[720px] text-[15px]">
              <thead>
                <tr className="border-b border-linea text-left text-[13px] text-humo">
                  <th className="px-4 py-2.5 font-semibold">Insumo</th>
                  <th className="px-2 py-2.5 font-semibold">En bodega</th>
                  <th className="px-2 py-2.5 font-semibold">Gasto diario</th>
                  <th className="px-2 py-2.5 font-semibold">Alcanza</th>
                  <th className="px-2 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {ingredients.map((i) => (
                  <tr key={i.id} className="border-b border-linea last:border-0">
                    <td className="px-4 py-2.5">
                      {canManage ? (
                        <button className="flex items-center gap-1.5 text-left font-semibold underline-offset-4 hover:underline" onClick={() => setEditing(i)}>
                          {i.name} <Pencil size={13} className="text-humo" />
                        </button>
                      ) : (
                        <span className="font-semibold">{i.name}</span>
                      )}
                      <span className="block text-[13px] text-humo">
                        mínimo {fmtQty(i.min_stock, i.unit)} · {cop(i.cost * (i.pack_size ?? 1))} por {i.pack_label ?? i.unit}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 tnum">
                      {i.label} {i.low ? <Pill tone="red">Bajo</Pill> : null}
                    </td>
                    <td className="px-2 py-2.5 tnum text-humo">{i.dailyUse ? fmtQty(Math.round(i.dailyUse * 10) / 10, i.unit) : "—"}</td>
                    <td className="px-2 py-2.5 tnum">{i.daysLeft === null ? "—" : <span className={cn(i.daysLeft <= 3 && "font-bold text-cereza")}>{i.daysLeft} días</span>}</td>
                    <td className="px-2 py-2.5">
                      <div className="flex justify-end gap-1">
                        {(["compra", "merma", "conteo"] as const).map((k) => (
                          <button key={k} className={btn("soft", "sm")} onClick={() => open(i, k)}>
                            {KIND_LABEL[k]}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <aside className="h-fit rounded-3xl bg-papel p-5 ring-1 ring-linea">
            <p className="font-bold">Últimos movimientos</p>
            <ul className="mt-2 divide-y divide-linea">
              {moves.map((m) => (
                <li key={m.id} className="py-2 text-[15px]">
                  <span className="font-semibold">{KIND_LABEL[m.reason] ?? m.reason}</span> · {m.name}
                  <span className={cn("float-right tnum", Number(m.delta) < 0 ? "text-cereza" : "text-puerta-2")}>
                    {Number(m.delta) > 0 ? "+" : ""}
                    {fmtQty(Number(m.delta), m.unit)}
                  </span>
                  <span className="block text-[13px] text-humo">
                    {fmtShort(m.created_at)}, {fmtTime(m.created_at)} · {m.staff ?? "Sistema"} {m.ref ? `· ${m.ref}` : ""}
                  </span>
                </li>
              ))}
              {!moves.length ? <li className="py-2 text-sm text-humo">Aún no hay compras, mermas ni conteos.</li> : null}
            </ul>
          </aside>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {costs.map((c) => (
            <article key={c.id} className="rounded-3xl bg-papel p-4 ring-1 ring-linea">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{c.name}</p>
                  <p className="text-[13px] text-humo">{c.category}</p>
                </div>
                <Pill tone={c.margin < 60 ? "red" : c.margin < 75 ? "yellow" : "green"}>{c.margin} % margen</Pill>
              </div>
              <ul className="mt-3 space-y-1 text-[14px]">
                {c.recipe.map((r) => (
                  <li key={r.name} className="flex justify-between gap-2">
                    <span>
                      {fmtQty(r.qty, r.unit)} {r.name}
                    </span>
                    <span className="tnum text-humo">{cop(r.cost)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 flex justify-between border-t border-linea pt-2 text-[15px]">
                <span>
                  Costo <b className="tnum">{cop(c.cost)}</b>
                </span>
                <span>
                  Precio <b className="tnum">{cop(c.price)}</b>
                </span>
              </p>
            </article>
          ))}
        </div>
      )}

      <Sheet
        open={!!action}
        onClose={() => setAction(null)}
        title={action ? `${KIND_LABEL[action.kind]} · ${action.ing.name}` : ""}
        footer={
          <button
            className={btn("primary", "lg", "w-full")}
            disabled={pending || !qty || !Number.isFinite(typed)}
            onClick={() => {
              if (big && !confirmBig) return setConfirmBig(true);
              start(async () => {
                if (!action) return;
                const r = await stockMoveAction({ ingredientId: action.ing.id, kind: action.kind, qty: realQty, totalCost: action.kind === "compra" ? parseInt(total.replace(/\D/g, "") || "0", 10) : undefined });
                if (report(r)) {
                  setAction(null);
                  router.refresh();
                }
              });
            }}
          >
            {big && confirmBig ? `Sí, guardar ${fmtQty(realQty, action?.ing.unit ?? "")}` : `Guardar ${qty && Number.isFinite(typed) ? fmtQty(realQty, action?.ing.unit ?? "") : ""}`}
          </button>
        }
      >
        {action ? (
          <>
            <p className="text-sm text-humo">En bodega: {action.ing.label}</p>
            {action.ing.pack_size ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button onClick={() => setInPacks(true)} className={cn("h-11 rounded-xl font-semibold ring-1", inPacks ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}>
                  En {action.ing.pack_label}s
                </button>
                <button onClick={() => setInPacks(false)} className={cn("h-11 rounded-xl font-semibold ring-1", !inPacks ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}>
                  En {action.ing.unit}
                </button>
              </div>
            ) : null}
            <label className="mt-3 block">
              <span className="text-sm font-semibold text-humo">{action.kind === "conteo" ? "¿Cuánto hay contado?" : action.kind === "merma" ? "¿Cuánto se perdió?" : "¿Cuánto llegó?"}</span>
              <input
                inputMode="decimal"
                data-autofocus
                className="mt-1 h-14 w-full rounded-xl border border-linea-2 px-3 text-xl tnum outline-none focus:border-tinto"
                value={qty}
                onChange={(e) => (setQty(e.target.value.replace(/[^\d.,]/g, "")), setConfirmBig(false))}
              />
              {qty && Number.isFinite(typed) ? <span className="mt-1 block text-sm text-humo">Se guarda: {fmtQty(realQty, action.ing.unit)}</span> : null}
            </label>
            {big ? (
              <p className="mt-3 rounded-xl bg-fachada-soft px-3 py-2 text-sm font-semibold text-[#6b4b00]">
                Cambia más de la mitad de lo que hay ({action.ing.label}). Revisa la cantidad antes de guardar.
              </p>
            ) : null}
            {action.kind === "compra" ? (
              <label className="mt-3 block">
                <span className="text-sm font-semibold text-humo">Valor total de la compra (opcional, actualiza el costo)</span>
                <input inputMode="numeric" className="mt-1 h-12 w-full rounded-xl border border-linea-2 px-3 tnum outline-none focus:border-tinto" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="$0" />
              </label>
            ) : null}
            {action.kind === "conteo" && qty ? (
              <p className="mt-3 rounded-xl bg-cal px-3 py-2 text-[15px]">
                Diferencia contra el sistema: <b className="tnum">{fmtQty(Math.round((realQty - action.ing.stock) * 10) / 10, action.ing.unit)}</b>
              </p>
            ) : null}
          </>
        ) : null}
      </Sheet>
      {editing ? <IngredientSheet key={editing === "new" ? "new" : editing.id} ing={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), router.refresh())} /> : null}
    </div>
  );
}

const UNIT_NAME: Record<string, string> = { g: "gramos", ml: "mililitros", und: "unidades" };

/** Crear o corregir un insumo: cómo se mide, cómo se compra, cuánto cuesta y el mínimo para avisar. */
function IngredientSheet({ ing, onClose, onSaved }: { ing: Ing | null; onClose: () => void; onSaved: () => void }) {
  const [pending, start] = useTransition();
  const perOf = (unit: string, pack: string) => (parseQty(pack) > 0 ? parseQty(pack) : unit === "und" ? 1 : 1000);
  const [f, setF] = useState(() => {
    const unit = ing?.unit ?? "g";
    const pack = ing?.pack_size ? String(ing.pack_size) : "";
    return {
      name: ing?.name ?? "",
      unit,
      packLabel: ing?.pack_label ?? "",
      packSize: pack,
      price: ing ? String(Math.round(Number(ing.cost) * perOf(unit, pack))) : "",
      min: ing ? String(ing.min_stock) : "",
      initial: "",
    };
  });
  const hasPack = parseQty(f.packSize) > 0;
  const per = perOf(f.unit, f.packSize);
  const perLabel = hasPack ? `${f.packLabel || "presentación"} de ${fmtQty(per, f.unit)}` : f.unit === "und" ? "unidad" : `${fmtQty(1000, f.unit)}`;
  const field = "mt-1 h-12 w-full rounded-xl border border-linea-2 bg-papel px-3 outline-none focus:border-tinto";
  return (
    <Sheet
      open
      onClose={onClose}
      title={ing ? `Editar ${ing.name}` : "Nuevo insumo"}
      footer={
        <button
          className={btn("primary", "lg", "w-full")}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await saveIngredientAction({
                id: ing?.id ?? null,
                name: f.name,
                unit: f.unit,
                price: parseInt(f.price.replace(/\D/g, "") || "0", 10),
                perQty: per,
                minStock: parseQty(f.min) || 0,
                packSize: hasPack ? parseQty(f.packSize) : null,
                packLabel: hasPack ? f.packLabel : "",
                initialStock: ing ? 0 : (parseQty(f.initial) || 0) * (hasPack ? per : 1),
              });
              if (report(r)) onSaved();
            })
          }
        >
          {ing ? "Guardar" : "Crear insumo"}
        </button>
      }
    >
      <label className="block">
        <span className="text-sm font-semibold text-humo">Nombre</span>
        <input className={field} value={f.name} data-autofocus onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ej. Café en grano, Leche, Pan brioche" />
      </label>
      <p className="mt-3 text-sm font-semibold text-humo">Se mide en</p>
      <div className="mt-1 grid grid-cols-3 gap-2">
        {(["g", "ml", "und"] as const).map((u) => (
          <button key={u} onClick={() => setF({ ...f, unit: u })} className={cn("h-12 rounded-xl font-semibold ring-1", f.unit === u ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}>
            {UNIT_NAME[u]}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-sm font-semibold text-humo">Viene en (opcional)</span>
          <input className={field} value={f.packLabel} onChange={(e) => setF({ ...f, packLabel: e.target.value })} placeholder="bolsa, botella, caja" />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-humo">Que trae ({f.unit})</span>
          <input inputMode="decimal" className={cn(field, "tnum")} value={f.packSize} onChange={(e) => setF({ ...f, packSize: e.target.value.replace(/[^\d.,]/g, "") })} placeholder={f.unit === "und" ? "30" : "1.000"} />
        </label>
      </div>
      <label className="mt-3 block">
        <span className="text-sm font-semibold text-humo">Precio de compra por {perLabel}</span>
        <input inputMode="numeric" className={cn(field, "tnum")} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value.replace(/\D/g, "") })} placeholder="$0" />
        {f.price ? <span className="mt-1 block text-sm text-humo">Sale a {cop(Math.round((parseInt(f.price, 10) / per) * 100) / 100)} por {f.unit === "und" ? "unidad" : f.unit}</span> : null}
      </label>
      <label className="mt-3 block">
        <span className="text-sm font-semibold text-humo">Avisar cuando quede menos de ({f.unit})</span>
        <input inputMode="decimal" className={cn(field, "tnum")} value={f.min} onChange={(e) => setF({ ...f, min: e.target.value.replace(/[^\d.,]/g, "") })} placeholder="0" />
      </label>
      {!ing ? (
        <label className="mt-3 block">
          <span className="text-sm font-semibold text-humo">Lo que hay hoy en bodega {hasPack ? `(en ${f.packLabel || "presentaciones"})` : `(${f.unit})`}</span>
          <input inputMode="decimal" className={cn(field, "tnum")} value={f.initial} onChange={(e) => setF({ ...f, initial: e.target.value.replace(/[^\d.,]/g, "") })} placeholder="0" />
        </label>
      ) : (
        <p className="mt-3 text-sm text-humo">Para cambiar lo que hay en bodega usa Compra, Merma o Conteo: así queda el registro.</p>
      )}
    </Sheet>
  );
}
