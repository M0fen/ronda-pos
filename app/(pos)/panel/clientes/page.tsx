import type { Metadata } from "next";
import { CustomersView } from "@/components/panel/customers-view";
import { requireStaff } from "@/lib/server/auth";
import { getBusiness } from "@/lib/server/business";
import { customersView } from "@/lib/server/panel";

export const metadata: Metadata = { title: "Clientes" };

export default async function CustomersPage() {
  const staff = await requireStaff(["owner", "admin", "cashier"]);
  const biz = await getBusiness(staff.business_id);
  const customers = await customersView(staff.business_id, biz.settings.loyalty.goal);
  return <CustomersView customers={customers} loyalty={biz.settings.loyalty} business={biz.name} />;
}
