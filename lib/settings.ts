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
  /** Resolución de facturación de la DIAN: prefijo, rango autorizado y vigencia (0 o "" si no se ha cargado) */
  invoice: { prefix: string; resolution: string; provider: string; mode: "demo" | "pruebas" | "produccion"; rangeFrom: number; rangeTo: number; validFrom: string; validTo: string };
  receipt: { footer: string };
  alerts: { voidLimit: number; discountLimitPct: number; ownerWhatsapp: string };
  qr: { enabled: boolean; requireApproval: boolean; payAtTable: boolean };
  /** Domicilios: canales activos y la comisión pactada con cada plataforma (% del valor del pedido) */
  channels: { rappi: boolean; rappiPct: number; didi: boolean; didiPct: number; propio: boolean };
  /** Costo del equipo: carga sobre el salario, alerta de mano de obra y turnos del local */
  labor: { exonerated: boolean; arlClass: number; alertPct: number; turnos: Turno[] };
  /** Bloqueo por inactividad de las tablets, en minutos (0: apagado) */
  security: { lockMinutes: number };
}

export const DEFAULT_SETTINGS: Settings = {
  business: { name: "Mi local", legalName: "", nit: "", address: "", city: "Pereira, Risaralda", phone: "", instagram: "" },
  theme: { primary: "#1E4FB8", accent: "#F4B400", whiteLabel: false },
  tax: { label: "Impuesto al consumo", rate: 8 },
  tips: { enabled: true, suggestedPct: 10 },
  payments: { efectivo: true, nequi: true, breb: true, tarjeta: true, daviplata: false, nequiPhone: "", brebKey: "" },
  happyHour: { enabled: false, days: [1, 2, 3, 4, 5], from: "17:00", to: "19:00", label: "Happy hour" },
  loyalty: { enabled: true, minPurchase: 15000, goal: 8, reward: "Una bebida de la casa", rewardMax: 12000 },
  invoice: { prefix: "FE", resolution: "", provider: "Factus", mode: "demo", rangeFrom: 0, rangeTo: 0, validFrom: "", validTo: "" },
  receipt: { footer: "La propina es voluntaria. ¡Gracias por venir!" },
  alerts: { voidLimit: 20000, discountLimitPct: 10, ownerWhatsapp: "" },
  qr: { enabled: true, requireApproval: true, payAtTable: true },
  channels: { rappi: true, rappiPct: 25, didi: false, didiPct: 20, propio: true },
  labor: { exonerated: true, arlClass: 1, alertPct: 35, turnos: [{ name: "Día", from: "06:00" }, { name: "Noche", from: "17:00" }] },
  security: { lockMinutes: 10 },
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
  s.invoice.prefix = s.invoice.prefix.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  for (const k of ["validFrom", "validTo"] as const) if (!/^\d{4}-\d{2}-\d{2}$/.test(s.invoice[k])) s.invoice[k] = "";
  for (const k of ["rangeFrom", "rangeTo"] as const) s.invoice[k] = Math.max(0, Math.floor(Number(s.invoice[k]) || 0));
  return s;
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
