import type { Metadata } from "next";
import { TeamEditor } from "@/components/panel/team-editor";
import { jornadaKey } from "@/lib/core/time";
import { requireStaff } from "@/lib/server/auth";
import { getBusiness } from "@/lib/server/business";
import { listDevices } from "@/lib/server/devices";
import { listStaff } from "@/lib/server/panel";

export const metadata: Metadata = { title: "Equipo" };

export default async function TeamPage() {
  const staff = await requireStaff(["owner", "admin"]);
  const [people, biz, devices] = await Promise.all([listStaff(staff.business_id), getBusiness(staff.business_id), listDevices(staff.business_id)]);
  return <TeamEditor people={people} me={staff.id} myRole={staff.role} labor={biz.settings.labor} today={jornadaKey()} devices={devices} chain={!!biz.chainId} />;
}
