import { redirect } from "next/navigation";
import { PanelNav } from "@/components/panel-nav";
import { can, requireStaff } from "@/lib/server/auth";
import { getSedes } from "@/lib/server/business";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  if (!can.panel(staff)) redirect("/salon");
  const manage = can.manage(staff);
  const chain = can.chain(staff) && (await getSedes(staff.business_id)).length > 1;
  const links = [
    ...(chain ? [{ href: "/panel/cadena", label: "Cadena" }] : []),
    { href: "/panel", label: "Resumen" },
    ...(manage ? [{ href: "/panel/rentabilidad", label: "Rentabilidad" }] : []),
    { href: "/panel/inventario", label: "Inventario" },
    { href: "/panel/clientes", label: "Clientes" },
    ...(manage
      ? [
          { href: "/panel/carta", label: "Carta" },
          { href: "/panel/equipo", label: "Equipo" },
          { href: "/panel/qr", label: "QR de mesas" },
          { href: "/panel/ajustes", label: "Ajustes" },
        ]
      : []),
  ];
  return (
    <div className="mx-auto max-w-[1400px] px-3 py-4 sm:px-5">
      <PanelNav links={links} />
      <div className="mt-4">{children}</div>
    </div>
  );
}
