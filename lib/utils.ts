export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function slugify(value: string) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomKey(length = 20) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export function digits(value: string) {
  return value.replace(/\D/g, "");
}

/** Celulares colombianos se guardan con 10 dígitos (sin el 57). */
export function normalizePhone(value: string) {
  let d = digits(value);
  if (d.startsWith("57") && d.length === 12) d = d.slice(2);
  return d;
}

export function isValidPhone(value: string) {
  const d = normalizePhone(value);
  return d.length >= 7 && d.length <= 12;
}

export function formatPhone(value: string) {
  const d = normalizePhone(value);
  if (d.length === 10) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  return value;
}

export function maskPhone(value: string) {
  const d = normalizePhone(value);
  if (d.length === 10) return `${d.slice(0, 3)} ••• ${d.slice(6)}`;
  return value;
}

/** Enlace de WhatsApp. Sin número abre WhatsApp para elegir contacto. */
export function waLink(phone: string | null | undefined, text: string) {
  const d = digits(phone ?? "");
  const full = d.length === 10 ? `57${d}` : d;
  const base = full ? `https://wa.me/${full}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(text)}`;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function plural(n: number, one: string, many: string) {
  return `${n.toLocaleString("es-CO")} ${n === 1 ? one : many}`;
}

export function siteUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}
