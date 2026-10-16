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
    ...(can.charge(staff) ? [{ href: "/caja", label: "Caja" }] : []),
    ...(can.panel(staff) ? [{ href: "/panel", label: "Panel" }] : []),
  ];
  return (
    <div className="flex min-h-dvh flex-col">
      <PosNav
        business={biz.name}
        links={links}
        staff={{ name: staff.name, color: staff.color, role: ROLE_LABEL[staff.role] ?? staff.role }}
        happy={isHappyHour(biz.settings.happyHour) ? biz.settings.happyHour.label : null}
      />
      <div className="flex-1">{children}</div>
    </div>
  );
}
