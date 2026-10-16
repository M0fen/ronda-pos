"use client";

import { Plus, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createProductAction, updateProductAction } from "@/app/(pos)/panel/actions";
import { btn } from "@/components/ui";
import type { Menu, MenuProduct } from "@/lib/server/menu";
import { cop, parsePesos } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Sheet } from "../sheet";
import { report } from "../toast";

export function MenuEditor({ menu, costs }: { menu: Menu; costs: Record<string, { cost: number; margin: number }> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", categoryId: menu.categories[0]?.id ?? "", price: "" });
  const save = (id: string, patch: Parameters<typeof updateProductAction>[1]) =>
    start(async () => {
      if (report(await updateProductAction(id, patch))) router.refresh();
    });
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Carta</h1>
          <p className="text-humo">Los cambios se ven al instante en la caja y en la carta QR. El margen sale de la receta y el costo de los insumos.</p>
        </div>
        <button className={btn("primary", "md")} onClick={() => setAdding(true)}>
          <Plus size={18} /> Nuevo producto
        </button>
      </div>
      <div className="mt-4 space-y-5">
        {menu.categories.map((c) => (
          <section key={c.id}>
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <span className="size-3 rounded-full" style={{ background: c.color }} /> {c.name}
            </h2>
            <div className="mt-2 overflow-x-auto rounded-2xl bg-papel ring-1 ring-linea">
              <table className="w-full min-w-[760px] text-[15px]">
                <thead>
                  <tr className="border-b border-linea text-left text-[13px] text-humo">
                    <th className="px-4 py-2 font-semibold">Producto</th>
                    <th className="px-2 py-2 font-semibold">Precio</th>
                    <th className="px-2 py-2 font-semibold">Happy hour</th>
                    <th className="px-2 py-2 font-semibold">Costo y margen</th>
                    <th className="px-2 py-2 text-center font-semibold">Agotado</th>
                    <th className="px-2 py-2 text-center font-semibold">Visible</th>
                    <th className="px-2 py-2 text-center font-semibold">Favorito</th>
                  </tr>
                </thead>
                <tbody>
                  {menu.products
                    .filter((p) => p.categoryId === c.id)
                    .map((p) => (
                      <Row key={p.id} p={p} cost={costs[p.id]} save={save} disabled={pending} />
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
      <Sheet
        open={adding}
        onClose={() => setAdding(false)}
        title="Nuevo producto"
        footer={
          <button
            className={btn("primary", "lg", "w-full")}
            disabled={pending}
            onClick={() =>
              start(async () => {
                if (report(await createProductAction({ name: draft.name, categoryId: draft.categoryId, price: parsePesos(draft.price) }))) {
                  setAdding(false);
                  setDraft((d) => ({ ...d, name: "", price: "" }));
                  router.refresh();
                }
              })
            }
          >
            Crear producto
          </button>
        }
      >
        <label className="block">
          <span className="text-sm font-semibold text-humo">Nombre</span>
          <input className="mt-1 h-12 w-full rounded-xl border border-linea-2 px-3 outline-none focus:border-tinto" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label className="mt-3 block">
          <span className="text-sm font-semibold text-humo">Categoría</span>
          <select className="mt-1 h-12 w-full rounded-xl border border-linea-2 bg-papel px-3 outline-none focus:border-tinto" value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>
            {menu.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block">
          <span className="text-sm font-semibold text-humo">Precio con impuesto</span>
          <input inputMode="numeric" className="mt-1 h-12 w-full rounded-xl border border-linea-2 px-3 tnum outline-none focus:border-tinto" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} placeholder="$0" />
        </label>
      </Sheet>
    </div>
  );
}

function Row({ p, cost, save, disabled }: { p: MenuProduct; cost?: { cost: number; margin: number }; save: (id: string, patch: Parameters<typeof updateProductAction>[1]) => void; disabled: boolean }) {
  const [price, setPrice] = useState(String(p.basePrice));
  const [happy, setHappy] = useState(p.happyPrice ? String(p.happyPrice) : "");
  const [soldOut, setSoldOut] = useState(p.soldOut);
  const [active, setActive] = useState(p.active);
  return (
    <tr className={cn("border-b border-linea last:border-0", !active && "opacity-50")}>
      <td className="px-4 py-2 font-semibold">{p.name}</td>
      <td className="px-2 py-2">
        <input
          inputMode="numeric"
          className="h-10 w-28 rounded-lg border border-linea-2 px-2 text-right tnum outline-none focus:border-tinto"
          value={price}
          onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))}
          onBlur={() => parsePesos(price) !== p.basePrice && save(p.id, { price: parsePesos(price) })}
          aria-label={`Precio de ${p.name}`}
        />
      </td>
      <td className="px-2 py-2">
        <input
          inputMode="numeric"
          className="h-10 w-28 rounded-lg border border-linea-2 px-2 text-right tnum outline-none focus:border-tinto"
          value={happy}
          placeholder="—"
          onChange={(e) => setHappy(e.target.value.replace(/\D/g, ""))}
          onBlur={() => (parsePesos(happy) || null) !== p.happyPrice && save(p.id, { happyPrice: parsePesos(happy) || null })}
          aria-label={`Precio de happy hour de ${p.name}`}
        />
      </td>
      <td className="px-2 py-2 text-[14px]">
        {cost && cost.cost ? (
          <span>
            {cop(cost.cost)} · <span className={cn("font-semibold", cost.margin < 60 ? "text-cereza" : "text-puerta-2")}>{cost.margin} %</span>
          </span>
        ) : (
          <span className="text-humo">Sin receta</span>
        )}
      </td>
      <td className="px-2 py-2 text-center">
        <input type="checkbox" className="size-5 accent-[var(--color-cereza)]" checked={soldOut} onChange={(e) => (setSoldOut(e.target.checked), save(p.id, { soldOut: e.target.checked }))} aria-label={`${p.name} agotado`} />
      </td>
      <td className="px-2 py-2 text-center">
        <input type="checkbox" className="size-5 accent-[var(--color-balcon)]" checked={active} onChange={(e) => (setActive(e.target.checked), save(p.id, { active: e.target.checked }))} aria-label={`${p.name} visible`} />
      </td>
      <td className="px-2 py-2 text-center">
        <button onClick={() => save(p.id, { favorite: !p.favorite })} disabled={disabled} aria-pressed={p.favorite} aria-label={`${p.name} favorito`} className="inline-flex size-9 items-center justify-center rounded-lg hover:bg-tinto/6">
          <Star size={18} className={p.favorite ? "fill-fachada text-fachada" : "text-humo"} />
        </button>
      </td>
    </tr>
  );
}
