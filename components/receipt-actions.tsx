"use client";

import { FilePenLine } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { changePaymentMethodAction, reissueInvoiceAction, voidSaleAction } from "@/app/(pos)/actions";
import { btn } from "@/components/ui";
import { cop } from "@/lib/money";
import { METHOD_LABEL } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { AuthSheet, type AuthLevel, type AuthRequest, type Authorizer } from "./auth-sheet";
import { Sheet } from "./sheet";
import { report } from "./toast";

type Result = { ok: boolean; error?: string; message?: string; fields?: Record<string, string> };
type Auth = { id: string; pin: string };

/** Correcciones de una cuenta cerrada: método de pago, refacturar con otros datos o anular la venta. Todo con autorización y registro. */
export function ReceiptActions({
  checkId,
  payments,
  methods,
  authorizers,
  meId,
  voided,
}: {
  checkId: string;
  payments: { id: string; method: string; amount: number; tip: number; reference: string }[];
  methods: string[];
  authorizers: Authorizer[];
  meId: string;
  voided: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sheet, setSheet] = useState<"menu" | "pago" | "factura" | "anular" | null>(null);
  const [payment, setPayment] = useState<string | null>(null);
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [kind, setKind] = useState<"consumidor" | "nit">("nit");
  const [doc, setDoc] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [auth, setAuth] = useState<(AuthRequest & { run: (a: Auth) => Promise<Result>; done: string }) | null>(null);

  function run(action: (a?: Auth) => Promise<Result>, label: string, done: string) {
    start(async () => {
      const r = await action();
      if (!r.ok && r.fields?.auth) return setAuth({ label, level: r.fields.auth as AuthLevel, run: (a) => action(a), done });
      if (report(r, done)) {
        setSheet(null);
        router.refresh();
      }
    });
  }

  if (voided) return null;
  const editable = payments.filter((p) => p.method !== "plataforma");
  return (
    <div className="no-print mx-auto mt-4 max-w-[340px]">
      <button className={btn("soft", "md", "w-full")} onClick={() => setSheet("menu")}>
        <FilePenLine size={18} /> Corregir esta venta
      </button>

      <Sheet open={sheet === "menu"} onClose={() => setSheet(null)} title="Corregir esta venta">
        <div className="grid gap-2">
          {editable.length ? (
            <button className={btn("soft", "lg", "justify-start")} onClick={() => (setPayment(editable[0]!.id), setMethod(""), setReference(""), setSheet("pago"))}>
              Cambiar el método de pago
            </button>
          ) : null}
          <button className={btn("soft", "lg", "justify-start")} onClick={() => (setKind("nit"), setSheet("factura"))}>
            Refacturar con NIT u otros datos
          </button>
          <button className={btn("soft", "lg", "justify-start text-cereza")} onClick={() => (setReason(""), setSheet("anular"))}>
            Anular la venta (devolución)
          </button>
          <p className="mt-1 text-sm text-humo">Lo autoriza el dueño o la administración. La factura anterior queda anulada con nota crédito y todo queda en el registro.</p>
        </div>
      </Sheet>

      <Sheet
        open={sheet === "pago"}
        onClose={() => setSheet(null)}
        title="Cambiar el método de pago"
        footer={
          <button
            className={btn("primary", "lg", "w-full")}
            disabled={pending || !payment || !method}
            onClick={() => run((a) => changePaymentMethodAction(payment!, { method, reference, auth: a }), "Cambiar el método de un pago ya cerrado", "Pago corregido")}
          >
            Guardar
          </button>
        }
      >
        <p className="text-sm font-semibold text-humo">Pago</p>
        <div className="mt-2 grid gap-2">
          {editable.map((p) => (
            <button key={p.id} onClick={() => setPayment(p.id)} className={cn("flex h-12 items-center justify-between rounded-xl px-3 ring-1", payment === p.id ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}>
              <span className="font-semibold">{METHOD_LABEL[p.method]}</span>
              <span className="tnum">{cop(p.amount + p.tip)}</span>
            </button>
          ))}
        </div>
        <p className="mt-4 text-sm font-semibold text-humo">Era con</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {methods
            .filter((m) => m !== payments.find((p) => p.id === payment)?.method)
            .map((m) => (
              <button key={m} onClick={() => setMethod(m)} className={cn("h-11 rounded-xl px-4 font-semibold ring-1", method === m ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}>
                {METHOD_LABEL[m]}
              </button>
            ))}
        </div>
        {method && method !== "efectivo" ? (
          <input className="mt-3 h-12 w-full rounded-xl border border-linea-2 px-3 outline-none focus:border-tinto" placeholder={method === "tarjeta" ? "Número de aprobación" : "Referencia del pago"} value={reference} onChange={(e) => setReference(e.target.value)} />
        ) : null}
        <p className="mt-3 text-sm text-humo">Solo mientras la caja de ese pago siga abierta: así el cierre cuadra.</p>
      </Sheet>

      <Sheet
        open={sheet === "factura"}
        onClose={() => setSheet(null)}
        title="Refacturar"
        footer={
          <button
            className={btn("primary", "lg", "w-full")}
            disabled={pending}
            onClick={() => run((a) => reissueInvoiceAction(checkId, { invoice: { kind, doc, name, email }, auth: a }), "Anular la factura con nota crédito y emitir una nueva", "Factura emitida de nuevo")}
          >
            Anular y emitir la nueva
          </button>
        }
      >
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setKind("consumidor")} className={cn("h-12 rounded-xl font-semibold ring-1", kind === "consumidor" ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}>
            Consumidor final
          </button>
          <button onClick={() => setKind("nit")} className={cn("h-12 rounded-xl font-semibold ring-1", kind === "nit" ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}>
            Con NIT o cédula
          </button>
        </div>
        {kind === "nit" ? (
          <div className="mt-3 grid gap-2">
            <input className="h-12 rounded-xl border border-linea-2 px-3 outline-none focus:border-tinto" placeholder="NIT o cédula" value={doc} onChange={(e) => setDoc(e.target.value)} />
            <input className="h-12 rounded-xl border border-linea-2 px-3 outline-none focus:border-tinto" placeholder="Nombre o razón social" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="h-12 rounded-xl border border-linea-2 px-3 outline-none focus:border-tinto" type="email" placeholder="Correo del cliente (opcional)" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        ) : null}
      </Sheet>

      <Sheet
        open={sheet === "anular"}
        onClose={() => setSheet(null)}
        title="Anular la venta"
        footer={
          <button
            className={btn("danger", "lg", "w-full")}
            disabled={pending || reason.trim().length < 3}
            onClick={() => run((a) => voidSaleAction(checkId, { reason, auth: a }), "Anular la venta y devolver los pagos", "Venta anulada")}
          >
            Anular la venta
          </button>
        }
      >
        <p className="text-[15px]">La factura queda anulada con nota crédito y los pagos se marcan como devueltos. Devuélvele el dinero al cliente.</p>
        <input className="mt-3 h-12 w-full rounded-xl border border-linea-2 px-3 outline-none focus:border-tinto" placeholder="Motivo (ej. cobro duplicado, el cliente devolvió el pedido)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Sheet>

      <AuthSheet
        request={auth}
        authorizers={authorizers}
        meId={meId}
        pending={pending}
        onClose={() => setAuth(null)}
        onAuth={(credentials) => {
          const a = auth!;
          start(async () => {
            if (report(await a.run(credentials), a.done)) {
              setAuth(null);
              setSheet(null);
              router.refresh();
            }
          });
        }}
      />
    </div>
  );
}
