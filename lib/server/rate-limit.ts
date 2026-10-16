import "server-only";
import { headers } from "next/headers";

const buckets = new Map<string, { count: number; until: number }>();

/** Límite simple por IP (en memoria). Devuelve false si se pasó del límite. */
export async function allow(action: string, max: number, windowMs: number) {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "local";
  const key = `${action}:${ip}`;
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.until < now) {
    buckets.set(key, { count: 1, until: now + windowMs });
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.until < now) buckets.delete(k);
    return true;
  }
  bucket.count += 1;
  return bucket.count <= max;
}
