import type { Metadata } from "next";
import { Salon } from "@/components/salon";
import { requireStaff } from "@/lib/server/auth";
import { floorState } from "@/lib/server/checks";

export const metadata: Metadata = { title: "Salón" };

export default async function SalonPage() {
  const staff = await requireStaff();
  const floor = await floorState(staff.business_id);
  return <Salon floor={floor} />;
}
