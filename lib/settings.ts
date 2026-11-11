import { sortTurnos, type Turno } from "./core/labor";
import { toMinutes, type HappyHour } from "./core/time";

/** Todo lo que cambia entre un local y otro vive aquí, como datos (no como código). */
export interface Settings {
  business: { name: string; legalName: string; nit: string; address: string; city: string; phone: string; instagram: string };
  /** Colores del local. Con whiteLabel, el sistema entero lleva el nombre y los colores del local en lugar de Ronda. */
  theme: { primary: string; accent: string; whiteLabel: boolean };
  tax: { label: string; rate: number };
  tips: { enabled: boolean; suggestedPct: number };
  payments: { efectivo: boolean; nequi: boolean; breb: boolean; tarjeta: boolean; daviplata: boolean; nequiPhone: string; brebKey: string };
  happyHour: HappyHour;
  loyalty: { enabled: boolean; minPurchase: number; goal: number; reward: string; rewardMax: number };
  /**
   * Facturación ante la DIAN. prefix…validTo: la resolución del tiquete POS electrónico (prefijo, rango y vigencia; 0 o ""
   * si no se ha cargado). fe…: la de factura electrónica, para quien la pida con NIT o cédula (vacía: va el tiquete POS
   * con el cliente identificado). regime y responsibilities: lo que dice el RUT del local.
   */
  invoice: {
    prefix: string;
    resolution: string;
    provider: string;
    mode: "demo" | "pruebas" | "produccion";
    rangeFrom: number;
    rangeTo: number;
    validFrom: string;
    validTo: string;
    fePrefix: string;
    feResolution: string;
    feRangeFrom: number;
    feRangeTo: number;
    feValidFrom: string;
    feValidTo: string;
    regime: "ordinario" | "simple";
    responsibilities: string;
  };
  receipt: { footer: string };
  alerts: { voidLimit: number; discountLimitPct: number; ownerWhatsapp: string };
  qr: { enabled: boolean; requireApproval: boolean; payAtTable: boolean };
  /** Domicilios: canales activos y la comisión pactada con cada plataforma (% del valor del pedido) */
  channels: { rappi: boolean; rappiPct: number; didi: boolean; didiPct: number; propio: boolean };
  /** Costo del equipo: carga sobre el salario, alerta de mano de obra y turnos del local */
  labor: { exonerated: boolean; arlClass: number; alertPct: number; turnos: Turno[] };
  /** Bloqueo por inactividad de las tablets, en minutos (0: apagado) */
  security: { lockMinutes: number };
  /** Barra y cocina: a los cuántos minutos un tiquete se pone amarillo (warn) y rojo (late), por estación */
  kds: { barraWarn: number; barraLate: number; cocinaWarn: number; cocinaLate: number };
  /** Motivos de lista (anular, cortesía, descuento) y notas rápidas para barra y cocina: un toque en vez de escribir */
  reasons: { void: string[]; courtesy: string[]; discount: string[]; notes: string[] };
}

export const DEFAULT_SETTINGS: Settings = {
  business: { name: "Mi local", legalName: "", nit: "", address: "", city: "Pereira, Risaralda", phone: "", instagram: "" },
  theme: { primary: "#1E4FB8", accent: "#F4B400", whiteLabel: false },
  tax: { label: "Impuesto al consumo", rate: 8 },
  tips: { enabled: true, suggestedPct: 10 },
  payments: { efectivo: true, nequi: true, breb: true, tarjeta: true, daviplata: false, nequiPhone: "", brebKey: "" },
  happyHour: { enabled: false, days: [1, 2, 3, 4, 5], from: "17:00", to: "19:00", label: "Happy hour" },
  loyalty: { enabled: true, minPurchase: 15000, goal: 8, reward: "Una bebida de la casa", rewardMax: 12000 },
  invoice: {
    prefix: "FE",
    resolution: "",
    provider: "Factus",
    mode: "demo",
    rangeFrom: 0,
    rangeTo: 0,
    validFrom: "",
    validTo: "",
    fePrefix: "",
    feResolution: "",
    feRangeFrom: 0,
    feRangeTo: 0,
    feValidFrom: "",
    feValidTo: "",
    regime: "ordinario",
    responsibilities: "",
  },
  receipt: { footer: "La propina es voluntaria. ¡Gracias por venir!" },
  alerts: { voidLimit: 20000, discountLimitPct: 10, ownerWhatsapp: "" },
  qr: { enabled: true, requireApproval: true, payAtTable: true },
  channels: { rappi: true, rappiPct: 25, didi: false, didiPct: 20, propio: true },
  labor: { exonerated: true, arlClass: 1, alertPct: 35, turnos: [{ name: "Día", from: "06:00" }, { name: "Noche", from: "17:00" }] },
  security: { lockMinutes: 10 },
  kds: { barraWarn: 6, barraLate: 12, cocinaWarn: 12, cocinaLate: 20 },
  reasons: {
    void: ["Se marcó dos veces", "El cliente cambió de opinión", "Demoró mucho", "Salió mal preparado"],
    courtesy: ["Cortesía de la casa", "Compensación por demora", "Cliente frecuente", "Cumpleaños"],
    discount: ["Cliente frecuente", "Error en el pedido", "Convenio", "Consumo del equipo"],
    notes: ["Sin cebolla", "Sin salsas", "Salsas aparte", "Bien asada", "Sin hielo", "Para compartir"],
  },
};

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Mezcla lo guardado con los valores por defecto, campo por campo, y descarta tipos raros. */
export function mergeSettings(saved: unknown): Settings {
  const out = structuredClone(DEFAULT_SETTINGS) as unknown as Obj;
  if (!isObj(saved)) return out as unknown as Settings;
  for (const [group, defaults] of Object.entries(out)) {
    const incoming = saved[group];
    if (!isObj(incoming) || !isObj(defaults)) continue;
    for (const [key, def] of Object.entries(defaults)) {
      const v = incoming[key];
      if (v === undefined) continue;
      if (Array.isArray(def) ? Array.isArray(v) : typeof v === typeof def) (defaults as Obj)[key] = v;
    }
  }
  const s = out as unknown as Settings;
  s.tips.suggestedPct = Math.min(10, Math.max(0, Math.round(s.tips.suggestedPct)));
  s.tax.rate = Math.min(19, Math.max(0, s.tax.rate));
  s.happyHour.days = s.happyHour.days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
  s.channels.rappiPct = Math.min(50, Math.max(0, Math.round(s.channels.rappiPct)));
  s.channels.didiPct = Math.min(50, Math.max(0, Math.round(s.channels.didiPct)));
  s.labor.arlClass = Math.min(5, Math.max(1, Math.round(s.labor.arlClass) || 1));
  s.labor.alertPct = Math.min(60, Math.max(10, Math.round(s.labor.alertPct) || 35));
  s.labor.turnos = cleanTurnos(s.labor.turnos);
  s.security.lockMinutes = Math.min(120, Math.max(0, Math.round(s.security.lockMinutes) || 0));
  for (const st of ["barra", "cocina"] as const) {
    const warn = Math.min(60, Math.max(1, Math.round(s.kds[`${st}Warn`]) || DEFAULT_SETTINGS.kds[`${st}Warn`]));
    s.kds[`${st}Warn`] = warn;
    s.kds[`${st}Late`] = Math.min(120, Math.max(warn + 1, Math.round(s.kds[`${st}Late`]) || DEFAULT_SETTINGS.kds[`${st}Late`]));
  }
  for (const k of ["void", "courtesy", "discount", "notes"] as const) s.reasons[k] = cleanList(s.reasons[k]);
  for (const k of ["prefix", "fePrefix"] as const) s.invoice[k] = String(s.invoice[k] ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  for (const k of ["validFrom", "validTo", "feValidFrom", "feValidTo"] as const) if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s.invoice[k] ?? ""))) s.invoice[k] = "";
  for (const k of ["rangeFrom", "rangeTo", "feRangeFrom", "feRangeTo"] as const) s.invoice[k] = Math.max(0, Math.floor(Number(s.invoice[k]) || 0));
  for (const k of ["resolution", "feResolution"] as const) s.invoice[k] = String(s.invoice[k] ?? "").trim().slice(0, 60);
  s.invoice.responsibilities = String(s.invoice.responsibilities ?? "").trim().slice(0, 80);
  if (s.invoice.regime !== "simple") s.invoice.regime = "ordinario";
  return s;
}

/** Lista corta de textos: sin repetir, de 3 a 40 letras, hasta 8. */
function cleanList(list: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of Array.isArray(list) ? list : []) {
    if (typeof v !== "string") continue;
    const text = v.replace(/\s+/g, " ").trim().slice(0, 40);
    const key = text.toLowerCase();
    if (text.length < 3 || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out.slice(0, 8);
}

/** Turnos del local: nombre corto y hora de inicio válida, sin repetir hora, de 1 a 4, en el orden de la jornada. */
function cleanTurnos(list: unknown): Turno[] {
  const seen = new Set<number>();
  const out: Turno[] = [];
  for (const t of Array.isArray(list) ? list : []) {
    if (!isObj(t) || typeof t.name !== "string" || typeof t.from !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t.from)) continue;
    const name = t.name.trim().slice(0, 20);
    if (!name || seen.has(toMinutes(t.from))) continue;
    seen.add(toMinutes(t.from));
    out.push({ name, from: t.from });
  }
  return out.length ? sortTurnos(out).slice(0, 4) : structuredClone(DEFAULT_SETTINGS.labor.turnos);
}

export const ROLE_LABEL: Record<string, string> = {
  owner: "Dueño",
  admin: "Administrador",
  cashier: "Caja",
  waiter: "Mesero",
  bar: "Barra y cocina",
};

export const METHOD_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  nequi: "Nequi",
  breb: "Bre-B",
  tarjeta: "Tarjeta",
  daviplata: "Daviplata",
  plataforma: "Pagado en la plataforma",
};

export const CHANNEL_LABEL: Record<string, string> = { local: "En el local", rappi: "Rappi", didi: "DiDi Food", propio: "Domicilio propio" };
/** Etiqueta corta para tiquetes y cuentas: el código P- ya dice que es domicilio propio */
export const CHANNEL_SHORT: Record<string, string> = { rappi: "Rappi", didi: "DiDi", propio: "Domicilio" };
export const CHANNEL_COLOR: Record<string, string> = { local: "#6b6660", rappi: "#FF441F", didi: "#FC4C02", propio: "#0B7A55" };

/** Comisión de la plataforma, en % del valor del pedido. */
export function channelPct(s: Settings, channel: string) {
  return channel === "rappi" ? s.channels.rappiPct : channel === "didi" ? s.channels.didiPct : 0;
}

export const STATION_LABEL: Record<string, string> = { barra: "Barra", cocina: "Cocina" };

/** Umbrales de tiempo de una estación (sin estación: los de cocina, que son los más largos). */
export function kdsThresholds(s: Settings, station: string | null) {
  return station === "barra" ? { warn: s.kds.barraWarn, late: s.kds.barraLate } : { warn: s.kds.cocinaWarn, late: s.kds.cocinaLate };
}
