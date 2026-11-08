import type { Metadata } from "next";
import { MenuEditor } from "@/components/panel/menu-editor";
import { requireStaff } from "@/lib/server/auth";
import { recipesOf } from "@/lib/server/catalog";
import { ingredientsView, productCosts } from "@/lib/server/inventory";
import { loadMenu } from "@/lib/server/menu";

export const metadata: Metadata = { title: "Carta" };

export default async function MenuPage() {
  const staff = await requireStaff(["owner", "admin"]);
  const [menu, costs, ingredients, recipes] = await Promise.all([
    loadMenu(staff.business_id, { includeInactive: true }),
    productCosts(staff.business_id),
    ingredientsView(staff.business_id),
    recipesOf(staff.business_id),
  ]);
  return (
    <MenuEditor
      menu={menu}
      costs={Object.fromEntries(costs.map((c) => [c.id, { cost: c.cost, margin: c.margin }]))}
      ingredients={ingredients.map((i) => ({ id: i.id, name: i.name, unit: i.unit, cost: Number(i.cost) }))}
      recipes={recipes}
    />
  );
}
