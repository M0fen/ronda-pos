import "server-only";
import { splitTax } from "../core/pricing";
import { can, type Staff } from "./auth";
import { audit, bump } from "./business";
import { getDb } from "./db";
import { UserError } from "./errors";

export interface IngredientView {
  id: string;
  name: string;
  unit: "g" | "ml" | "und";
  stock: number;
  min_stock: number;
  cost: number;
  pack_size: number | null;
  pack_label: string | null;
  kind: string;
  dailyUse: number;
  daysLeft: number | null;
  low: boolean;
  value: number;
}

export async function ingredientsView(bizId: string): Promise<IngredientView[]> {
  const db = await getDb();
  const rows = await db.query<{ id: string; name: string; unit: "g" | "ml" | "und"; stock: number; min_stock: number; cost: number; pack_size: number | null; pack_label: string | null; kind: string; used: number }>(
    `select i.id, i.name, i.unit, i.stock, i.min_stock, i.cost, i.pack_size, i.pack_label, i.kind,
            coalesce((select -sum(delta) from stock_movements m where m.ingredient_id = i.id and m.reason = 'venta' and m.created_at > now() - interval '7 days'), 0) as used
       from ingredients i where i.business_id = $1 order by i.kind, i.name`,
    [bizId],
  );
  return rows.map((r) => {
    const stock = Number(r.stock);
    const daily = Number(r.used) / 7;
    return {
      ...r,
      stock,
      min_stock: Number(r.min_stock),
      cost: Number(r.cost),
      pack_size: r.pack_size === null ? null : Number(r.pack_size),
      dailyUse: daily,
      daysLeft: daily > 0 ? Math.floor(stock / daily) : null,
      low: stock < Number(r.min_stock),
      value: Math.round(stock * Number(r.cost)),
    };
  });
}

/** "6.750 ml (9 botellas)" */
export function formatStock(i: Pick<IngredientView, "stock" | "unit" | "pack_size" | "pack_label">) {
  const n = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 }).format(i.stock);
  const base = `${n} ${i.unit}`;
  if (!i.pack_size || !i.pack_label) return base;
  const packs = i.stock / i.pack_size;
  const label = Math.abs(packs - 1) < 0.05 ? i.pack_label : `${i.pack_label}s`.replace(/ns$/, "nes").replace(/ls$/, "les");
  return `${base} · ${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 }).format(packs)} ${label}`;
}

export interface ProductCost {
  id: string;
  name: string;
  category: string;
  price: number;
  cost: number;
  margin: number;
  recipe: { name: string; qty: number; unit: string; cost: number }[];
}

export async function productCosts(bizId: string): Promise<ProductCost[]> {
  const db = await getDb();
  const rows = await db.query<{ product_id: string; product: string; category: string; price: number; tax_rate: number; ingredient: string | null; qty: number | null; unit: string | null; cost: number | null }>(
    `select p.id as product_id, p.name as product, c.name as category, p.price, p.tax_rate, i.name as ingredient, r.qty, i.unit, i.cost
       from products p join categories c on c.id = p.category_id
       left join recipe_items r on r.product_id = p.id
       left join ingredients i on i.id = r.ingredient_id
      where p.business_id = $1 and p.active order by c.sort, p.sort`,
    [bizId],
  );
  const map = new Map<string, ProductCost & { taxRate: number }>();
  for (const r of rows) {
    const p = map.get(r.product_id) ?? { id: r.product_id, name: r.product, category: r.category, price: r.price, cost: 0, margin: 0, recipe: [], taxRate: Number(r.tax_rate) };
    if (r.ingredient && r.qty !== null && r.cost !== null) {
      const c = Number(r.qty) * Number(r.cost);
      p.cost += c;
      p.recipe.push({ name: r.ingredient, qty: Number(r.qty), unit: r.unit ?? "", cost: Math.round(c) });
    }
    map.set(r.product_id, p);
  }
  return [...map.values()].map(({ taxRate, ...p }) => {
    const base = splitTax(p.price, taxRate).base;
    return { ...p, cost: Math.round(p.cost), margin: base ? Math.round(((base - p.cost) / base) * 100) : 0 };
  });
}

export async function stockMove(staff: Staff, input: { ingredientId: string; kind: "compra" | "merma" | "conteo"; qty: number; totalCost?: number; note?: string }) {
  if (input.kind !== "merma" && !can.panel(staff)) throw new UserError("Pide al encargado que registre compras y conteos");
  const qty = Number(input.qty);
  if (!Number.isFinite(qty) || qty < 0 || (input.kind !== "conteo" && qty === 0)) throw new UserError("Escribe una cantidad válida");
  const db = await getDb();
  await db.tx(async (tx) => {
    const ing = await tx.one<{ id: string; name: string; stock: number; cost: number }>("select id, name, stock, cost from ingredients where id = $1 and business_id = $2 for update", [
      input.ingredientId,
      staff.business_id,
    ]);
    if (!ing) throw new UserError("Insumo no encontrado");
    const stock = Number(ing.stock);
    let delta = 0;
    if (input.kind === "compra") {
      delta = qty;
      // Costo promedio ponderado
      if (input.totalCost && input.totalCost > 0) {
        const newCost = (Math.max(0, stock) * Number(ing.cost) + input.totalCost) / (Math.max(0, stock) + qty);
        await tx.query("update ingredients set cost = $2 where id = $1", [ing.id, newCost]);
      }
    } else if (input.kind === "merma") {
      delta = -qty;
    } else {
      delta = qty - stock;
    }
    await tx.query("update ingredients set stock = stock + $2 where id = $1", [ing.id, delta]);
    await tx.query("insert into stock_movements (business_id, ingredient_id, delta, reason, ref, staff_id) values ($1, $2, $3, $4, $5, $6)", [
      staff.business_id,
      ing.id,
      delta,
      input.kind,
      (input.note ?? "").slice(0, 80),
      staff.id,
    ]);
    if (input.kind !== "compra") await audit(tx, staff.business_id, staff.id, input.kind, { ingredient: ing.name, delta }, Math.round(Math.abs(delta) * Number(ing.cost)));
    await bump(tx, staff.business_id);
  });
}

export async function recentMovements(bizId: string, limit = 12) {
  const db = await getDb();
  return db.query<{ id: string; name: string; unit: string; delta: number; reason: string; ref: string; created_at: string; staff: string | null }>(
    `select m.id, i.name, i.unit, m.delta, m.reason, m.ref, m.created_at, s.name as staff from stock_movements m
       join ingredients i on i.id = m.ingredient_id left join staff s on s.id = m.staff_id
      where m.business_id = $1 and m.reason <> 'venta' order by m.created_at desc limit $2`,
    [bizId, limit],
  );
}
