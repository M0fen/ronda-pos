import type { Metadata } from "next";
import { ExportView } from "@/components/panel/export-view";
import { jornadaKey } from "@/lib/core/time";
import { requireStaff } from "@/lib/server/auth";
import { getBusiness, getSedes } from "@/lib/server/business";

export const metadata: Metadata = { title: "Para el contador" };

export default async function ExportPage() {
  const staff = await requireStaff(["owner", "admin"]);
  const [biz, sedes] = await Promise.all([getBusiness(staff.business_id), getSedes(staff.business_id)]);
  const today = jornadaKey();
  return <ExportView today={today} monthStart={`${today.slice(0, 7)}-01`} chain={staff.role === "owner" && sedes.length > 1} sede={biz.sede || biz.name} />;
}
