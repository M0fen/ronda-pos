import type { Metadata } from "next";
import { SettingsForm } from "@/components/panel/settings-form";
import { requireStaff } from "@/lib/server/auth";
import { getBusiness } from "@/lib/server/business";
import { canResetDemo, getDb, isDemoMode, isEphemeralDb } from "@/lib/server/db";
import { dianReadiness, dianSummary } from "@/lib/server/dian";

export const metadata: Metadata = { title: "Ajustes" };

export default async function SettingsPage() {
  const staff = await requireStaff(["owner", "admin"]);
  const biz = await getBusiness(staff.business_id);
  const db = await getDb();
  const [counter, ready, summary] = await Promise.all([
    db.one<{ last: number }>("select last from counters where business_id = $1 and kind = 'invoice'", [staff.business_id]),
    dianReadiness(staff.business_id),
    dianSummary(staff.business_id),
  ]);
  return (
    <SettingsForm
      initial={biz.settings}
      demo={isDemoMode()}
      ephemeral={isEphemeralDb()}
      isOwner={staff.role === "owner"}
      canReset={staff.role === "owner" && canResetDemo()}
      lastInvoice={counter?.last ?? 0}
      dian={{ problems: ready.problems, simulated: summary.simulated, provider: summary.provider, pending: summary.pending, rejected: summary.rejected, providerUrl: !!process.env.DIAN_PROVIDER_URL }}
    />
  );
}
