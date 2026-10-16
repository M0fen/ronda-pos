import { Printer } from "lucide-react";
import type { Metadata } from "next";
import { PrintButton } from "@/components/print-button";
import { btn } from "@/components/ui";
import { requireStaff } from "@/lib/server/auth";
import { getBusiness } from "@/lib/server/business";
import { requestOrigin } from "@/lib/server/origin";
import { tableQrs } from "@/lib/server/panel";

export const metadata: Metadata = { title: "QR de mesas" };

export default async function QrPage() {
  const staff = await requireStaff(["owner", "admin"]);
  const [qrs, biz] = await Promise.all([tableQrs(staff.business_id, await requestOrigin()), getBusiness(staff.business_id)]);
  return (
    <div>
      <div className="no-print mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">QR de las mesas</h1>
          <p className="text-humo">Cada mesa tiene su QR: el cliente ve la carta, pide, llama al mesero y paga su parte.</p>
        </div>
        <PrintButton className={btn("dark", "md")}>
          <Printer size={18} /> Imprimir todos
        </PrintButton>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3">
        {qrs.map((t) => (
          <a key={t.id} href={t.url} target="_blank" rel="noopener" className="break-inside-avoid rounded-3xl bg-papel p-4 text-center ring-1 ring-linea hover:ring-tinto">
            <p className="text-sm font-semibold text-humo">{biz.name}</p>
            <div className="mx-auto my-3 aspect-square w-full max-w-[180px] [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: t.svg }} />
            <p className="text-2xl font-bold">{t.zone === "Barra" ? t.name : `Mesa ${t.name}`}</p>
            <p className="text-[13px] text-humo">Escanea para ver la carta y pedir</p>
          </a>
        ))}
      </div>
    </div>
  );
}
