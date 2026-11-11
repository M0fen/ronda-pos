import type { Metadata } from "next";
import { MenuEditor } from "@/components/panel/menu-editor";
import { requireStaff } from "@/lib/server/auth";
import { optionGroups, recipesOf } from "@/lib/server/catalog";
import { getBusiness } from "@/lib/server/business";
import type { PriceChannel, SaleChannel } from "@/lib/core/channels";
import { ingredientsView, productCosts } from "@/lib/server/inventory";
import { loadMenu } from "@/lib/server/menu";

export const metadata: Metadata = { title: "Carta" };

export default async function MenuPage() {
  const staff = await requireStaff(["owner", "admin"]);
  const [menu, costs, ingredients, recipes, groups, biz] = await Promise.all([
    loadMenu(staff.business_id, { includeInactive: true }),
    productCosts(staff.business_id),
    ingredientsView(staff.business_id),
    recipesOf(staff.business_id),
    optionGroups(staff.business_id),
    getBusiness(staff.business_id),
  ]);
  // Solo los canales que el local usa: para llevar siempre; las plataformas, si están prendidas en Ajustes
  const ch = biz.settings.channels;
  const price: PriceChannel[] = ["llevar", ...(ch.rappi ? (["rappi"] as const) : []), ...(ch.didi ? (["didi"] as const) : []), ...(ch.propio ? (["propio"] as const) : [])];
  const visible: SaleChannel[] = ["local", ...price, ...(biz.settings.qr.enabled ? (["qr"] as const) : [])];
  return (
    <MenuEditor
      menu={menu}
      costs={Object.fromEntries(costs.map((c) => [c.id, { cost: c.cost, margin: c.margin }]))}
      ingredients={ingredients.map((i) => ({ id: i.id, name: i.name, unit: i.unit, cost: Number(i.cost) }))}
      recipes={recipes}
      groups={groups}
      channels={{ price, visible }}
    />
  );
}
