/** Formatos de hora y fecha en Bogotá. Sirve en el servidor y en el navegador. */
const time = new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit", timeZone: "America/Bogota" });
const day = new Intl.DateTimeFormat("es-CO", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Bogota" });
const short = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", timeZone: "America/Bogota" });
const full = new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Bogota" });

/** Navegadores y Node traen versiones distintas de los datos de idioma ("p. m." con espacios raros):
 *  se normalizan para que el HTML del servidor y el del navegador coincidan. */
const tidy = (s: string) => s.replace(/[\s\u202f]+/g, "\u00a0");

export const fmtTime = (d: Date | string) => tidy(time.format(new Date(d)));
export const fmtDay = (d: Date | string) => {
  const s = day.format(new Date(d));
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export const fmtShort = (d: Date | string) => short.format(new Date(d));
export const fmtFull = (d: Date | string) => tidy(full.format(new Date(d))).replace(",\u00a0", ", ");
export const minutesAgo = (d: Date | string, now = Date.now()) => Math.max(0, Math.floor((now - new Date(d).getTime()) / 60_000));

export function fmtQty(n: number, unit: string) {
  return `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 }).format(n)} ${unit}`;
}
