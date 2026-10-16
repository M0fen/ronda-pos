import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { OrderScreen } from "@/components/order/order-screen";
import { can, requireStaff } from "@/lib/server/auth";
import { getBusiness } from "@/lib/server/business";
import { floorState, loadCheck } from "@/lib/server/checks";
import { loadMenu } from "@/lib/server/menu";

export const metadata: Metadata = { title: "Cuenta" };

export default async function CheckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const staff = await requireStaff();
  const [check, menu, biz, floor] = await Promise.all([loadCheck(staff.business_id, id), loadMenu(staff.business_id), getBusiness(staff.business_id), floorState(staff.business_id)]);
  if (!check) notFound();
  if (check.status === "paid" || check.status === "void") redirect(`/recibo/${check.id}`);
  return (
    <OrderScreen
      check={check}
      menu={menu}
      freeTables={floor.tables.filter((t) => !t.check).map((t) => ({ id: t.id, name: t.name, zone: floor.zones.find((z) => z.id === t.zone_id)?.name ?? "" }))}
      perms={{ voidSent: can.voidSent(staff), manage: can.manage(staff), charge: can.charge(staff) }}
      rules={{ discountLimitPct: biz.settings.alerts.discountLimitPct, loyaltyGoal: biz.settings.loyalty.goal, reward: biz.settings.loyalty.reward, loyalty: biz.settings.loyalty.enabled }}
    />
  );
}
