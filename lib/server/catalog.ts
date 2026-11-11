import "server-only";
import { randomBytes } from "node:crypto";
import { can, type Staff } from "./auth";
import { audit, bump } from "./business";
import { getDb, type Tx } from "./db";
import { cleanCode } from "../core/channels";
import { UserError } from "./errors";

/**
 * Editores para montar un local real: categorías, recetas, insumos, zonas y mesas.
 * Todo lo maneja el dueño o la administración y cada cambio refresca las pantallas.
 */

const HEX = /^#[0-9a-f]{6}$/i;
const STATIONS = new Set(["barra", "cocina"]);
const SHAPES = new Set(["square", "round", "long"]);
const UNITS = new Set(["g", "ml", "und"]);

function manager(staff: Staff) {
  if (!can.manage(staff)) throw new UserError("Solo el dueño o el administrador cambian esto");
}
const text = (v: unknown, max: number) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
const num = (v: unknown) => (typeof v === "number" ? v : Number(String(v ?? "").replace(",", ".")));

// ——— Categorías ———

export async function saveCategory(staff: Staff, input: { id?: string | null; name: string; color: string; station: string }) {
  manager(staff);
  const name = text(input.name, 30);
  if (name.length < 2) throw new UserError("Escribe el nombre de la categoría");
  const color = HEX.test(String(input.color)) ? String(input.color) : "#1E4FB8";
  const station = STATIONS.has(input.station) ? input.station : "barra";
  const id = input.id && isId(input.id) ? input.id : null;
  const db = await getDb();
  return db.tx(async (tx) => {
    const dup = await tx.one("select 1 from categories where business_id = $1 and lower(name) = lower($2) and id::text <> $3", [staff.business_id, name, id ?? ""]);
    if (dup) throw new UserError("Ya hay una categoría con ese nombre");
    let out = id;
    if (id) {
      const prev = await tx.one<{ station: string }>("select station from categories where id = $1 and business_id = $2 for update", [id, staff.business_id]);
      if (!prev) throw new UserError("Categoría no encontrada");
      await tx.query("update categories set name = $2, color = $3, station = $4 where id = $1", [id, name, color, station]);
      // Si cambia de pantalla (barra o cocina), sus productos se van con ella
      if (prev.station !== station) await tx.query("update products set station = $2 where category_id = $1", [id, station]);
    } else {
      const row = await tx.one<{ id: string }>(
        "insert into categories (business_id, name, color, station, sort) values ($1, $2, $3, $4, (select coalesce(max(sort), -1) + 1 from categories where business_id = $1)) returning id",
        [staff.business_id, name, color, station],
      );
      out = row!.id;
    }
    await bump(tx, staff.business_id);
    return out!;
  });
}

export async function moveCategory(staff: Staff, id: string, dir: number) {
  manager(staff);
  const db = await getDb();
  await db.tx(async (tx) => {
    const list = await tx.query<{ id: string }>("select id from categories where business_id = $1 order by sort, name for update", [staff.business_id]);
    const i = list.findIndex((c) => c.id === id);
    const j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    for (const [k, c] of list.entries()) await tx.query("update categories set sort = $2 where id = $1", [c.id, k]);
    await bump(tx, staff.business_id);
  });
}

export async function deleteCategory(staff: Staff, id: string) {
  manager(staff);
  if (!isId(id)) throw new UserError("Categoría no encontrada");
  const db = await getDb();
  await db.tx(async (tx) => {
    const n = await tx.one<{ n: number }>("select count(*)::int as n from products where category_id = $1 and business_id = $2", [id, staff.business_id]);
    if (n?.n) throw new UserError(`Tiene ${n.n} ${n.n === 1 ? "producto" : "productos"} (también cuentan los ocultos): pásalos a otra categoría primero`);
    const del = await tx.query("delete from categories where id = $1 and business_id = $2 returning id", [id, staff.business_id]);
    if (!del.length) throw new UserError("Categoría no encontrada");
    await bump(tx, staff.business_id);
  });
}

// ——— Recetas ———

export async function recipesOf(bizId: string) {
  const db = await getDb();
  const rows = await db.query<{ product_id: string; ingredient_id: string; qty: number }>("select product_id, ingredient_id, qty from recipe_items where business_id = $1", [bizId]);
  const out: Record<string, { ingredientId: string; qty: number }[]> = {};
  for (const r of rows) (out[r.product_id] ??= []).push({ ingredientId: r.ingredient_id, qty: Number(r.qty) });
  return out;
}

/** Reemplaza la receta completa del producto: con eso se descuenta el inventario y se calcula el margen. */
export async function setRecipe(staff: Staff, productId: string, items: { ingredientId: string; qty: number }[]) {
  manager(staff);
  if (!isId(productId)) throw new UserError("Producto no encontrado");
  const clean = new Map<string, number>();
  for (const it of Array.isArray(items) ? items.slice(0, 40) : []) {
    if (!isId(it?.ingredientId)) continue;
    const qty = Math.round(num(it.qty) * 100) / 100;
    if (!Number.isFinite(qty) || qty <= 0 || qty > 100_000) throw new UserError("Revisa las cantidades de la receta");
    clean.set(it.ingredientId, Math.round(((clean.get(it.ingredientId) ?? 0) + qty) * 100) / 100);
  }
  const db = await getDb();
  await db.tx(async (tx) => {
    const p = await tx.one<{ name: string }>("select name from products where id = $1 and business_id = $2", [productId, staff.business_id]);
    if (!p) throw new UserError("Producto no encontrado");
    for (const ingredientId of clean.keys()) {
      const ok = await tx.one("select 1 from ingredients where id = $1 and business_id = $2", [ingredientId, staff.business_id]);
      if (!ok) throw new UserError("Un insumo de la receta ya no existe");
    }
    await tx.query("delete from recipe_items where product_id = $1", [productId]);
    for (const [ingredientId, qty] of clean)
      await tx.query("insert into recipe_items (business_id, product_id, ingredient_id, qty) values ($1, $2, $3, $4)", [staff.business_id, productId, ingredientId, qty]);
    await audit(tx, staff.business_id, staff.id, "recipe", { product: p.name, items: clean.size });
    await bump(tx, staff.business_id);
  });
}

// ——— Opciones (grupos como "Salsa" o "Adiciones") ———

export interface OptionInput {
  id?: string | null;
  name: string;
  price: number;
  isDefault?: boolean;
  code?: string | null;
  soldOut?: boolean;
  /** Lo que gasta la opción (ej. "Tocineta" 30 g): se descuenta al enviar y suma al costo */
  recipe?: { ingredientId: string; qty: number }[];
}

export interface OptionGroupInput {
  id?: string | null;
  name: string;
  min: number;
  max: number;
  options: OptionInput[];
}

export interface OptionGroupView {
  id: string;
  name: string;
  min: number;
  max: number;
  products: number;
  options: { id: string; name: string; price: number; isDefault: boolean; code: string | null; soldOut: boolean; recipe: { ingredientId: string; qty: number }[] }[];
}

export async function optionGroups(bizId: string): Promise<OptionGroupView[]> {
  const db = await getDb();
  const [groups, options, recipes, uses] = await Promise.all([
    db.query<{ id: string; name: string; min_select: number; max_select: number }>("select id, name, min_select, max_select from modifier_groups where business_id = $1 order by sort, name", [bizId]),
    db.query<{ id: string; group_id: string; name: string; price: number; is_default: boolean; code: string | null; sold_out: boolean }>(
      "select id, group_id, name, price, is_default, code, sold_out from modifiers where business_id = $1 order by sort, name",
      [bizId],
    ),
    db.query<{ modifier_id: string; ingredient_id: string; qty: number }>("select modifier_id, ingredient_id, qty from modifier_recipe_items where business_id = $1", [bizId]),
    db.query<{ group_id: string; n: number }>(
      "select pmg.group_id, count(*)::int as n from product_modifier_groups pmg join products p on p.id = pmg.product_id where p.business_id = $1 group by pmg.group_id",
      [bizId],
    ),
  ]);
  const used = new Map(uses.map((u) => [u.group_id, u.n]));
  const byGroup = new Map<string, OptionGroupView["options"]>();
  for (const o of options)
    byGroup.set(o.group_id, [
      ...(byGroup.get(o.group_id) ?? []),
      {
        id: o.id,
        name: o.name,
        price: o.price,
        isDefault: o.is_default,
        code: o.code,
        soldOut: o.sold_out,
        recipe: recipes.filter((r) => r.modifier_id === o.id).map((r) => ({ ingredientId: r.ingredient_id, qty: Number(r.qty) })),
      },
    ]);
  return groups.map((g) => ({ id: g.id, name: g.name, min: g.min_select, max: g.max_select, products: used.get(g.id) ?? 0, options: byGroup.get(g.id) ?? [] }));
}

function cleanRecipe(items: unknown, label: string) {
  const out = new Map<string, number>();
  for (const it of Array.isArray(items) ? (items as { ingredientId?: unknown; qty?: unknown }[]).slice(0, 20) : []) {
    if (!isId(it?.ingredientId)) continue;
    const qty = Math.round(num(it.qty) * 100) / 100;
    if (!Number.isFinite(qty) || qty <= 0 || qty > 100_000) throw new UserError(`Revisa las cantidades de ${label}`);
    out.set(it.ingredientId, Math.round(((out.get(it.ingredientId) ?? 0) + qty) * 100) / 100);
  }
  return out;
}

/** Crea o reemplaza un grupo de opciones con todas sus opciones. Las opciones que ya no vienen se borran. */
export async function saveOptionGroup(staff: Staff, input: OptionGroupInput) {
  manager(staff);
  const name = text(input.name, 40);
  if (name.length < 2) throw new UserError("Escribe el nombre del grupo, ej. Salsa o Adiciones");
  const min = Math.floor(num(input.min));
  const max = Math.floor(num(input.max));
  if (!(min >= 0 && min <= 10)) throw new UserError("El mínimo va de 0 a 10");
  if (!(max >= 1 && max <= 10)) throw new UserError("El máximo va de 1 a 10");
  if (min > max) throw new UserError("El mínimo no puede pasar del máximo");
  const list = Array.isArray(input.options) ? input.options.slice(0, 30) : [];
  if (!list.length) throw new UserError("Agrega al menos una opción");
  const options = list.map((o, i) => {
    const oname = text(o?.name, 40);
    if (oname.length < 1) throw new UserError(`Escribe el nombre de la opción ${i + 1}`);
    const price = Math.round(num(o?.price ?? 0));
    if (!Number.isFinite(price) || price < 0 || price > 1_000_000) throw new UserError(`Revisa el precio de ${oname}`);
    const code = cleanCode(o?.code);
    if (code === "") throw new UserError(`El código de ${oname} solo lleva letras, números, punto o guion (hasta 30)`);
    return { id: o?.id && isId(o.id) ? o.id : null, name: oname, price, isDefault: !!o?.isDefault, code, soldOut: !!o?.soldOut, recipe: cleanRecipe(o?.recipe, oname) };
  });
  const names = new Set<string>();
  for (const o of options) {
    if (names.has(o.name.toLowerCase())) throw new UserError(`${o.name} está repetida en el grupo`);
    names.add(o.name.toLowerCase());
  }
  const codes = options.map((o) => o.code).filter((c): c is string => !!c);
  if (new Set(codes).size !== codes.length) throw new UserError("Dos opciones tienen el mismo código");
  if (options.filter((o) => o.isDefault).length > max) throw new UserError(`Marca como mucho ${max} ${max === 1 ? "opción" : "opciones"} por defecto`);
  const id = input.id && isId(input.id) ? input.id : null;
  const db = await getDb();
  return db.tx(async (tx) => {
    const dup = await tx.one("select 1 from modifier_groups where business_id = $1 and lower(name) = lower($2) and id::text <> $3", [staff.business_id, name, id ?? ""]);
    if (dup) throw new UserError("Ya hay un grupo con ese nombre");
    for (const ingredientId of new Set(options.flatMap((o) => [...o.recipe.keys()]))) {
      const ok = await tx.one("select 1 from ingredients where id = $1 and business_id = $2", [ingredientId, staff.business_id]);
      if (!ok) throw new UserError("Un insumo de las opciones ya no existe");
    }
    let groupId = id;
    if (id) {
      const prev = await tx.one("select 1 from modifier_groups where id = $1 and business_id = $2 for update", [id, staff.business_id]);
      if (!prev) throw new UserError("Grupo no encontrado");
      await tx.query("update modifier_groups set name = $2, min_select = $3, max_select = $4 where id = $1", [id, name, min, max]);
    } else {
      const row = await tx.one<{ id: string }>(
        "insert into modifier_groups (business_id, name, min_select, max_select, sort) values ($1, $2, $3, $4, (select coalesce(max(sort), -1) + 1 from modifier_groups where business_id = $1)) returning id",
        [staff.business_id, name, min, max],
      );
      groupId = row!.id;
    }
    const keep = options.map((o) => o.id).filter((x): x is string => !!x);
    // Primero se sueltan los códigos de las que se van, para que otra del grupo pueda tomarlos
    await tx.query("delete from modifiers where group_id = $1 and id::text <> all($2::text[])", [groupId, keep]);
    for (const code of codes) {
      const taken = await tx.one<{ name: string }>("select name from modifiers where business_id = $1 and lower(code) = lower($2) and id::text <> all($3::text[])", [
        staff.business_id,
        code,
        keep,
      ]);
      if (taken) throw new UserError(`El código ${code} ya lo tiene la opción ${taken.name}`);
    }
    for (const [i, o] of options.entries()) {
      let optionId = o.id;
      if (optionId) {
        const own = await tx.one("select 1 from modifiers where id = $1 and group_id = $2", [optionId, groupId]);
        if (!own) optionId = null;
      }
      if (optionId) {
        await tx.query("update modifiers set name = $2, price = $3, is_default = $4, code = $5, sold_out = $6, sort = $7 where id = $1", [optionId, o.name, o.price, o.isDefault, o.code, o.soldOut, i]);
      } else {
        const row = await tx.one<{ id: string }>(
          "insert into modifiers (business_id, group_id, name, price, is_default, code, sold_out, sort) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id",
          [staff.business_id, groupId, o.name, o.price, o.isDefault, o.code, o.soldOut, i],
        );
        optionId = row!.id;
      }
      await tx.query("delete from modifier_recipe_items where modifier_id = $1", [optionId]);
      for (const [ingredientId, qty] of o.recipe)
        await tx.query("insert into modifier_recipe_items (business_id, modifier_id, ingredient_id, qty) values ($1, $2, $3, $4)", [staff.business_id, optionId, ingredientId, qty]);
    }
    await audit(tx, staff.business_id, staff.id, "options", { group: name, options: options.length });
    await bump(tx, staff.business_id);
    return groupId!;
  });
}

export async function deleteOptionGroup(staff: Staff, id: string) {
  manager(staff);
  if (!isId(id)) throw new UserError("Grupo no encontrado");
  const db = await getDb();
  await db.tx(async (tx) => {
    const del = await tx.query<{ name: string }>("delete from modifier_groups where id = $1 and business_id = $2 returning name", [id, staff.business_id]);
    if (!del.length) throw new UserError("Grupo no encontrado");
    await audit(tx, staff.business_id, staff.id, "options_delete", { group: del[0]!.name });
    await bump(tx, staff.business_id);
  });
}

/** Qué grupos de opciones lleva un producto, en el orden en que se piden. */
export async function setProductOptionGroups(staff: Staff, productId: string, groupIds: string[]) {
  manager(staff);
  if (!isId(productId)) throw new UserError("Producto no encontrado");
  const ids = [...new Set((Array.isArray(groupIds) ? groupIds : []).filter(isId))].slice(0, 12);
  const db = await getDb();
  await db.tx(async (tx) => {
    const p = await tx.one("select 1 from products where id = $1 and business_id = $2 for update", [productId, staff.business_id]);
    if (!p) throw new UserError("Producto no encontrado");
    for (const gid of ids) {
      const ok = await tx.one("select 1 from modifier_groups where id = $1 and business_id = $2", [gid, staff.business_id]);
      if (!ok) throw new UserError("Un grupo de opciones ya no existe");
    }
    await tx.query("delete from product_modifier_groups where product_id = $1", [productId]);
    for (const [i, gid] of ids.entries()) await tx.query("insert into product_modifier_groups (product_id, group_id, sort) values ($1, $2, $3)", [productId, gid, i]);
    await bump(tx, staff.business_id);
  });
}

// ——— Insumos ———

export interface IngredientInput {
  id?: string | null;
  name: string;
  unit: string;
  /** Lo que cuesta comprar `perQty` de la unidad (ej. $48.000 por 2.500 g) */
  price: number;
  perQty: number;
  minStock: number;
  packSize: number | null;
  packLabel: string;
  /** Solo al crear: lo que hay hoy en bodega (queda como conteo inicial) */
  initialStock?: number;
}

export async function saveIngredient(staff: Staff, input: IngredientInput) {
  manager(staff);
  const name = text(input.name, 40);
  if (name.length < 2) throw new UserError("Escribe el nombre del insumo");
  if (!UNITS.has(input.unit)) throw new UserError("Elige en qué se mide: gramos, mililitros o unidades");
  const price = num(input.price);
  const perQty = num(input.perQty);
  if (!Number.isFinite(price) || price < 0 || price > 100_000_000) throw new UserError("Revisa el precio de compra");
  if (!Number.isFinite(perQty) || perQty <= 0 || perQty > 10_000_000) throw new UserError("Revisa la cantidad que trae ese precio");
  const cost = price / perQty;
  const minStock = num(input.minStock || 0);
  if (!Number.isFinite(minStock) || minStock < 0 || minStock > 10_000_000) throw new UserError("Revisa el mínimo");
  const packSize = input.packSize ? num(input.packSize) : null;
  if (packSize !== null && (!Number.isFinite(packSize) || packSize <= 0 || packSize > 10_000_000)) throw new UserError("Revisa el tamaño de la presentación");
  const packLabel = text(input.packLabel, 20) || null;
  if (packSize && !packLabel) throw new UserError("Ponle nombre a la presentación (ej. bolsa, botella, caja)");
  const id = input.id && isId(input.id) ? input.id : null;
  const initial = id ? 0 : num(input.initialStock || 0);
  if (!Number.isFinite(initial) || initial < 0 || initial > 10_000_000) throw new UserError("Revisa lo que hay en bodega");
  const db = await getDb();
  return db.tx(async (tx) => {
    const dup = await tx.one("select 1 from ingredients where business_id = $1 and lower(name) = lower($2) and id::text <> $3", [staff.business_id, name, id ?? ""]);
    if (dup) throw new UserError("Ya hay un insumo con ese nombre");
    if (id) {
      const prev = await tx.one<{ unit: string; name: string; cost: number }>("select unit, name, cost from ingredients where id = $1 and business_id = $2 for update", [id, staff.business_id]);
      if (!prev) throw new UserError("Insumo no encontrado");
      if (prev.unit !== input.unit) {
        // Cambiar la unidad dañaría las recetas y el historial: solo si nadie lo usa todavía
        const used = await tx.one(
          "select 1 from recipe_items where ingredient_id = $1 union all select 1 from modifier_recipe_items where ingredient_id = $1 union all select 1 from stock_movements where ingredient_id = $1 limit 1",
          [id],
        );
        if (used) throw new UserError("No se puede cambiar la unidad de un insumo que ya tiene recetas o movimientos");
      }
      await tx.query("update ingredients set name = $2, unit = $3, cost = $4, min_stock = $5, pack_size = $6, pack_label = $7 where id = $1", [id, name, input.unit, cost, minStock, packSize, packLabel]);
      if (Math.abs(Number(prev.cost) - cost) > 0.0001) await audit(tx, staff.business_id, staff.id, "ingredient_cost", { ingredient: name, from: Number(prev.cost), to: cost });
      await bump(tx, staff.business_id);
      return id;
    }
    const row = await tx.one<{ id: string }>(
      "insert into ingredients (business_id, name, unit, stock, min_stock, cost, pack_size, pack_label) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id",
      [staff.business_id, name, input.unit, initial, minStock, cost, packSize, packLabel],
    );
    if (initial > 0)
      await tx.query("insert into stock_movements (business_id, ingredient_id, delta, reason, ref, staff_id) values ($1, $2, $3, 'conteo', 'Inventario inicial', $4)", [
        staff.business_id,
        row!.id,
        initial,
        staff.id,
      ]);
    await bump(tx, staff.business_id);
    return row!.id;
  });
}

// ——— Zonas y mesas ———

export async function floorEditor(bizId: string) {
  const db = await getDb();
  const [zones, tables] = await Promise.all([
    db.query<{ id: string; name: string }>("select id, name from zones where business_id = $1 order by sort, name", [bizId]),
    db.query<{ id: string; zone_id: string; name: string; seats: number; x: number; y: number; shape: string; busy: boolean }>(
      `select t.id, t.zone_id, t.name, t.seats, t.x, t.y, t.shape,
              exists (select 1 from checks c where c.table_id = t.id and c.status in ('open','bill')) as busy
         from floor_tables t where t.business_id = $1 and t.active order by t.name`,
      [bizId],
    ),
  ]);
  return { zones, tables };
}

export async function saveZone(staff: Staff, input: { id?: string | null; name: string }) {
  manager(staff);
  const name = text(input.name, 24);
  if (name.length < 2) throw new UserError("Escribe el nombre de la zona");
  const id = input.id && isId(input.id) ? input.id : null;
  const db = await getDb();
  return db.tx(async (tx) => {
    const dup = await tx.one("select 1 from zones where business_id = $1 and lower(name) = lower($2) and id::text <> $3", [staff.business_id, name, id ?? ""]);
    if (dup) throw new UserError("Ya hay una zona con ese nombre");
    let out = id;
    if (id) {
      const r = await tx.query("update zones set name = $3 where id = $1 and business_id = $2 returning id", [id, staff.business_id, name]);
      if (!r.length) throw new UserError("Zona no encontrada");
    } else {
      const row = await tx.one<{ id: string }>("insert into zones (business_id, name, sort) values ($1, $2, (select coalesce(max(sort), -1) + 1 from zones where business_id = $1)) returning id", [
        staff.business_id,
        name,
      ]);
      out = row!.id;
    }
    await bump(tx, staff.business_id);
    return out!;
  });
}

export async function deleteZone(staff: Staff, id: string) {
  manager(staff);
  if (!isId(id)) throw new UserError("Zona no encontrada");
  const db = await getDb();
  await db.tx(async (tx) => {
    const n = await tx.one<{ zones: number; tables: number }>(
      "select (select count(*)::int from zones where business_id = $1) as zones, (select count(*)::int from floor_tables where zone_id = $2 and active) as tables",
      [staff.business_id, id],
    );
    if (n!.tables) throw new UserError("Quita o pasa a otra zona sus mesas primero");
    if (n!.zones <= 1) throw new UserError("Debe quedar al menos una zona");
    // Las mesas ya quitadas se van con la zona; sus cuentas viejas quedan en el historial
    const del = await tx.query("delete from zones where id = $1 and business_id = $2 returning id", [id, staff.business_id]);
    if (!del.length) throw new UserError("Zona no encontrada");
    await bump(tx, staff.business_id);
  });
}

/** Puestos del plano (en % del salón) donde caben las mesas nuevas sin taparse. */
const SLOTS = [
  [6, 10],
  [30, 10],
  [54, 10],
  [78, 10],
  [6, 56],
  [30, 56],
  [54, 56],
  [78, 56],
  [18, 33],
  [42, 33],
  [66, 33],
] as const;
export const PLAN_MAX = { x: 83, y: 66 };

function freeSlot(taken: { x: number; y: number }[]) {
  const slot = SLOTS.find(([x, y]) => taken.every((t) => Math.abs(t.x - x) >= 16 || Math.abs(t.y - y) >= 30));
  return slot ? { x: slot[0], y: slot[1] } : { x: 0, y: 0 };
}

async function newQrToken(tx: Pick<Tx, "one">, name: string) {
  const base = name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "").slice(0, 6);
  for (let i = 0; i < 5; i++) {
    const t = `m${base}${randomBytes(6).toString("base64url").replace(/[-_]/g, "").slice(0, 7).toLowerCase()}`;
    if (!(await tx.one("select 1 from floor_tables where qr_token = $1", [t]))) return t;
  }
  throw new UserError("No se pudo crear el QR de la mesa. Intenta de nuevo.");
}

export interface TableInput {
  id?: string | null;
  zoneId: string;
  name: string;
  seats: number;
  shape: string;
}

export async function saveTable(staff: Staff, input: TableInput) {
  manager(staff);
  const name = text(input.name, 12);
  if (!name) throw new UserError("Ponle nombre o número a la mesa");
  const seats = Math.round(num(input.seats));
  if (!Number.isFinite(seats) || seats < 1 || seats > 30) throw new UserError("Los puestos van de 1 a 30");
  const shape = SHAPES.has(input.shape) ? input.shape : "square";
  if (!isId(input.zoneId)) throw new UserError("Elige la zona");
  const id = input.id && isId(input.id) ? input.id : null;
  const db = await getDb();
  return db.tx(async (tx) => {
    const zone = await tx.one("select 1 from zones where id = $1 and business_id = $2", [input.zoneId, staff.business_id]);
    if (!zone) throw new UserError("Elige la zona");
    const dup = await tx.one("select 1 from floor_tables where business_id = $1 and active and lower(name) = lower($2) and id::text <> $3", [staff.business_id, name, id ?? ""]);
    if (dup) throw new UserError(`Ya hay una mesa ${name}`);
    if (id) {
      const prev = await tx.one<{ zone_id: string }>("select zone_id from floor_tables where id = $1 and business_id = $2 and active for update", [id, staff.business_id]);
      if (!prev) throw new UserError("Mesa no encontrada");
      let pos: { x: number; y: number } | null = null;
      if (prev.zone_id !== input.zoneId) {
        const taken = await tx.query<{ x: number; y: number }>("select x, y from floor_tables where zone_id = $1 and active", [input.zoneId]);
        pos = freeSlot(taken);
      }
      await tx.query(
        "update floor_tables set name = $2, seats = $3, shape = $4, zone_id = $5, x = coalesce($6, x), y = coalesce($7, y) where id = $1",
        [id, name, seats, shape, input.zoneId, pos?.x ?? null, pos?.y ?? null],
      );
      await bump(tx, staff.business_id);
      return id;
    }
    const taken = await tx.query<{ x: number; y: number }>("select x, y from floor_tables where zone_id = $1 and active", [input.zoneId]);
    const pos = freeSlot(taken);
    const row = await tx.one<{ id: string }>(
      "insert into floor_tables (business_id, zone_id, name, seats, x, y, shape, qr_token) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id",
      [staff.business_id, input.zoneId, name, seats, pos.x, pos.y, shape, await newQrToken(tx, name)],
    );
    await audit(tx, staff.business_id, staff.id, "table_added", { name });
    await bump(tx, staff.business_id);
    return row!.id;
  });
}

/** Mueve la mesa en el plano del salón (en % del ancho y del alto). */
export async function placeTable(staff: Staff, id: string, pos: { x: number; y: number }) {
  manager(staff);
  const x = Math.min(PLAN_MAX.x, Math.max(0, Math.round(num(pos.x))));
  const y = Math.min(PLAN_MAX.y, Math.max(0, Math.round(num(pos.y))));
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new UserError("Posición no válida");
  const db = await getDb();
  await db.tx(async (tx) => {
    const r = await tx.query("update floor_tables set x = $3, y = $4 where id = $1 and business_id = $2 and active returning id", [id, staff.business_id, x, y]);
    if (!r.length) throw new UserError("Mesa no encontrada");
    await bump(tx, staff.business_id);
  });
}

/** Quita la mesa del salón. Si ya tuvo cuentas se guarda apagada (su historial sigue); si no, se borra. */
export async function removeTable(staff: Staff, id: string) {
  manager(staff);
  if (!isId(id)) throw new UserError("Mesa no encontrada");
  const db = await getDb();
  await db.tx(async (tx) => {
    const t = await tx.one<{ name: string }>("select name from floor_tables where id = $1 and business_id = $2 and active for update", [id, staff.business_id]);
    if (!t) throw new UserError("Mesa no encontrada");
    const open = await tx.one("select 1 from checks where table_id = $1 and status in ('open','bill')", [id]);
    if (open) throw new UserError(`La mesa ${t.name} tiene una cuenta abierta: ciérrala primero`);
    const used = await tx.one("select 1 from checks where table_id = $1 limit 1", [id]);
    if (used) await tx.query("update floor_tables set active = false where id = $1", [id]);
    else await tx.query("delete from floor_tables where id = $1", [id]);
    await audit(tx, staff.business_id, staff.id, "table_removed", { name: t.name });
    await bump(tx, staff.business_id);
  });
}
