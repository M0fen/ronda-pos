import type { Metadata } from "next";
import { TeamEditor } from "@/components/panel/team-editor";
import { requireStaff } from "@/lib/server/auth";
import { listStaff } from "@/lib/server/panel";

export const metadata: Metadata = { title: "Equipo" };

export default async function TeamPage() {
  const staff = await requireStaff(["owner", "admin"]);
  return <TeamEditor people={await listStaff(staff.business_id)} me={staff.id} />;
}
