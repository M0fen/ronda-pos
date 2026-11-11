import { Info } from "lucide-react";
import { redirect } from "next/navigation";
import { PanelNav } from "@/components/panel-nav";
import { DianAlert } from "@/components/panel/dian-alert";
import { can, requireStaff } from "@/lib/server/auth";
import { getSedes } from "@/lib/server/business";
import { isEphemeralDb } from "@/lib/server/db";
import { dianSummary, scheduleDian } from "@/lib/server/dian";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  if (!can.panel(staff)) redirect("/salon");
  const manage = can.manage(staff);
  const [sedes, dian] = await Promise.all([getSedes(staff.business_id), dianSummary(staff.business_id)]);
  const chain = can.chain(staff) && sedes.length > 1;
  // Al abrir el panel se reintenta lo que no ha salido a la DIAN (después de responder)
  if (dian.pending && !dian.simulated) scheduleDian(staff.business_id);
  const links = [
    ...(chain ? [{ href: "/panel/cadena", label: "Cadena" }] : []),
    { href: "/panel", label: "Resumen" },
    ...(manage
      ? [
          { href: "/panel/rentabilidad", label: "Rentabilidad" },
          { href: "/panel/reportes", label: "Reportes" },
        ]
      : []),
    { href: "/panel/inventario", label: "Inventario" },
    { href: "/panel/clientes", label: "Clientes" },
    ...(manage
      ? [
          { href: "/panel/carta", label: "Carta" },
          { href: "/panel/mesas", label: "Mesas" },
          { href: "/panel/equipo", label: "Equipo" },
          { href: "/panel/qr", label: "QR de mesas" },
          { href: "/panel/ajustes", label: "Ajustes" },
        ]
      : []),
  ];
  return (
    <div className="mx-auto max-w-[1400px] px-3 py-4 sm:px-5">
      <PanelNav links={links} />
      {isEphemeralDb() ? (
        // La demo publicada no tiene base de datos propia: cada copia del servidor guarda lo suyo un rato
        <p className="mt-3 flex items-start gap-2 rounded-2xl bg-fachada-soft px-4 py-3 text-[15px] text-tinto">
          <Info size={18} className="mt-0.5 shrink-0" />
          <span>
            <b>Esto es la demo:</b> aquí puedes probar, pero lo que cambies no se guarda. En el sistema de tu local, con su propia base de datos, todo queda guardado.
          </span>
        </p>
      ) : null}
      {(dian.pending && !dian.simulated) || dian.rejected ? (
        <DianAlert
          pending={dian.simulated ? 0 : dian.pending}
          rejected={dian.rejected}
          hours={dian.oldestPending ? Math.max(1, Math.round((Date.now() - Date.parse(dian.oldestPending)) / 3_600_000)) : null}
          overdue={dian.overdue}
          lastError={dian.lastError}
        />
      ) : null}
      <div className="mt-4">{children}</div>
    </div>
  );
}
