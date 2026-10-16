import type { Metadata } from "next";
import { InventoryView } from "@/components/panel/inventory-view";
import { requireStaff } from "@/lib/server/auth";
import { formatStock, ingredientsView, productCosts, recentMovements } from "@/lib/server/inventory";

export const metadata: Metadata = { title: "Inventario" };

export default async function InventoryPage() {
  const staff = await requireStaff(["owner", "admin", "cashier"]);
  const [ingredients, costs, moves] = await Promise.all([ingredientsView(staff.business_id), productCosts(staff.business_id), recentMovements(staff.business_id)]);
  return <InventoryView ingredients={ingredients.map((i) => ({ ...i, label: formatStock(i) }))} costs={costs.filter((c) => c.recipe.length)} moves={moves} />;
}
