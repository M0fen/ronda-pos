import "server-only";
import { effectivePrice, isHappyHour } from "../core/time";
import { getBusiness } from "./business";
import { getDb } from "./db";

export interface MenuOption {
  id: string;
  name: string;
  price: number;
  isDefault: boolean;
}

export interface MenuGroup {
  id: string;
  name: string;
  min: number;
  max: number;
  options: MenuOption[];
}

export interface MenuProduct {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  /** Precio que se cobra ahora mismo (con happy hour si aplica) */
  price: number;
  basePrice: number;
  happyPrice: number | null;
  onHappy: boolean;
  taxRate: number;
  station: string;
  image: string | null;
  soldOut: boolean;
  active: boolean;
  favorite: boolean;
  groups: string[];
}

export interface MenuCategory {
  id: string;
  name: string;
  color: string;
  station: string;
}

export interface Menu {
  categories: MenuCategory[];
  products: MenuProduct[];
  groups: Record<string, MenuGroup>;
  happy: boolean;
  happyLabel: string;
}

export async function loadMenu(bizId: string, opts: { includeInactive?: boolean } = {}): Promise<Menu> {
  const [db, biz] = await Promise.all([getDb(), getBusiness(bizId)]);
  const happy = isHappyHour(biz.settings.happyHour);
  const [categories, products, groups, options, links] = await Promise.all([
    db.query<MenuCategory>("select id, name, color, station from categories where business_id = $1 order by sort, name", [bizId]),
    db.query<{
      id: string;
      category_id: string;
      name: string;
      description: string;
      price: number;
      happy_price: number | null;
      tax_rate: number;
      station: string;
      image: string | null;
      sold_out: boolean;
      active: boolean;
      favorite: boolean;
    }>(
      `select id, category_id, name, description, price, happy_price, tax_rate, station, image, sold_out, active, favorite
         from products where business_id = $1 ${opts.includeInactive ? "" : "and active"} order by sort, name`,
      [bizId],
    ),
    db.query<{ id: string; name: string; min_select: number; max_select: number }>("select id, name, min_select, max_select from modifier_groups where business_id = $1 order by sort", [bizId]),
    db.query<{ id: string; group_id: string; name: string; price: number; is_default: boolean }>(
      "select id, group_id, name, price, is_default from modifiers where business_id = $1 order by sort",
      [bizId],
    ),
    db.query<{ product_id: string; group_id: string }>(
      "select pmg.product_id, pmg.group_id from product_modifier_groups pmg join products p on p.id = pmg.product_id where p.business_id = $1 order by pmg.sort",
      [bizId],
    ),
  ]);
  const groupMap: Record<string, MenuGroup> = {};
  for (const g of groups) groupMap[g.id] = { id: g.id, name: g.name, min: g.min_select, max: g.max_select, options: [] };
  for (const o of options) groupMap[o.group_id]?.options.push({ id: o.id, name: o.name, price: o.price, isDefault: o.is_default });
  const byProduct = new Map<string, string[]>();
  for (const l of links) byProduct.set(l.product_id, [...(byProduct.get(l.product_id) ?? []), l.group_id]);
  return {
    categories,
    groups: groupMap,
    happy,
    happyLabel: biz.settings.happyHour.label,
    products: products.map((p) => {
      const price = effectivePrice(p, happy);
      return {
        id: p.id,
        categoryId: p.category_id,
        name: p.name,
        description: p.description,
        price,
        basePrice: p.price,
        happyPrice: p.happy_price,
        onHappy: price < p.price,
        taxRate: Number(p.tax_rate),
        station: p.station,
        image: p.image,
        soldOut: p.sold_out,
        active: p.active,
        favorite: p.favorite,
        groups: byProduct.get(p.id) ?? [],
      };
    }),
  };
}

export interface ChosenItem {
  productId: string;
  qty: number;
  modifierIds?: string[];
  note?: string;
}

/** Valida modificadores contra la carta y arma la línea con precios del servidor (nunca del dispositivo). */
export function priceItem(menu: Menu, item: ChosenItem) {
  const product = menu.products.find((p) => p.id === item.productId);
  if (!product) throw new Error("Producto no encontrado");
  const chosen = new Set(item.modifierIds ?? []);
  const modifiers: { name: string; price: number }[] = [];
  for (const gid of product.groups) {
    const group = menu.groups[gid];
    if (!group) continue;
    const picked = group.options.filter((o) => chosen.has(o.id));
    const final = picked.length === 0 && group.min > 0 ? group.options.filter((o) => o.isDefault).slice(0, group.min) : picked.slice(0, group.max);
    for (const o of final) modifiers.push({ name: o.name, price: o.price });
  }
  return {
    product,
    qty: Math.min(99, Math.max(1, Math.floor(item.qty || 1))),
    modifiers,
    note: (item.note ?? "").trim().slice(0, 140),
  };
}
