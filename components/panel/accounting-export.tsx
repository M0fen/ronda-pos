"use client";

import { Download } from "lucide-react";
import { useState, useTransition } from "react";
import { accountingExportAction } from "@/app/(pos)/panel/actions";
import { report, toast } from "@/components/toast";
import { btn } from "@/components/ui";

/** Baja el CSV del mes para el contador. En el iPad se abre con la opción de compartir o guardar en Archivos. */
export function AccountingExport({ months }: { months: { key: string; label: string }[] }) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const download = (month: string) =>
    start(async () => {
      setBusy(month);
      const r = await accountingExportAction(month);
      setBusy(null);
      if (!r.ok || !r.data) return void report(r);
      if (!r.data.count) return toast("Ese mes no tiene tiquetes, facturas ni notas");
      const url = URL.createObjectURL(new Blob([r.data.csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = r.data.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast(`Listo: ${r.data.count} ${r.data.count === 1 ? "documento" : "documentos"}`);
    });
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {months.map((m) => (
        <button key={m.key} className={btn("dark", "md")} disabled={pending} onClick={() => download(m.key)}>
          <Download size={18} /> {busy === m.key ? "Preparando…" : m.label}
        </button>
      ))}
    </div>
  );
}
