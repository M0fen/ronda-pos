import { PosNav } from "@/components/pos-nav";
import { can, requireStaff } from "@/lib/server/auth";
import { getBusiness } from "@/lib/server/business";
import { isHappyHour } from "@/lib/core/time";
import { ROLE_LABEL } from "@/lib/settings";

export default async function PosLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const biz = await getBusiness(staff.business_id);
  const links = [
    { href: "/salon", label: "Salón" },
    { href: "/barra", label: "Barra y cocina" },
    // Barra y cocina también lo ven: allí se empaca y se revisa la bolsa
    ...(biz.settings.channels.rappi || biz.settings.channels.didi || biz.settings.channels.propio ? [{ href: "/domicilios", label: "Domicilios" }] : []),
    ...(can.charge(staff) ? [{ href: "/caja", label: "Caja" }] : []),
    ...(can.panel(staff) ? [{ href: "/panel", label: "Panel" }] : []),
  ];
  return (
    <div className="flex min-h-dvh flex-col">
      <PosNav
        business={biz.name}
        whiteLabel={biz.settings.theme.whiteLabel}
        sede={biz.sede}
        links={links}
        staff={{ name: staff.name, color: staff.color, role: ROLE_LABEL[staff.role] ?? staff.role }}
        happy={isHappyHour(biz.settings.happyHour) ? biz.settings.happyHour.label : null}
      />
      <div className="flex-1">{children}</div>
    </div>
  );
}
