import type { Metadata } from "next";
import Link from "next/link";
import { PinLogin } from "@/components/pin-login";
import { getDefaultBusiness } from "@/lib/server/business";
import { getDb, isDemoMode } from "@/lib/server/db";
import { DEMO_STAFF } from "@/lib/seed";
import { ROLE_LABEL } from "@/lib/settings";

export const metadata: Metadata = { title: "Entrar" };

export default async function EnterPage() {
  const biz = await getDefaultBusiness();
  const db = await getDb();
  const staff = await db.query<{ id: string; name: string; role: string; color: string }>(
    "select id, name, role, color from staff where business_id = $1 and active order by case role when 'owner' then 0 when 'admin' then 1 when 'cashier' then 2 when 'waiter' then 3 else 4 end, name",
    [biz.id],
  );
  const demo = isDemoMode();
  const pins = demo ? Object.fromEntries(DEMO_STAFF.map((s) => [s.name, s.pin])) : {};
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 py-6 sm:px-8 sm:py-10">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-2xl font-extrabold tracking-tight [font-stretch:118%]">
          ronda
        </Link>
        {demo ? <span className="rounded-full bg-fachada-soft px-3 py-1 text-sm font-semibold text-[#7a5600]">Demo con datos de ejemplo</span> : null}
      </div>
      <div className="mt-8 grid flex-1 gap-8 lg:grid-cols-[1fr_380px] lg:items-start">
        <div>
          <p className="text-humo">Turno de hoy en</p>
          <h1 className="mt-1 text-4xl font-extrabold leading-none tracking-tight [font-stretch:112%] sm:text-5xl">{biz.name}</h1>
          <p className="mt-3 text-lg text-tinto-2">Toca tu nombre y escribe tu PIN.</p>
        </div>
        <PinLogin staff={staff.map((s) => ({ ...s, roleLabel: ROLE_LABEL[s.role] ?? s.role, hint: pins[s.name] ?? null }))} />
      </div>
    </main>
  );
}
