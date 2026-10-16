import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PaymentScreen } from "@/components/payment-screen";
import { can, requireStaff } from "@/lib/server/auth";
import { getBusiness } from "@/lib/server/business";
import { loadCheck } from "@/lib/server/checks";
import { currentCashSession } from "@/lib/server/payments";

export const metadata: Metadata = { title: "Cobrar" };

export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const staff = await requireStaff();
  if (!can.charge(staff)) redirect(`/cuenta/${id}`);
  const [check, biz, cash] = await Promise.all([loadCheck(staff.business_id, id), getBusiness(staff.business_id), currentCashSession(staff.business_id)]);
  if (!check) notFound();
  if (check.status === "paid") redirect(`/recibo/${check.id}`);
  const s = biz.settings;
  return (
    <PaymentScreen
      check={check}
      cashOpen={!!cash}
      canRemove={can.voidSent(staff)}
      config={{
        tips: s.tips,
        methods: (["efectivo", "tarjeta", "nequi", "breb", "daviplata"] as const).filter((m) => s.payments[m]),
        brebKey: s.payments.brebKey,
        nequiPhone: s.payments.nequiPhone,
        loyalty: s.loyalty,
        taxLabel: s.tax.label,
      }}
    />
  );
}
