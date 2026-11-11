import { CODE_LABEL, DOC_TITLE, NOTE_LABEL, SOFTWARE } from "@/lib/core/dian";
import { suggestedTip } from "@/lib/core/pricing";
import { fmtFull } from "@/lib/format";
import type { Business } from "@/lib/server/business";
import type { CheckView } from "@/lib/server/checks";
import type { InvoiceRow } from "@/lib/server/receipts";
import { cop } from "@/lib/money";
import { METHOD_LABEL } from "@/lib/settings";

/** Tiquete de 80 mm, igual en pantalla y en la impresora térmica. */
export function Receipt({
  business,
  check,
  invoice,
  qr,
  mode,
  codes = {},
}: {
  business: Business;
  check: CheckView;
  invoice: InvoiceRow | null;
  qr: string | null;
  mode: "factura" | "precuenta";
  codes?: Record<string, string>;
}) {
  const s = business.settings;
  const type = invoice?.doc_type ?? "pos";
  // La resolución con la que salió (la de hoy si es un documento viejo sin contenido guardado)
  const res = invoice?.payload?.resolution ?? { number: s.invoice.resolution, prefix: s.invoice.prefix, from: s.invoice.rangeFrom, to: s.invoice.rangeTo, validTo: s.invoice.validTo };
  const lines = check.items.filter((i) => i.status !== "void" && i.status !== "draft");
  const tip = suggestedTip(check.totals.total, s.tips.suggestedPct);
  return (
    <article className="ticket-edge mx-auto w-full max-w-[340px] bg-white px-5 pt-6 font-mono text-[12.5px] leading-snug text-black shadow-[0_8px_30px_rgba(36,21,15,0.12)] print:max-w-[72mm] print:px-0 print:shadow-none">
      <header className="text-center">
        <p className="font-sans text-lg font-extrabold leading-tight [font-stretch:110%]">{s.business.name}</p>
        <p>{s.business.legalName}</p>
        <p>NIT {s.business.nit}</p>
        <p>{s.business.address}</p>
        {mode === "factura" && s.invoice.responsibilities ? (
          <p className="text-[11px]">
            Régimen {s.invoice.regime === "simple" ? "simple de tributación" : "ordinario"} · {s.invoice.responsibilities}
          </p>
        ) : null}
      </header>
      <div className="my-3 border-t border-dashed border-black/50" />
      {mode === "precuenta" ? (
        <p className="text-center font-bold">PRE-CUENTA · NO ES FACTURA</p>
      ) : (
        <div className="text-center">
          <p className={type === "pos" ? "text-[11px] font-bold uppercase" : "font-bold"}>{DOC_TITLE[type].toUpperCase()}</p>
          <p className="font-bold">
            {invoice?.prefix}-{invoice?.number}
          </p>
          <p>{res.number}</p>
          {res.to ? (
            <p>
              Rango {res.prefix}-{res.from} a {res.prefix}-{res.to}
              {res.validTo ? ` · vigente hasta ${res.validTo}` : ""}
            </p>
          ) : null}
          {invoice?.voided_at ? (
            <p className="mt-2 border border-black px-2 py-1 font-bold">
              ANULADO CON {NOTE_LABEL[type].toUpperCase()} {invoice.credit_note ?? ""}
              {invoice.void_reason ? <span className="block font-normal">{invoice.void_reason}</span> : null}
            </p>
          ) : null}
        </div>
      )}
      <div className="my-3 border-t border-dashed border-black/50" />
      <div className="space-y-0.5">
        <p>
          {mode === "factura" ? "Generado" : "Fecha"}: {fmtFull(invoice?.created_at ?? new Date())}
        </p>
        {mode === "factura" ? <p>Expedido: {invoice?.issued_at ? fmtFull(invoice.issued_at) : "en validación"}</p> : null}
        <p>
          {check.label} · Cuenta #{check.number}
        </p>
        <p>Atendió: {check.waiter_name ?? "—"}</p>
        {mode === "factura" ? <p>Cliente: {invoice?.kind === "nit" ? `${invoice.customer_name} · ${invoice.customer_doc}` : "Consumidor final"}</p> : null}
      </div>
      <div className="my-3 border-t border-dashed border-black/50" />
      <table className="w-full">
        <tbody>
          {lines.map((i) => {
            const unit = i.unit_price + i.modifiers.reduce((a, m) => a + m.price, 0);
            return (
              <tr key={i.id} className="align-top">
                <td className="w-7 pr-1 tnum">{i.qty}</td>
                <td className="pr-2">
                  {mode === "factura" && i.product_id && codes[i.product_id] ? <span className="text-[11px]">{codes[i.product_id]} </span> : null}
                  {i.name}
                  {i.modifiers.length ? <span className="block text-[11px]">{i.modifiers.map((m) => m.name).join(", ")}</span> : null}
                  {i.courtesy ? <span className="block text-[11px]">Cortesía</span> : null}
                </td>
                <td className="text-right tnum">{i.courtesy ? cop(0) : cop(unit * i.qty)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="my-3 border-t border-dashed border-black/50" />
      <dl className="space-y-0.5">
        {check.totals.discount ? (
          <div className="flex justify-between">
            <dt>Descuento {check.discount_pct} %</dt>
            <dd className="tnum">-{cop(check.totals.discount)}</dd>
          </div>
        ) : null}
        {check.totals.taxes.map((t) => (
          <div key={t.rate}>
            <div className="flex justify-between">
              <dt>Base gravable</dt>
              <dd className="tnum">{cop(t.base)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>
                {s.tax.label} {t.rate}%
              </dt>
              <dd className="tnum">{cop(t.tax)}</dd>
            </div>
          </div>
        ))}
        <div className="flex justify-between text-[15px] font-bold">
          <dt>TOTAL</dt>
          <dd className="tnum">{cop(check.totals.total)}</dd>
        </div>
        {mode === "precuenta" && s.tips.enabled ? (
          <>
            <div className="flex justify-between">
              <dt>Propina voluntaria sugerida {s.tips.suggestedPct}%</dt>
              <dd className="tnum">{cop(tip)}</dd>
            </div>
            <div className="flex justify-between font-bold">
              <dt>Total con propina</dt>
              <dd className="tnum">{cop(check.totals.total + tip)}</dd>
            </div>
          </>
        ) : null}
        {mode === "factura" && check.tips ? (
          <>
            <div className="flex justify-between">
              <dt>Propina voluntaria</dt>
              <dd className="tnum">{cop(check.tips)}</dd>
            </div>
            <div className="flex justify-between font-bold">
              <dt>Total pagado</dt>
              <dd className="tnum">{cop(check.totals.total + check.tips)}</dd>
            </div>
          </>
        ) : null}
      </dl>
      {mode === "factura" ? (
        <>
          <div className="my-3 border-t border-dashed border-black/50" />
          <dl className="space-y-0.5">
            {check.payments.map((p) => (
              <div key={p.id} className="flex justify-between">
                <dt>
                  {METHOD_LABEL[p.method]}
                  {p.reference ? ` ${p.reference}` : ""}
                </dt>
                <dd className="tnum">{cop(p.amount + p.tip)}</dd>
              </div>
            ))}
            {check.payments
              .filter((p) => p.method === "efectivo" && p.received)
              .map((p) => (
                <div key={`c-${p.id}`} className="flex justify-between">
                  <dt>Cambio</dt>
                  <dd className="tnum">{cop((p.received ?? 0) - p.amount - p.tip)}</dd>
                </div>
              ))}
          </dl>
          <div className="my-3 border-t border-dashed border-black/50" />
          <p className="break-all text-[10.5px]">
            {CODE_LABEL[type]}: {invoice?.cufe}
          </p>
          {qr ? <div className="mx-auto mt-3 size-32 [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} /> : null}
          <p className="mt-2 text-center text-[11px]">{legend(invoice, s.invoice.provider)}</p>
          <p className="text-center text-[10.5px]">
            Software {SOFTWARE.name} · Fabricante {SOFTWARE.maker}
          </p>
        </>
      ) : null}
      <div className="my-3 border-t border-dashed border-black/50" />
      <p className="text-center">{s.receipt.footer}</p>
    </article>
  );
}

/** Lo que se dice del documento según su estado ante la DIAN: nunca "validado" si no lo está. */
function legend(invoice: InvoiceRow | null, provider: string) {
  switch (invoice?.dian_status) {
    case "validado":
      return `Documento validado por la DIAN · Proveedor tecnológico: ${provider}`;
    case "pendiente":
      return "En validación ante la DIAN: el local lo transmite en máximo 48 horas.";
    case "rechazado":
      return `La DIAN lo rechazó${invoice.dian_message ? `: ${invoice.dian_message}` : ""}. El local debe corregirlo.`;
    default:
      return "Documento de demostración: no tiene validez ante la DIAN.";
  }
}
