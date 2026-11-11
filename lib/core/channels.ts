/**
 * Canales de venta: dónde se ofrece cada producto y a qué precio. El precio base es el del local (con happy hour);
 * para llevar y cada plataforma pueden tener el suyo. Sin regla, vale el precio base. Puro: lo usan el servidor,
 * la carta QR y las pruebas.
 */
export const SALE_CHANNELS = ["local", "llevar", "rappi", "didi", "propio", "qr"] as const;
export type SaleChannel = (typeof SALE_CHANNELS)[number];

/** Canales con precio propio. En la carta QR se cobra lo del local: la misma mesa no tiene dos precios. */
export const PRICE_CHANNELS = ["llevar", "rappi", "didi", "propio"] as const;
export type PriceChannel = (typeof PRICE_CHANNELS)[number];

export const SALE_CHANNEL_LABEL: Record<SaleChannel, string> = {
  local: "Mesa y barra",
  llevar: "Para llevar",
  rappi: "Rappi",
  didi: "DiDi Food",
  propio: "Domicilio propio",
  qr: "Carta QR",
};

export function isSaleChannel(v: unknown): v is SaleChannel {
  return typeof v === "string" && (SALE_CHANNELS as readonly string[]).includes(v);
}

export function isPriceChannel(v: unknown): v is PriceChannel {
  return typeof v === "string" && (PRICE_CHANNELS as readonly string[]).includes(v);
}

/** El canal de una cuenta: el domicilio por su plataforma, lo de llevar aparte y el resto es el local. */
export function channelOfCheck(check: { kind: string; channel?: string | null }): SaleChannel {
  if (check.kind === "domicilio") return check.channel === "rappi" || check.channel === "didi" ? check.channel : "propio";
  if (check.kind === "llevar") return "llevar";
  return "local";
}

export interface ChannelProduct {
  price: number;
  basePrice: number;
  onHappy: boolean;
  channelPrices: Partial<Record<PriceChannel, number>>;
  hiddenChannels: SaleChannel[];
}

export function visibleIn(p: Pick<ChannelProduct, "hiddenChannels">, channel: SaleChannel) {
  return !p.hiddenChannels.includes(channel);
}

/** Precio en ese canal: el suyo si lo tiene; si no, el del local (que ya trae el happy hour si aplica). */
export function priceIn(p: Pick<ChannelProduct, "price" | "channelPrices">, channel: SaleChannel) {
  const own = isPriceChannel(channel) ? p.channelPrices[channel] : undefined;
  return own && own > 0 ? own : p.price;
}

/** La carta vista desde un canal: sin lo que no se ofrece allí y con sus precios. */
export function menuForChannel<P extends ChannelProduct, M extends { products: P[] }>(menu: M, channel: SaleChannel): M {
  return {
    ...menu,
    products: menu.products
      .filter((p) => visibleIn(p, channel))
      .map((p) => {
        const price = priceIn(p, channel);
        return price === p.price ? p : { ...p, price, onHappy: false };
      }),
  };
}

/** Limpia lo que llega del editor: precios enteros positivos y solo canales conocidos. */
export function cleanChannelPrices(input: unknown): Partial<Record<PriceChannel, number>> {
  const out: Partial<Record<PriceChannel, number>> = {};
  if (!input || typeof input !== "object") return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const n = Math.round(Number(v));
    if (isPriceChannel(k) && Number.isFinite(n) && n > 0 && n <= 5_000_000) out[k] = n;
  }
  return out;
}

export function cleanHiddenChannels(input: unknown): SaleChannel[] {
  if (!Array.isArray(input)) return [];
  return SALE_CHANNELS.filter((c) => input.includes(c));
}

/** Código de producto u opción: letras, números, guion y punto, sin espacios; vacío es "sin código". */
export function cleanCode(input: unknown): string | null {
  const s = String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-");
  if (!s) return null;
  if (!/^[A-Z0-9][A-Z0-9._-]{0,29}$/.test(s)) return "";
  return s;
}
