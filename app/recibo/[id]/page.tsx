import { ArrowLeft, MessageCircle, Printer } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { Receipt } from "@/components/receipt";
import { btn } from "@/components/ui";
import { requireStaff } from "@/lib/server/auth";
import { getBusiness } from "@/lib/server/business";
import { loadCheck } from "@/lib/server/checks";
import { requestOrigin } from "@/lib/server/origin";
import { receiptForCheck } from "@/lib/server/receipts";
import { cop } from "@/lib/money";

export const metadata: Metadata = { title: "Recibo" };

export default async function ReceiptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ modo?: string; nuevo?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const staff = await requireStaff();
  const origin = await requestOrigin();
  if (sp.modo === "precuenta") {
    const [check, business] = await Promise.all([loadCheck(staff.business_id, id), getBusiness(staff.business_id)]);
    if (!check) notFound();
    return (
      <main className="min-h-dvh bg-cal px-4 py-6">
        <Actions back={`/cuenta/${id}`} />
        <Receipt business={business} check={check} invoice={null} qr={null} mode="precuenta" />
      </main>
    );
  }
  const receipt = await receiptForCheck(staff.business_id, id, origin);
  if (!receipt) redirect(`/cuenta/${id}`);
  const text = `Hola, este es el recibo de ${receipt.business.name} por ${cop(receipt.check.totals.total + receipt.check.tips)}: ${receipt.url}`;
  return (
    <main className="min-h-dvh bg-cal px-4 py-6">
      {sp.nuevo ? (
        <div className="no-print mx-auto mb-4 max-w-[340px] rounded-2xl bg-puerta px-4 py-3 text-center font-semibold text-white">Cuenta cerrada y factura emitida</div>
      ) : null}
      <Actions back="/salon" whatsapp={`https://wa.me/?text=${encodeURIComponent(text)}`} />
      <Receipt business={receipt.business} check={receipt.check} invoice={receipt.invoice} qr={receipt.qr} mode="factura" />
    </main>
  );
}

function Actions({ back, whatsapp }: { back: string; whatsapp?: string }) {
  return (
    <div className="no-print mx-auto mb-4 flex max-w-[340px] gap-2">
      <Link href={back} className={btn("soft", "md")} aria-label="Volver">
        <ArrowLeft size={18} />
      </Link>
      <PrintButton className={btn("dark", "md", "flex-1")}>
        <Printer size={18} /> Imprimir
      </PrintButton>
      {whatsapp ? (
        <a href={whatsapp} target="_blank" rel="noopener" className={btn("send", "md", "flex-1")}>
          <MessageCircle size={18} /> WhatsApp
        </a>
      ) : null}
    </div>
  );
}
