import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CashScreen } from "@/components/cash-screen";
import { authorizersOf, can, requireStaff } from "@/lib/server/auth";
import { cashSummary, currentCashSession, lastClosedSessions } from "@/lib/server/payments";

export const metadata: Metadata = { title: "Caja" };

export default async function CashPage() {
  const staff = await requireStaff();
  if (!can.charge(staff)) redirect("/salon");
  const [session, history, authorizers] = await Promise.all([currentCashSession(staff.business_id), lastClosedSessions(staff.business_id), authorizersOf(staff.business_id)]);
  const summary = session ? await cashSummary(staff.business_id, session.id) : null;
  return (
    <CashScreen
      summary={summary}
      history={history}
      canClose={can.closeCash(staff)}
      seeExpected={can.seeExpected(staff)}
      canFix={can.manage(staff)}
      authorizers={authorizers}
      meId={staff.id}
    />
  );
}
