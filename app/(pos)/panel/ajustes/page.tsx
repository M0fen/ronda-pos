import type { Metadata } from "next";
import { SettingsForm } from "@/components/panel/settings-form";
import { requireStaff } from "@/lib/server/auth";
import { getBusiness } from "@/lib/server/business";
import { isDemoMode, isEphemeralDb } from "@/lib/server/db";

export const metadata: Metadata = { title: "Ajustes" };

export default async function SettingsPage() {
  const staff = await requireStaff(["owner", "admin"]);
  const biz = await getBusiness(staff.business_id);
  return <SettingsForm initial={biz.settings} demo={isDemoMode()} ephemeral={isEphemeralDb()} />;
}
