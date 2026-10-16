"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { stockMoveAction } from "@/app/(pos)/panel/actions";
import { btn, Pill } from "@/components/ui";
import { fmtQty, fmtShort, fmtTime } from "@/lib/format";
import type { IngredientView, ProductCost } from "@/lib/server/inventory";
import { cop } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Sheet } from "../sheet";
import { report } from "../toast";

type Ing = IngredientView & { label: string };
const KIND_LABEL: Record<string, string> = { compra: "Compra", merma: "Merma", conteo: "Conteo", anulacion: "Anulación", ajuste: "Ajuste" };

export function InventoryView({ ingredients, costs, moves }: { ingredients: Ing[]; costs: ProductCost[]; moves: { id: string; name: string; unit: string; delta: number; reason: string; ref: string; created_at: string; staff: string | null }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<"insumos" | "recetas">("insumos");
  const [action, setAction] = useState<{ ing: Ing; kind: "compra" | "merma" | "conteo" } | null>(null);
  const [qty, setQty] = useState("");
  const [inPacks, setInPacks] = useState(true);
  const [total, setTotal] = useState("");
  const low = ingredients.filter((i) => i.low).length;
  const value = ingredients.reduce((s, i) => s + i.value, 0);

  const realQty = action ? (parseFloat(qty.replace(",", ".") || "0") * (inPacks && action.ing.pack_size ? action.ing.pack_size : 1)) : 0;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Inventario</h1>
          <p className="text-humo">
            Se descuenta solo con cada pedido, según la receta: un trago son 30 ml, un espresso 18 g. {low ? `${low} insumos bajo el mínimo.` : ""} Valor en bodega: {cop(value)}.
          </p>
        </div>
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

      {tab === "insumos" ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_340px]">
          <div className="overflow-x-auto rounded-3xl bg-papel ring-1 ring-linea">
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
                      <span className="font-semibold">{i.name}</span>
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
                          <button key={k} className={btn("soft", "sm")} onClick={() => (setAction({ ing: i, kind: k }), setQty(""), setTotal(""), setInPacks(!!i.pack_size))}>
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
            disabled={pending || !qty}
            onClick={() =>
              start(async () => {
                if (!action) return;
                const r = await stockMoveAction({ ingredientId: action.ing.id, kind: action.kind, qty: realQty, totalCost: action.kind === "compra" ? parseInt(total.replace(/\D/g, "") || "0", 10) : undefined });
                if (report(r)) {
                  setAction(null);
                  router.refresh();
                }
              })
            }
          >
            Guardar {qty ? fmtQty(realQty, action?.ing.unit ?? "") : ""}
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
              <input inputMode="decimal" data-autofocus className="mt-1 h-14 w-full rounded-xl border border-linea-2 px-3 text-xl tnum outline-none focus:border-tinto" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.,]/g, ""))} />
            </label>
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
    </div>
  );
}
