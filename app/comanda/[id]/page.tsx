import { ArrowLeft, Printer } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoPrint, PrintButton } from "@/components/print-button";
import { btn, Empty } from "@/components/ui";
import { type Comanda, comandasFor, STATION_TITLE } from "@/lib/core/comanda";
import { fmtTime } from "@/lib/format";
import { requireStaff } from "@/lib/server/auth";
import { type KdsDetail, type KdsDetailItem, kdsDetail } from "@/lib/server/checks";

export const metadata: Metadata = { title: "Comanda" };

/**
 * Comanda de 80 mm para la impresora de cada estación: una tirilla por estación con lo de una ronda. Se abre desde la
 * cuenta (Comanda, en cada ronda) o desde la hoja de la cuenta en barra y cocina. Con ?auto=1 abre la impresión sola.
 */
export default async function ComandaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ronda?: string; estacion?: string; de?: string; auto?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const staff = await requireStaff();
  const detail = await kdsDetail(staff.business_id, id);
  if (!detail) notFound();
  const station = sp.estacion === "barra" || sp.estacion === "cocina" ? sp.estacion : null;
  const tickets = comandasFor(detail.rounds, { round: Number(sp.ronda) || null, station });
  const back = sp.de === "barra" ? `/barra${station ? `?estacion=${station}` : ""}` : `/cuenta/${id}`;
  const printedAt = new Date().toISOString();
  return (
    <main className="min-h-dvh bg-cal px-4 py-6 print:bg-white print:p-0">
      <div className="no-print mx-auto mb-4 flex max-w-[340px] gap-2">
        <Link href={back} className={btn("soft", "md")} aria-label="Volver">
          <ArrowLeft size={18} />
        </Link>
        <PrintButton className={btn("dark", "md", "flex-1")}>
          <Printer size={18} /> Imprimir {tickets.length > 1 ? `${tickets.length} comandas` : "comanda"}
        </PrintButton>
      </div>
      {tickets.length ? (
        <div className="space-y-4 print:space-y-0">
          {tickets.map((t) => (
            <ComandaTicket key={t.station} detail={detail} ticket={t} printedAt={printedAt} />
          ))}
        </div>
      ) : (
        <div className="mx-auto max-w-[340px]">
          <Empty title="No hay nada enviado">Cuando mandes una ronda, aquí sale su comanda.</Empty>
        </div>
      )}
      {sp.auto && tickets.length ? <AutoPrint /> : null}
    </main>
  );
}

function ComandaTicket({ detail: d, ticket: t, printedAt }: { detail: KdsDetail; ticket: Comanda<KdsDetailItem>; printedAt: string }) {
  const held = d.held.filter((i) => i.station === t.station);
  return (
    <article className="mx-auto w-full max-w-[340px] break-inside-avoid bg-white px-5 py-5 font-mono text-[13px] leading-snug text-black shadow-[0_8px_30px_rgba(36,21,15,0.12)] print:max-w-[72mm] print:break-after-page print:px-0 print:py-0 print:shadow-none print:last:break-after-auto">
      <header>
        <p className="flex items-center justify-between bg-black px-2 py-1 font-sans text-xl font-extrabold uppercase text-white">
          <span>{STATION_TITLE[t.station] ?? t.station}</span>
          <span>Ronda {t.round}</span>
        </p>
        <p className="mt-2 font-sans text-[26px] font-extrabold leading-tight [font-stretch:105%]">{d.label}</p>
        <p>
          #{d.number}
          {d.waiter ? ` · ${d.waiter}` : " · QR de la mesa"}
          {d.kind === "mesa" ? ` · ${d.guests} ${d.guests === 1 ? "persona" : "personas"}` : ""}
        </p>
        {t.sentAt ? <p>Enviada {fmtTime(t.sentAt)}</p> : null}
        {d.delivery?.riderAt ? <p className="mt-1 font-bold">Domiciliario a las {fmtTime(d.delivery.riderAt)}</p> : null}
        {d.delivery?.notes ? <p>Cliente: {d.delivery.notes}</p> : null}
      </header>
      <ul className="mt-3 border-y border-dashed border-black py-2">
        {t.lines.map((i, idx) => {
          const newSeat = i.seat && i.seat !== t.lines[idx - 1]?.seat;
          return (
            <li key={i.id} className="py-1">
              {newSeat ? <p className="mb-0.5 text-[12px] font-bold uppercase">Puesto {i.seat}</p> : null}
              <p className="flex gap-2 font-sans text-[17px] font-bold leading-tight">
                <span className="w-7 shrink-0 text-right tnum">{i.qty}</span>
                <span className="min-w-0 flex-1">{i.name}</span>
              </p>
              <div className="pl-9">
                {i.modifiers.map((m, k) => (
                  <p key={k}>+ {m.name}</p>
                ))}
                {i.allergy ? (
                  <p className="mt-0.5 bg-black px-1 font-bold text-white">ALERGIA: {i.note || "preguntar al mesero"}</p>
                ) : i.note ? (
                  <p className="font-bold">» {i.note}</p>
                ) : null}
              </div>
            </li>
          );
        })}
        {!t.lines.length ? <li className="py-1 font-bold">Nada por preparar en esta ronda.</li> : null}
      </ul>
      {t.voided.length ? (
        <div className="border-b border-dashed border-black py-2">
          <p className="font-bold uppercase">Anulado, no preparar:</p>
          {t.voided.map((i) => (
            <p key={i.id} className="line-through">
              {i.qty} {i.name}
            </p>
          ))}
        </div>
      ) : null}
      {held.length ? (
        <p className="border-b border-dashed border-black py-2">
          <b>Sale después:</b> {held.map((h) => `${h.qty} ${h.name}`).join(", ")}
        </p>
      ) : null}
      <p className="pt-2 text-[11px]">
        {t.units} {t.units === 1 ? "producto" : "productos"} · impresa {fmtTime(printedAt)}
      </p>
    </article>
  );
}
