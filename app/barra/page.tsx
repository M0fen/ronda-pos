import type { Metadata } from "next";
import { Kds } from "@/components/kds";
import { can, requireStaff } from "@/lib/server/auth";
import { getBusiness } from "@/lib/server/business";
import { kdsBoard } from "@/lib/server/checks";

export const metadata: Metadata = { title: "Barra y cocina" };

export default async function KdsPage({ searchParams }: { searchParams: Promise<{ estacion?: string }> }) {
  const { estacion } = await searchParams;
  const staff = await requireStaff();
  const station = estacion === "barra" || estacion === "cocina" ? estacion : null;
  const [board, biz] = await Promise.all([kdsBoard(staff.business_id, station), getBusiness(staff.business_id)]);
  return <Kds board={board} station={station} business={biz.name} staff={{ name: staff.name, canCharge: can.charge(staff) }} serverNow={Date.now()} />;
}
