import { ArrowLeft, MessageCircle, Printer } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { Receipt } from "@/components/receipt";
import { ReceiptActions } from "@/components/receipt-actions";
import { btn } from "@/components/ui";
import { authorizersOf, can, requireStaff } from "@/lib/server/auth";
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
  if (!receipt) {
    // Sin factura: descartada (quizás desde otra tablet), cerrada en $0 o todavía abierta
    const check = await loadCheck(staff.business_id, id);
    if (!check) notFound();
    if (check.status === "open" || check.status === "bill") redirect(`/cuenta/${id}`);
    if (check.status === "merged" && check.merged_into) redirect(`/cuenta/${check.merged_into}`);
    const back = check.kind === "domicilio" ? "/domicilios" : "/salon";
    return (
      <main className="min-h-dvh bg-cal px-4 py-10">
        <div className="mx-auto max-w-[340px] rounded-3xl bg-papel p-6 text-center ring-1 ring-linea">
          <p className="text-xl font-bold">{check.status === "void" ? "Esta cuenta se descartó" : "Cuenta cerrada sin factura"}</p>
          <p className="mt-1 text-humo">{check.status === "void" ? "No tiene nada por cobrar." : "Todo fue cortesía: no hubo venta que facturar."}</p>
          <Link href={back} className={btn("primary", "lg", "mt-5 w-full")}>
            {back === "/domicilios" ? "Volver a domicilios" : "Volver al salón"}
          </Link>
        </div>
      </main>
    );
  }
  const text = `Hola, este es el recibo de ${receipt.business.name} por ${cop(receipt.check.totals.total + receipt.check.tips)}: ${receipt.url}`;
  const back = receipt.check.kind === "domicilio" ? "/domicilios" : "/salon";
  const methods = (["efectivo", "tarjeta", "nequi", "breb", "daviplata"] as const).filter((m) => receipt.business.settings.payments[m]);
  const authorizers = can.closeCash(staff) ? await authorizersOf(staff.business_id) : [];
  return (
    <main className="min-h-dvh bg-cal px-4 py-6">
      {sp.nuevo ? (
        <div className="no-print mx-auto mb-4 max-w-[340px] rounded-2xl bg-puerta px-4 py-3 text-center font-semibold text-white">Cuenta cerrada y {receipt.invoice.doc_type === "fe" ? "factura electrónica emitida" : "tiquete POS electrónico emitido"}</div>
      ) : null}
      <Actions back={back} whatsapp={receipt.invoice.voided_at ? undefined : `https://wa.me/?text=${encodeURIComponent(text)}`} />
      <Receipt business={receipt.business} check={receipt.check} invoice={receipt.invoice} qr={receipt.qr} mode="factura" codes={receipt.codes} />
      {can.closeCash(staff) && receipt.check.status === "paid" ? (
        <ReceiptActions
          checkId={receipt.check.id}
          payments={receipt.check.payments.map((p) => ({ id: p.id, method: p.method, amount: p.amount, tip: p.tip, reference: p.reference }))}
          methods={[...methods]}
          authorizers={authorizers}
          meId={staff.id}
          voided={!!receipt.invoice.voided_at}
        />
      ) : null}
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
