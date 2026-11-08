import type { Metadata } from "next";
import { Salon } from "@/components/salon";
import { requireStaff } from "@/lib/server/auth";
import { floorState } from "@/lib/server/checks";

export const metadata: Metadata = { title: "Salón" };

export default async function SalonPage({ searchParams }: { searchParams: Promise<{ cuenta?: string }> }) {
  const [staff, sp] = await Promise.all([requireStaff(), searchParams]);
  const floor = await floorState(staff.business_id);
  return (
    <>
      {sp.cuenta === "descartada" ? (
        <p className="mx-auto mt-3 max-w-[1400px] px-3 sm:px-5">
          <span className="block rounded-2xl bg-fachada-soft px-4 py-2.5 text-sm font-semibold text-[#6b4b00]">Esa cuenta ya no está: la descartaron, quizás desde otra tablet.</span>
        </p>
      ) : null}
      <Salon floor={floor} />
    </>
  );
}
