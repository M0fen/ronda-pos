import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CashScreen } from "@/components/cash-screen";
import { cashView, closedCashView } from "@/lib/core/cash";
import { authorizersOf, can, requireStaff } from "@/lib/server/auth";
import { cashSummary, currentCashSession, lastClosedSessions } from "@/lib/server/payments";

export const metadata: Metadata = { title: "Caja" };

export default async function CashPage() {
  const staff = await requireStaff();
  if (!can.charge(staff)) redirect("/salon");
  const [session, history, authorizers] = await Promise.all([currentCashSession(staff.business_id), lastClosedSessions(staff.business_id), authorizersOf(staff.business_id)]);
  const summary = session ? await cashSummary(staff.business_id, session.id) : null;
  // Arqueo a ciegas: a quien no puede ver el esperado no le viaja al navegador (ni la base, ni el efectivo cobrado,
  // ni el esperado y la diferencia de los cierres anteriores). La pantalla pinta lo que le llega
  const see = can.seeExpected(staff);
  return (
    <CashScreen
      summary={summary ? cashView(summary, see) : null}
      history={closedCashView(history, see)}
      canClose={can.closeCash(staff)}
      canFix={can.manage(staff)}
      authorizers={authorizers}
      meId={staff.id}
    />
  );
}
