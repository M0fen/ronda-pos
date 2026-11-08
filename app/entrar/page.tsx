import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EnrollDevice } from "@/components/enroll-device";
import { LogoutButton } from "@/components/logout-button";
import { PinLogin } from "@/components/pin-login";
import { SedePicker } from "@/components/sede-picker";
import { btn } from "@/components/ui";
import { getStaff } from "@/lib/server/auth";
import { getBusiness, getDefaultBusiness, getSedes } from "@/lib/server/business";
import { getDb, isDemoMode } from "@/lib/server/db";
import { currentDevice } from "@/lib/server/devices";
import { openShifts } from "@/lib/server/labor";
import { needsSetup } from "@/lib/server/setup";
import { DEMO_STAFF } from "@/lib/seed";
import { ROLE_LABEL } from "@/lib/settings";

export const metadata: Metadata = { title: "Entrar" };

export default async function EnterPage({ searchParams }: { searchParams: Promise<{ sesion?: string }> }) {
  const sp = await searchParams;
  // Base vacía (instalación nueva): primero el alta del local
  if (await needsSetup()) redirect("/alta");
  const demo = isDemoMode();
  const device = await currentDevice();
  // La tablet enrolada es de su sede; sin enrolar (solo en la demo) se elige la sede
  const biz = device && !device.all_sedes ? await getBusiness(device.business_id) : await getDefaultBusiness();
  const current = await getStaff();
  const allowed = demo || !!device;
  const brand = (
    <div className="flex items-center justify-between">
      <Link href="/" className="text-2xl font-extrabold tracking-tight [font-stretch:118%]">
        {biz.settings.theme.whiteLabel ? biz.name : "ronda"}
      </Link>
      {demo ? <span className="rounded-full bg-fachada-soft px-3 py-1 text-sm font-semibold text-[#7a5600]">Demo con datos de ejemplo</span> : null}
    </div>
  );
  if (!allowed)
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 py-6 sm:px-8 sm:py-10">
        {brand}
        <EnrollDevice />
      </main>
    );

  const db = await getDb();
  const staff = await db.query<{ id: string; name: string; role: string; color: string; pin_len: number }>(
    "select id, name, role, color, pin_len from staff where business_id = $1 and active order by case role when 'owner' then 0 when 'admin' then 1 when 'cashier' then 2 when 'waiter' then 3 else 4 end, name",
    [biz.id],
  );
  const [shifts, sedes] = await Promise.all([openShifts(biz.id), getSedes(biz.id)]);
  const onShift = new Map(shifts.map((s) => [s.staff_id, new Date(s.clock_in).toISOString()]));
  const pins = demo ? Object.fromEntries(DEMO_STAFF.map((s) => [s.name, s.pin])) : {};
  const currentSede = current && current.business_id !== biz.id ? await getBusiness(current.business_id) : null;
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 py-6 sm:px-8 sm:py-10">
      {brand}
      {sp.sesion && !current ? (
        <p className="mt-4 rounded-2xl bg-fachada-soft px-4 py-3 font-semibold text-[#6b4b00]">Tu sesión terminó. Vuelve a entrar con tu PIN; lo que estabas haciendo quedó guardado.</p>
      ) : null}
      {current ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-papel px-4 py-3 ring-1 ring-linea">
          <p className="flex-1 font-semibold">
            Estás como {current.name}
            {currentSede ? ` en la sede ${currentSede.sede || currentSede.name}` : biz.sede ? ` en la sede ${biz.sede}` : ""}.
          </p>
          <Link href={current.role === "bar" ? "/barra" : "/salon"} className={btn("primary", "sm")}>
            Seguir
          </Link>
          <LogoutButton className={btn("soft", "sm")} />
        </div>
      ) : null}
      <div className="mt-8 grid flex-1 gap-8 lg:grid-cols-[1fr_380px] lg:items-start">
        <div>
          <p className="text-humo">Turno de hoy en</p>
          <h1 className="mt-1 text-4xl font-extrabold leading-none tracking-tight [font-stretch:112%] sm:text-5xl">{biz.name}</h1>
          {biz.sede ? <p className="mt-2 text-2xl font-bold text-tinto-2">Sede {biz.sede}</p> : null}
          <p className="mt-3 text-lg text-tinto-2">Toca tu nombre y escribe tu PIN. Para empezar o terminar tu turno, usa Marcar turno.</p>
          {sedes.length > 1 && (demo || device?.all_sedes) ? <SedePicker sedes={sedes.map((s) => ({ id: s.id, sede: s.sede || s.name }))} current={biz.id} /> : null}
          {device ? <p className="mt-4 text-sm text-humo">Tablet enrolada: {device.name}</p> : null}
        </div>
        <PinLogin
          staff={staff.map((s) => ({ id: s.id, name: s.name, role: s.role, color: s.color, roleLabel: ROLE_LABEL[s.role] ?? s.role, hint: pins[s.name] ?? null, since: onShift.get(s.id) ?? null, pinLen: s.pin_len }))}
        />
      </div>
    </main>
  );
}
