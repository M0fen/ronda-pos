import type { Metadata } from "next";
import { FloorEditor } from "@/components/panel/floor-editor";
import { requireStaff } from "@/lib/server/auth";
import { floorEditor } from "@/lib/server/catalog";

export const metadata: Metadata = { title: "Mesas y zonas" };

export default async function TablesPage() {
  const staff = await requireStaff(["owner", "admin"]);
  const { zones, tables } = await floorEditor(staff.business_id);
  return <FloorEditor zones={zones} tables={tables} />;
}
