"use client";

import { Download, FileSpreadsheet } from "lucide-react";
import { useState, useTransition } from "react";
import { exportCsvAction } from "@/app/(pos)/panel/actions";
import { btn } from "@/components/ui";
import { addDays } from "@/lib/core/time";
import { cn } from "@/lib/utils";
import { report, toast } from "../toast";

const FILES = [
  { kind: "ventas", title: "Ventas", text: "Una fila por factura: número, cliente, base, impuesto, propina, total y medios de pago. Las anuladas salen con su nota crédito." },
  { kind: "impuestos", title: "Impuestos", text: "Base gravable e impuesto por jornada, sede y tarifa, calculados línea por línea como en la factura." },
  { kind: "propinas", title: "Propinas", text: "Por jornada, sede y persona que atendió. Van aparte: no son ingreso del local ni base de impuestos." },
  { kind: "caja", title: "Caja", text: "Cada apertura y cierre: base, efectivo, entradas, salidas, esperado, contado y diferencia, con las ventas por medio de pago." },
  { kind: "compras", title: "Compras y mermas", text: "Movimientos de insumos con cantidad, costo promedio y valor estimado." },
] as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Panel → Contador: archivos CSV por jornada y por sede, listos para Excel o para el programa contable. */
export function ExportView({ today, monthStart, chain, sede }: { today: string; monthStart: string; chain: boolean; sede: string }) {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const month = (offset: number) => {
    const d = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + offset);
    const first = d.toISOString().slice(0, 10);
    d.setUTCMonth(d.getUTCMonth() + 1);
    const last = addDays(d.toISOString().slice(0, 10), -1);
    return { from: first, to: last > today ? today : last };
  };
  const presets = [
    { label: "Hoy", from: today, to: today },
    { label: "Ayer", from: addDays(today, -1), to: addDays(today, -1) },
    { label: "Últimos 7 días", from: addDays(today, -6), to: today },
    { label: "Este mes", ...month(0) },
    { label: "Mes pasado", ...month(-1) },
  ];
  const valid = DAY.test(from) && DAY.test(to) && from <= to;

  function download(kind: string) {
    if (!valid) return toast("Revisa las fechas", { tone: "error" });
    setBusy(kind);
    start(async () => {
      const r = await exportCsvAction({ kind, from, to, allSedes: all });
      setBusy(null);
      if (!report(r) || !r.ok || !r.data) return;
      const blob = new Blob([r.data.content], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.data.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast(r.data.rows ? `${r.data.filename} · ${r.data.rows.toLocaleString("es-CO")} filas` : `${r.data.filename} · sin movimientos en esas fechas`);
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Para el contador</h1>
        <p className="text-humo">Ventas, impuestos, propinas, caja y compras por jornada{chain ? " y por sede" : ""}. Cada archivo se abre en Excel o se importa al programa contable.</p>
      </div>

      <section className="rounded-3xl bg-papel p-4 ring-1 ring-linea sm:p-5">
        <p className="font-bold">Jornadas</p>
        <p className="text-sm text-humo">Una jornada va de 5:00 a. m. a 5:00 a. m. del día siguiente: lo de la madrugada cuenta para el día anterior.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p.label}
              onClick={() => (setFrom(p.from), setTo(p.to))}
              className={cn("h-11 rounded-full px-4 text-[15px] font-semibold ring-1", from === p.from && to === p.to ? "bg-tinto text-cal ring-tinto" : "bg-papel ring-linea-2 hover:ring-tinto")}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:max-w-xl">
          <label className="grid gap-1 text-sm font-semibold text-humo">
            Desde
            <input type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} className="h-12 rounded-xl border border-linea-2 bg-cal px-3 text-base font-semibold text-tinto outline-none focus:border-tinto" />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-humo">
            Hasta
            <input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} className="h-12 rounded-xl border border-linea-2 bg-cal px-3 text-base font-semibold text-tinto outline-none focus:border-tinto" />
          </label>
        </div>
        {chain ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => setAll(false)} className={cn("h-11 rounded-full px-4 text-[15px] font-semibold ring-1", !all ? "bg-balcon text-white ring-balcon" : "bg-papel ring-linea-2")} aria-pressed={!all}>
              Solo {sede}
            </button>
            <button onClick={() => setAll(true)} className={cn("h-11 rounded-full px-4 text-[15px] font-semibold ring-1", all ? "bg-balcon text-white ring-balcon" : "bg-papel ring-linea-2")} aria-pressed={all}>
              Todas las sedes
            </button>
          </div>
        ) : null}
        {!valid ? <p className="mt-2 text-sm font-semibold text-cereza">La fecha inicial no puede ser mayor que la final.</p> : null}
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        {FILES.map((f) => (
          <article key={f.kind} className="flex flex-col rounded-3xl bg-papel p-4 ring-1 ring-linea sm:p-5">
            <p className="flex items-center gap-2 font-bold">
              <FileSpreadsheet size={18} /> {f.title}
            </p>
            <p className="mt-1 flex-1 text-[15px] text-tinto-2">{f.text}</p>
            <button className={btn("primary", "lg", "mt-3 w-full sm:w-auto")} disabled={pending || !valid} onClick={() => download(f.kind)}>
              <Download size={18} /> {busy === f.kind ? "Preparando…" : `Descargar ${f.title.toLowerCase()}`}
            </button>
          </article>
        ))}
      </section>

      <section className="rounded-3xl bg-papel p-4 ring-1 ring-linea sm:p-5">
        <p className="font-bold">Cómo lo lee el contador</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px] text-tinto-2">
          <li>Archivos CSV con punto y coma, en UTF-8: se abren con doble clic en Excel, sin asistentes ni tildes rotas.</li>
          <li>Los pesos van en enteros. Base gravable e impuesto salen separados y cuadran al peso con el total de cada factura.</li>
          <li>Las facturas anuladas quedan en el archivo con su nota crédito: nada desaparece.</li>
          <li>El valor de las compras es estimado con el costo promedio del insumo; el soporte exacto es la factura del proveedor.</li>
        </ul>
      </section>
    </div>
  );
}
