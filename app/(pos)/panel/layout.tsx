import { redirect } from "next/navigation";
import { PanelNav } from "@/components/panel-nav";
import { can, requireStaff } from "@/lib/server/auth";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  if (!can.panel(staff)) redirect("/salon");
  const manage = can.manage(staff);
  const links = [
    { href: "/panel", label: "Resumen" },
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
