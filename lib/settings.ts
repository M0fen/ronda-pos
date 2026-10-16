import type { HappyHour } from "./core/time";

/** Todo lo que cambia entre un local y otro vive aquí, como datos (no como código). */
export interface Settings {
  business: { name: string; legalName: string; nit: string; address: string; city: string; phone: string; instagram: string };
  theme: { primary: string; accent: string };
  tax: { label: string; rate: number };
  tips: { enabled: boolean; suggestedPct: number };
  payments: { efectivo: boolean; nequi: boolean; breb: boolean; tarjeta: boolean; daviplata: boolean; nequiPhone: string; brebKey: string };
  happyHour: HappyHour;
  loyalty: { enabled: boolean; minPurchase: number; goal: number; reward: string; rewardMax: number };
  invoice: { prefix: string; resolution: string; provider: string; mode: "demo" | "pruebas" | "produccion" };
  receipt: { footer: string };
  alerts: { voidLimit: number; discountLimitPct: number; ownerWhatsapp: string };
  qr: { enabled: boolean; requireApproval: boolean; payAtTable: boolean };
}

export const DEFAULT_SETTINGS: Settings = {
  business: {
    name: "Café Bar Villa Verde",
    legalName: "Café Bar Villa Verde S.A.S.",
    nit: "900.000.000-0",
    address: "Villa Verde, Pereira",
    city: "Pereira, Risaralda",
    phone: "",
    instagram: "",
  },
  theme: { primary: "#1E4FB8", accent: "#F4B400" },
  tax: { label: "Impuesto al consumo", rate: 8 },
  tips: { enabled: true, suggestedPct: 10 },
  payments: { efectivo: true, nequi: true, breb: true, tarjeta: true, daviplata: false, nequiPhone: "300 000 0000", brebKey: "@cafevillaverde" },
  happyHour: { enabled: true, days: [1, 2, 3, 4, 5], from: "17:00", to: "19:00", label: "Happy hour" },
  loyalty: { enabled: true, minPurchase: 15000, goal: 8, reward: "Una bebida de la casa", rewardMax: 12000 },
  invoice: { prefix: "FEVV", resolution: "Resolución DIAN de prueba (demo)", provider: "Factus", mode: "demo" },
  receipt: { footer: "La propina es voluntaria. ¡Gracias por venir!" },
  alerts: { voidLimit: 20000, discountLimitPct: 10, ownerWhatsapp: "" },
  qr: { enabled: true, requireApproval: true, payAtTable: true },
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
  return s;
}

export const ROLE_LABEL: Record<string, string> = {
  owner: "Dueño",
  admin: "Administrador",
  cashier: "Caja",
  waiter: "Mesero",
  bar: "Barra",
};

export const METHOD_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  nequi: "Nequi",
  breb: "Bre-B",
  tarjeta: "Tarjeta",
  daviplata: "Daviplata",
};

export const STATION_LABEL: Record<string, string> = { barra: "Barra", cocina: "Cocina" };
