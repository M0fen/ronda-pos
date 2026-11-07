import type { Metadata } from "next";
import { DeliveryBoard } from "@/components/delivery-board";
import { can, requireStaff } from "@/lib/server/auth";
import { getBusiness } from "@/lib/server/business";
import { deliveryBoard } from "@/lib/server/delivery";
import { CHANNEL_LABEL } from "@/lib/settings";

export const metadata: Metadata = { title: "Domicilios" };

export default async function DeliveryPage() {
  const staff = await requireStaff();
  const [cards, biz] = await Promise.all([deliveryBoard(staff.business_id), getBusiness(staff.business_id)]);
  const channels = (["rappi", "didi", "propio"] as const).filter((k) => biz.settings.channels[k]).map((k) => ({ key: k, label: CHANNEL_LABEL[k]! }));
  return <DeliveryBoard cards={cards} channels={channels} canCharge={can.charge(staff)} />;
}
