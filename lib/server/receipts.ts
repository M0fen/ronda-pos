import "server-only";
import QRCode from "qrcode";
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
}

async function build(inv: InvoiceRow | null, origin: string) {
  if (!inv) return null;
  const [biz, check] = await Promise.all([getBusiness(inv.business_id), loadCheck(inv.business_id, inv.check_id)]);
  if (!check) return null;
  const url = `${origin}/r/${inv.public_token}`;
  const qr = await QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#FFFFFF" } });
  return { invoice: inv, business: biz, check, url, qr };
}

export async function receiptForCheck(bizId: string, checkId: string, origin: string) {
  const db = await getDb();
  const inv = await db.one<InvoiceRow>("select * from invoices where check_id = $1 and business_id = $2 order by created_at desc limit 1", [checkId, bizId]);
  return build(inv, origin);
}

export async function receiptByToken(token: string, origin: string) {
  const db = await getDb();
  const inv = await db.one<InvoiceRow>("select * from invoices where public_token = $1", [token]);
  return build(inv, origin);
}

export type Receipt = NonNullable<Awaited<ReturnType<typeof build>>>;
