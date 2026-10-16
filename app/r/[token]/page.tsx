import { Download } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { Receipt } from "@/components/receipt";
import { btn } from "@/components/ui";
import { requestOrigin } from "@/lib/server/origin";
import { receiptByToken } from "@/lib/server/receipts";

export const metadata: Metadata = { title: "Tu recibo", robots: { index: false } };

export default async function PublicReceipt({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9]{8,32}$/.test(token)) notFound();
  const receipt = await receiptByToken(token, await requestOrigin());
  if (!receipt) notFound();
  return (
    <main className="min-h-dvh bg-cal px-4 py-6">
      <div className="no-print mx-auto mb-4 max-w-[340px]">
        <PrintButton className={btn("dark", "md", "w-full")}>
          <Download size={18} /> Guardar en PDF
        </PrintButton>
      </div>
      <Receipt business={receipt.business} check={receipt.check} invoice={receipt.invoice} qr={receipt.qr} mode="factura" />
    </main>
  );
}
