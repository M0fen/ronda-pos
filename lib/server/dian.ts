import "server-only";
import { after } from "next/server";
import {
  CONSUMIDOR_FINAL,
  type DianDocType,
  type DianDocument,
  type DianEnvironment,
  type DianLine,
  type DianResolution,
  readiness,
  SOFTWARE,
  uniqueCode,
} from "../core/dian";
import { lineGross, splitTax } from "../core/pricing";
import type { Settings } from "../settings";
import { type Business, getBusiness } from "./business";
import type { CheckView } from "./checks";
import { getDb, type Tx } from "./db";

/**
 * Facturación ante la DIAN: arma el documento de cada venta, lo guarda tal como se va a transmitir y lo manda al
 * proveedor tecnológico. Sin proveedor (o con la facturación en modo demo) todo queda "simulado" y así se imprime.
 *
 * Proveedor: un puente HTTP en DIAN_PROVIDER_URL (con DIAN_PROVIDER_TOKEN) que firma y valida ante la DIAN. Recibe
 * { kind: "document" | "note", document, note? } y responde { status: "validado" | "rechazado", code?, message? }.
 * Si no contesta, se reintenta (1, 5, 15, 60 y luego cada 180 minutos); la DIAN da 48 horas en contingencia.
 */

export interface DianNote {
  type: "ajuste" | "credito";
  number: number;
  reason: string;
  generatedAt: string;
}

export interface DianProvider {
  name: string;
  simulated: boolean;
  send(input: { kind: "document" | "note"; document: DianDocument; note?: DianNote }): Promise<{ status: "validado" | "rechazado"; code?: string; message?: string }>;
}

const SIMULATED: DianProvider = {
  name: "Simulado",
  simulated: true,
  async send() {
    return { status: "validado", message: "Simulado: no se envió a la DIAN" };
  },
};

function httpBridge(url: string, token: string, name: string): DianProvider {
  return {
    name,
    simulated: false,
    async send(input) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`El proveedor respondió ${res.status}`);
      const out = (await res.json()) as { status?: string; code?: string; message?: string };
      if (out.status !== "validado" && out.status !== "rechazado") throw new Error("Respuesta del proveedor sin estado");
      return { status: out.status, code: typeof out.code === "string" ? out.code : undefined, message: typeof out.message === "string" ? out.message.slice(0, 300) : undefined };
    },
  };
}

/** Con la facturación en pruebas o producción y un proveedor configurado, se transmite; si no, se simula. */
export function providerFor(settings: Settings): DianProvider {
  const url = process.env.DIAN_PROVIDER_URL;
  if (settings.invoice.mode === "demo" || !url) return SIMULATED;
  return httpBridge(url, process.env.DIAN_PROVIDER_TOKEN ?? "", settings.invoice.provider || "Proveedor");
}

/** Quien pide factura con NIT o cédula recibe factura electrónica si el local tiene esa resolución; si no, el tiquete POS con sus datos. */
export function docTypeFor(settings: Settings, identified: boolean): DianDocType {
  const inv = settings.invoice;
  return identified && inv.fePrefix && inv.feRangeTo > 0 ? "fe" : "pos";
}

export function resolutionFor(settings: Settings, type: DianDocType): DianResolution {
  const i = settings.invoice;
  return type === "fe"
    ? { number: i.feResolution, prefix: i.fePrefix, from: i.feRangeFrom, to: i.feRangeTo, validFrom: i.feValidFrom, validTo: i.feValidTo }
    : { number: i.resolution, prefix: i.prefix, from: i.rangeFrom, to: i.rangeTo, validFrom: i.validFrom, validTo: i.validTo };
}

function environmentOf(settings: Settings): DianEnvironment {
  return settings.invoice.mode;
}

export function issuerOf(settings: Settings) {
  const b = settings.business;
  return {
    nit: b.nit,
    legalName: b.legalName || b.name,
    tradeName: b.name,
    regime: settings.invoice.regime,
    responsibilities: settings.invoice.responsibilities,
    address: b.address,
    city: b.city,
    phone: b.phone,
  };
}

/** Las líneas del documento con el descuento ya repartido: suman exacto lo que pagó el cliente. */
export function documentLines(check: Pick<CheckView, "items" | "discount_pct">, codes: Map<string, string>): DianLine[] {
  const pct = Math.min(100, Math.max(0, check.discount_pct ?? 0));
  const out: DianLine[] = [];
  for (const i of check.items) {
    const gross = lineGross({ unitPrice: i.unit_price, qty: i.qty, modifiers: i.modifiers, taxRate: Number(i.tax_rate), status: i.status, courtesy: i.courtesy });
    if (!gross || i.status === "draft") continue;
    const net = gross - Math.round((gross * pct) / 100);
    const { base, tax } = splitTax(net, Number(i.tax_rate));
    const options = i.modifiers.map((m) => m.name).join(", ");
    out.push({
      code: (i.product_id && codes.get(i.product_id)) || "",
      description: options ? `${i.name} (${options})` : i.name,
      qty: i.qty,
      unitBase: Math.round((base / i.qty) * 100) / 100,
      taxRate: Number(i.tax_rate),
      tax,
      total: net,
    });
  }
  return out;
}

/**
 * Emite el documento de una venta dentro de la transacción del cobro: número de su resolución, contenido congelado
 * (lo que se transmite) y estado. La resolución ya se revisó antes (rango y vigencia).
 */
export async function issueDocumentTx(
  tx: Tx,
  input: {
    biz: Business;
    check: Pick<CheckView, "id" | "items" | "discount_pct" | "totals" | "tips" | "payments">;
    type: DianDocType;
    number: number;
    buyer: { identified: boolean; doc: string; name: string; email: string | null };
    publicToken: string;
    now: Date;
  },
) {
  const { biz, check, type, number, buyer, now } = input;
  const s = biz.settings;
  const productIds = [...new Set(check.items.map((i) => i.product_id).filter((x): x is string => !!x))];
  const codes = new Map<string, string>();
  if (productIds.length)
    for (const r of await tx.query<{ id: string; code: string | null }>("select id, code from products where id = any($1::uuid[])", [productIds])) if (r.code) codes.set(r.id, r.code);
  const resolution = resolutionFor(s, type);
  const document: DianDocument = {
    type,
    environment: environmentOf(s),
    prefix: resolution.prefix,
    number,
    generatedAt: now.toISOString(),
    resolution,
    issuer: issuerOf(s),
    buyer: buyer.identified ? buyer : { identified: false, doc: CONSUMIDOR_FINAL, name: "Consumidor final", email: buyer.email },
    lines: documentLines(check, codes),
    totals: { base: check.totals.base, tax: check.totals.tax, tip: check.tips, total: check.totals.total + check.tips },
    payments: check.payments.filter((p) => p.status === "ok").map((p) => ({ method: p.method, amount: p.amount + p.tip })),
    software: { ...SOFTWARE },
  };
  const provider = providerFor(s);
  const status = provider.simulated ? "simulado" : "pendiente";
  // Simulado: el código sale aquí con la receta de la DIAN. Con proveedor, es provisional hasta que valide.
  const code = uniqueCode(document, provider.simulated ? "ronda-demo" : "provisional");
  const row = await tx.one<{ id: string }>(
    `insert into invoices (business_id, check_id, prefix, cufe, public_token, kind, customer_doc, customer_name, customer_email, subtotal, tax, tip, total, number,
                           doc_type, dian_status, issued_at, payload, dian_next_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19) returning id`,
    [
      biz.id,
      check.id,
      resolution.prefix,
      code,
      input.publicToken,
      buyer.identified ? "nit" : "consumidor",
      document.buyer.doc,
      document.buyer.name,
      buyer.email,
      check.totals.base,
      check.totals.tax,
      check.tips,
      check.totals.total + check.tips,
      number,
      type,
      status,
      provider.simulated ? now : null,
      JSON.stringify(document),
      provider.simulated ? null : now,
    ],
  );
  return { id: row!.id, status, code };
}

/** La nota que anula un documento (de ajuste el tiquete POS, crédito la factura) sale con su propio código y estado. */
export async function noteForVoidTx(tx: Tx, invoiceId: string, settings: Settings, note: DianNote) {
  const inv = await tx.one<{ payload: DianDocument | null; doc_type: DianDocType; prefix: string; number: number; subtotal: number; tax: number; tip: number; total: number; customer_doc: string | null }>(
    "select payload, doc_type, prefix, number, subtotal, tax, tip, total, customer_doc from invoices where id = $1",
    [invoiceId],
  );
  if (!inv) return;
  const provider = providerFor(settings);
  const code = uniqueCode(
    {
      prefix: `${note.type === "ajuste" ? "NA" : "NC"}${inv.prefix}`,
      number: note.number,
      generatedAt: note.generatedAt,
      totals: { base: inv.subtotal, tax: inv.tax, tip: inv.tip, total: inv.total },
      issuer: inv.payload?.issuer ?? issuerOf(settings),
      buyer: { identified: false, doc: inv.customer_doc ?? CONSUMIDOR_FINAL, name: "", email: null },
      environment: environmentOf(settings),
    },
    provider.simulated ? "ronda-demo" : "provisional",
  );
  await tx.query("update invoices set note_code = $2, note_status = $3, note_next_at = $4 where id = $1", [invoiceId, code, provider.simulated ? "simulado" : "pendiente", provider.simulated ? null : new Date()]);
}

const BACKOFF_MIN = [1, 5, 15, 60, 180];
const backoff = (attempts: number) => new Date(Date.now() + BACKOFF_MIN[Math.min(attempts, BACKOFF_MIN.length - 1)]! * 60_000);

/**
 * Manda lo pendiente al proveedor: primero el documento, después su nota (una nota necesita el documento validado).
 * Cada fila se aparta antes de enviarla, para que dos pantallas a la vez no la manden dos veces.
 */
export async function sendPendingDocuments(bizId: string, opts: { limit?: number; provider?: DianProvider } = {}) {
  const biz = await getBusiness(bizId);
  const provider = opts.provider ?? providerFor(biz.settings);
  const done = { sent: 0, rejected: 0, failed: 0 };
  if (provider.simulated) return done;
  const db = await getDb();
  const due = await db.query<{ id: string }>(
    `select id from invoices where business_id = $1
        and ((dian_status = 'pendiente' and coalesce(dian_next_at, now()) <= now())
          or (note_status = 'pendiente' and dian_status = 'validado' and coalesce(note_next_at, now()) <= now()))
      order by created_at limit $2`,
    [bizId, Math.min(50, opts.limit ?? 10)],
  );
  for (const { id } of due) {
    const doc = await db.one<{ payload: DianDocument; doc_type: DianDocType; dian_attempts: number }>(
      `update invoices set dian_next_at = now() + interval '2 minutes'
        where id = $1 and dian_status = 'pendiente' and coalesce(dian_next_at, now()) <= now() returning payload, doc_type, dian_attempts`,
      [id],
    );
    if (doc) {
      try {
        const r = await provider.send({ kind: "document", document: doc.payload });
        if (r.status === "validado") {
          await db.query("update invoices set dian_status = 'validado', cufe = coalesce($2, cufe), issued_at = now(), dian_message = $3, dian_attempts = dian_attempts + 1, dian_next_at = null where id = $1", [id, r.code ?? null, r.message ?? null]);
          done.sent++;
        } else {
          await db.query("update invoices set dian_status = 'rechazado', dian_message = $2, dian_attempts = dian_attempts + 1, dian_next_at = null where id = $1", [id, r.message ?? "Rechazado sin motivo"]);
          done.rejected++;
        }
      } catch (e) {
        await db.query("update invoices set dian_message = $2, dian_attempts = dian_attempts + 1, dian_next_at = $3 where id = $1", [id, `Sin respuesta: ${(e as Error).message}`.slice(0, 300), backoff(doc.dian_attempts)]);
        done.failed++;
      }
    }
    const note = await db.one<{ payload: DianDocument; doc_type: DianDocType; credit_note: number; void_reason: string | null; voided_at: string; note_attempts: number }>(
      `update invoices set note_next_at = now() + interval '2 minutes'
        where id = $1 and note_status = 'pendiente' and dian_status = 'validado' and coalesce(note_next_at, now()) <= now()
        returning payload, doc_type, credit_note, void_reason, voided_at, note_attempts`,
      [id],
    );
    if (note) {
      try {
        const r = await provider.send({
          kind: "note",
          document: note.payload,
          note: { type: note.doc_type === "fe" ? "credito" : "ajuste", number: note.credit_note, reason: note.void_reason ?? "Anulación", generatedAt: new Date(note.voided_at).toISOString() },
        });
        await db.query("update invoices set note_status = $2, note_code = coalesce($3, note_code), note_message = $4, note_attempts = note_attempts + 1, note_next_at = null where id = $1", [
          id,
          r.status,
          r.code ?? null,
          r.message ?? null,
        ]);
        if (r.status === "validado") done.sent++;
        else done.rejected++;
      } catch (e) {
        await db.query("update invoices set note_message = $2, note_attempts = note_attempts + 1, note_next_at = $3 where id = $1", [id, `Sin respuesta: ${(e as Error).message}`.slice(0, 300), backoff(note.note_attempts)]);
        done.failed++;
      }
    }
  }
  return done;
}

/** Después de responder (cobro, anulación o al abrir el panel), manda lo pendiente sin hacer esperar a nadie. */
export function scheduleDian(bizId: string) {
  try {
    after(() => sendPendingDocuments(bizId).catch((e) => console.error("[dian]", e)));
  } catch {
    // Fuera de una petición (pruebas, scripts): no hay después
  }
}

export interface DianSummary {
  simulated: boolean;
  provider: string;
  environment: DianEnvironment;
  pending: number;
  rejected: number;
  oldestPending: string | null;
  /** Lo pendiente lleva más de 48 horas: ya no es contingencia */
  overdue: boolean;
  lastError: string | null;
}

export async function dianSummary(bizId: string): Promise<DianSummary> {
  const [biz, db] = await Promise.all([getBusiness(bizId), getDb()]);
  const provider = providerFor(biz.settings);
  const row = await db.one<{ pending: number; rejected: number; oldest: string | null; last_error: string | null }>(
    `select count(*) filter (where dian_status = 'pendiente' or note_status = 'pendiente')::int as pending,
            count(*) filter (where dian_status = 'rechazado' or note_status = 'rechazado')::int as rejected,
            min(created_at) filter (where dian_status = 'pendiente' or note_status = 'pendiente') as oldest,
            (array_agg(coalesce(dian_message, note_message) order by created_at desc) filter (where dian_status in ('pendiente','rechazado') or note_status in ('pendiente','rechazado')))[1] as last_error
       from invoices where business_id = $1`,
    [bizId],
  );
  const oldest = row?.oldest ? new Date(row.oldest).toISOString() : null;
  return {
    simulated: provider.simulated,
    provider: provider.name,
    environment: environmentOf(biz.settings),
    pending: row?.pending ?? 0,
    rejected: row?.rejected ?? 0,
    oldestPending: oldest,
    overdue: !!oldest && Date.now() - Date.parse(oldest) > 48 * 3_600_000,
    lastError: row?.last_error ?? null,
  };
}

/** Lo que falta para facturar de verdad: datos del local, resoluciones y códigos de producto. */
export async function dianReadiness(bizId: string) {
  const [biz, db] = await Promise.all([getBusiness(bizId), getDb()]);
  const noCode = await db.query<{ name: string }>("select name from products where business_id = $1 and active and (code is null or code = '') order by sort, name limit 5", [bizId]);
  const lines = noCode.map((p) => ({ code: "", description: p.name }));
  const issuer = issuerOf(biz.settings);
  const pos = readiness({ type: "pos", issuer, resolution: resolutionFor(biz.settings, "pos"), lines });
  const fe = biz.settings.invoice.fePrefix ? readiness({ type: "fe", issuer, resolution: resolutionFor(biz.settings, "fe") }).filter((x) => !pos.includes(x)) : [];
  return { problems: [...pos, ...fe], hasFe: !!biz.settings.invoice.fePrefix };
}
