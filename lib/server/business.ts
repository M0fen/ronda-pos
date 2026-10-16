import "server-only";
import { cache } from "react";
import { mergeSettings, type Settings } from "../settings";
import { getDb, type Tx } from "./db";

export interface Business {
  id: string;
  name: string;
  slug: string;
  settings: Settings;
}

export const getBusiness = cache(async (bizId: string): Promise<Business> => {
  const db = await getDb();
  const row = await db.one<{ id: string; name: string; slug: string; settings: unknown }>("select id, name, slug, settings from businesses where id = $1", [bizId]);
  if (!row) throw new Error("Negocio no encontrado");
  const settings = mergeSettings(row.settings);
  return { id: row.id, name: settings.business.name, slug: row.slug, settings };
});

/** El negocio de la demo (o el único) para las páginas públicas sin sesión. */
export const getDefaultBusiness = cache(async (): Promise<Business> => {
  const db = await getDb();
  const row = await db.one<{ id: string }>("select id from businesses order by created_at limit 1");
  if (!row) throw new Error("No hay negocios");
  return getBusiness(row.id);
});

/** Marca que algo cambió: las pantallas que escuchan (salón, barra) se refrescan. */
export async function bump(tx: Pick<Tx, "query">, bizId: string) {
  await tx.query("update pulse set version = version + 1 where business_id = $1", [bizId]);
}

export async function readPulse(bizId: string) {
  const db = await getDb();
  const row = await db.one<{ version: number }>("select version from pulse where business_id = $1", [bizId]);
  return row?.version ?? 0;
}

export async function audit(tx: Pick<Tx, "query">, bizId: string, staffId: string | null, action: string, detail: Record<string, unknown>, amount = 0) {
  await tx.query("insert into audit_log (business_id, staff_id, action, detail, amount) values ($1, $2, $3, $4::jsonb, $5)", [bizId, staffId, action, JSON.stringify(detail), amount]);
}
