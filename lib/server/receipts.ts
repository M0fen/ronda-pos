import "server-only";
import QRCode from "qrcode";
import { dianQrUrl, type DianDocType, type DianDocument, type DianStatus } from "../core/dian";
import { getBusiness } from "./business";
import { loadCheck } from "./checks";
import { getDb } from "./db";

export interface InvoiceRow {
  id: string;
  check_id: string;
  business_id: string;
  number: number;
  prefix: string;
  cufe: string;
  public_token: string;
  kind: string;
  customer_doc: string | null;
  customer_name: string | null;
  customer_email: string | null;
  subtotal: number;
  tax: number;
  tip: number;
  total: number;
  status: string;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
  credit_note: number | null;
  doc_type: DianDocType;
  dian_status: DianStatus;
  dian_message: string | null;
  issued_at: string | null;
  payload: DianDocument | null;
  note_code: string | null;
  note_status: DianStatus | null;
}

async function build(inv: InvoiceRow | null, origin: string) {
  if (!inv) return null;
  const db = await getDb();
  const [biz, check] = await Promise.all([getBusiness(inv.business_id), loadCheck(inv.business_id, inv.check_id)]);
  if (!check) return null;
  const url = `${origin}/r/${inv.public_token}`;
  // Validado: el QR lleva a la consulta de la DIAN. Mientras no, al recibo en línea del local
  const target = inv.dian_status === "validado" ? dianQrUrl(inv.cufe, inv.payload?.environment === "produccion" ? "produccion" : "pruebas") : url;
  const qr = await QRCode.toString(target, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#FFFFFF" } });
  const ids = [...new Set(check.items.map((i) => i.product_id).filter((x): x is string => !!x))];
  const codes: Record<string, string> = {};
  if (ids.length) for (const r of await db.query<{ id: string; code: string | null }>("select id, code from products where id = any($1::uuid[])", [ids])) if (r.code) codes[r.id] = r.code;
  return { invoice: inv, business: biz, check, url, qr, codes };
}

export async function receiptForCheck(bizId: string, checkId: string, origin: string) {
  const db = await getDb();
  const inv = await db.one<InvoiceRow>("select * from invoices where check_id = $1 and business_id = $2 order by (voided_at is null) desc, created_at desc limit 1", [checkId, bizId]);
  return build(inv, origin);
}

export async function receiptByToken(token: string, origin: string) {
  const db = await getDb();
  const inv = await db.one<InvoiceRow>("select * from invoices where public_token = $1", [token]);
  return build(inv, origin);
}

export type Receipt = NonNullable<Awaited<ReturnType<typeof build>>>;
