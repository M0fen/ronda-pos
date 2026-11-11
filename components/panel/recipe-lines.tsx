"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { btn } from "@/components/ui";
import { cop, parseQty } from "@/lib/money";

export type Ingredient = { id: string; name: string; unit: string; cost: number };
export type RecipeLine = { ingredientId: string; qty: string };

/** Lo que gasta una receta (o una opción) por unidad: insumo, cantidad y lo que cuesta. */
export function RecipeLines({ lines, setLines, ingredients, compact }: { lines: RecipeLine[]; setLines: (l: RecipeLine[]) => void; ingredients: Ingredient[]; compact?: boolean }) {
  const [pick, setPick] = useState("");
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  return (
    <div>
      <ul className="space-y-2">
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
              {compact ? null : <span className="w-20 text-right text-sm tnum text-humo">{cop(Math.round((parseQty(l.qty) || 0) * (ing?.cost ?? 0)))}</span>}
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
    </div>
  );
}

export function recipeCost(lines: RecipeLine[], ingredients: Ingredient[]) {
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  return lines.reduce((s, l) => s + (parseQty(l.qty) || 0) * (byId.get(l.ingredientId)?.cost ?? 0), 0);
}
