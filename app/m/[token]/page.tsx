import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QrMenu } from "@/components/qr-menu";
import { describeSchedule } from "@/lib/core/time";
import { loadMenu } from "@/lib/server/menu";
import { clientCheck, tableByToken } from "@/lib/server/qr";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const table = await tableByToken(token);
  return { title: table ? `Carta · ${table.business.name}` : "Carta", robots: { index: false } };
}

export default async function QrPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-z0-9]{3,40}$/i.test(token)) notFound();
  const table = await tableByToken(token);
  if (!table) notFound();
  const [menu, check] = await Promise.all([loadMenu(table.business_id), clientCheck(token)]);
  const s = table.business.settings;
  return (
    <QrMenu
      token={token}
      table={table.name}
      business={{ name: s.business.name, instagram: s.business.instagram }}
      theme={s.theme}
      menu={{ ...menu, products: menu.products.filter((p) => p.active) }}
      happyText={s.happyHour.enabled ? `${s.happyHour.label}: ${describeSchedule(s.happyHour)}` : null}
      config={{ qr: s.qr, tips: s.tips, brebKey: s.payments.brebKey, nequiPhone: s.payments.nequiPhone, breb: s.payments.breb, nequi: s.payments.nequi }}
      initialCheck={check}
    />
  );
}
