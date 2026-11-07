import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from "../settings";
import { getDb, type Tx } from "./db";

export interface Business {
  id: string;
  name: string;
  slug: string;
  settings: Settings;
  /** Nombre de la sede dentro de la cadena ("" si el local es único) */
  sede: string;
  chainId: string | null;
}

export const getBusiness = cache(async (bizId: string): Promise<Business> => {
  const db = await getDb();
  const row = await db.one<{ id: string; name: string; slug: string; settings: unknown; sede: string; chain_id: string | null }>(
    "select id, name, slug, settings, sede, chain_id from businesses where id = $1",
    [bizId],
  );
  if (!row) throw new Error("Negocio no encontrado");
  const settings = mergeSettings(row.settings);
  return { id: row.id, name: settings.business.name, slug: row.slug, settings, sede: row.sede, chainId: row.chain_id };
});

/** Cookie con la sede de este dispositivo: la tablet de cada sede muestra a su equipo al entrar. */
export const SEDE_COOKIE = "ronda_sede";

/** El local de este dispositivo (la sede elegida en la pantalla de entrada) o el primero. */
export const getDefaultBusiness = cache(async (): Promise<Business> => {
  const db = await getDb();
  const wanted = (await cookies()).get(SEDE_COOKIE)?.value;
  const chosen = wanted && /^[0-9a-f-]{36}$/i.test(wanted) ? await db.one<{ id: string }>("select id from businesses where id = $1", [wanted]) : null;
  const row = chosen ?? (await db.one<{ id: string }>("select id from businesses order by created_at limit 1"));
  if (!row) throw new Error("No hay negocios");
  return getBusiness(row.id);
});

/** Sedes de la cadena del local (el mismo local si no tiene cadena), en el orden en que se crearon. */
export async function getSedes(bizId: string) {
  const db = await getDb();
  return db.query<{ id: string; sede: string; name: string }>(
    `select b.id, b.sede, b.name from businesses b
      where b.id = $1 or (b.chain_id is not null and b.chain_id = (select chain_id from businesses where id = $1))
      order by b.created_at, b.sede`,
    [bizId],
  );
}

/** Consecutivo propio de cada sede para cuentas y facturas: cada una con su numeración y su resolución. */
export async function nextNumber(tx: Pick<Tx, "one">, bizId: string, kind: "check" | "invoice") {
  const row = await tx.one<{ last: number }>(
    `insert into counters (business_id, kind, last) values ($1, $2, $3)
     on conflict (business_id, kind) do update set last = counters.last + 1 returning last`,
    [bizId, kind, kind === "check" ? 101 : 1001],
  );
  return Number(row!.last);
}

export interface Brand {
  name: string;
  whiteLabel: boolean;
  primary: string;
  accent: string;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Marca que se muestra en todo el sistema: la del local si la activó en Ajustes, o la de Ronda. Nunca falla. */
export const getBrand = cache(async (): Promise<Brand> => {
  const ronda = { name: "Ronda", whiteLabel: false, primary: DEFAULT_SETTINGS.theme.primary, accent: DEFAULT_SETTINGS.theme.accent };
  try {
    const biz = await getDefaultBusiness();
    const t = biz.settings.theme;
    if (!t.whiteLabel || !HEX.test(t.primary) || !HEX.test(t.accent)) return ronda;
    return { name: biz.name, whiteLabel: true, primary: t.primary, accent: t.accent };
  } catch {
    return ronda;
  }
});

/** Ícono con las iniciales del local, en sus colores. */
export function brandIcon(b: Brand) {
  const initials = b.name.replace(/[^\p{L}\p{N} ]/gu, "").split(" ").filter(Boolean).map((w) => w[0]!.toUpperCase()).slice(0, 2).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${b.primary}"/><text x="32" y="42" font-family="Arial,Helvetica,sans-serif" font-size="28" font-weight="900" text-anchor="middle" fill="${b.accent}">${initials}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

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
