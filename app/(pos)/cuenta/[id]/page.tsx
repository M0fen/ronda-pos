import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { OrderScreen } from "@/components/order/order-screen";
import { authorizersOf, can, requireStaff } from "@/lib/server/auth";
import { getBusiness } from "@/lib/server/business";
import { floorState, loadCheck, staffOptions } from "@/lib/server/checks";
import { channelOfCheck, menuForChannel } from "@/lib/core/channels";
import { loadMenu } from "@/lib/server/menu";

export const metadata: Metadata = { title: "Cuenta" };

export default async function CheckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const staff = await requireStaff();
  const [check, menu, biz, floor, authorizers, team] = await Promise.all([
    loadCheck(staff.business_id, id),
    loadMenu(staff.business_id),
    getBusiness(staff.business_id),
    floorState(staff.business_id),
    authorizersOf(staff.business_id),
    staffOptions(staff.business_id),
  ]);
  if (!check) notFound();
  // Una cuenta descartada (quizás desde otra tablet) vuelve al salón; una cerrada, a su recibo; una unida, a la cuenta donde quedó
  if (check.status === "void") redirect("/salon?cuenta=descartada");
  if (check.status === "paid") redirect(`/recibo/${check.id}`);
  if (check.status === "merged") redirect(check.merged_into ? `/cuenta/${check.merged_into}` : "/salon");
  const family = check.split_of ?? check.id;
  const summary = (c: (typeof floor.checks)[number]) => ({ id: c.id, label: c.label, total: c.total, waiter: c.waiter_name });
  // Primero las mesas, en su orden (2 antes que 10); después barra y para llevar
  const ordered = [...floor.checks].sort((a, b) => Number(a.kind !== "mesa") - Number(b.kind !== "mesa") || a.label.localeCompare(b.label, "es", { numeric: true }));
  return (
    <OrderScreen
      check={check}
      // La carta del canal de la cuenta: en un domicilio de Rappi, lo de Rappi y a su precio
      menu={menuForChannel(menu, channelOfCheck(check))}
      freeTables={floor.tables.filter((t) => !t.check).map((t) => ({ id: t.id, name: t.name, zone: floor.zones.find((z) => z.id === t.zone_id)?.name ?? "" }))}
      perms={{ voidSent: can.voidSent(staff), manage: can.manage(staff), charge: can.charge(staff) }}
      rules={{ discountLimitPct: biz.settings.alerts.discountLimitPct, loyaltyGoal: biz.settings.loyalty.goal, reward: biz.settings.loyalty.reward, loyalty: biz.settings.loyalty.enabled }}
      authorizers={authorizers}
      meId={staff.id}
      siblings={ordered.filter((c) => c.id !== check.id && (c.id === family || c.split_of === family)).map(summary)}
      others={check.kind === "domicilio" ? [] : ordered.filter((c) => c.id !== check.id && c.kind !== "domicilio").map(summary)}
      team={team}
      lists={biz.settings.reasons}
    />
  );
}
