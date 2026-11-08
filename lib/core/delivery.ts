/** Domicilios: en qué etapa va cada pedido y qué se revisa antes de cerrar la bolsa. Puro, con pruebas. */

export type DeliveryStage = "nuevo" | "cocina" | "empacar" | "listo";

export const STAGES: { key: DeliveryStage; label: string; hint: string }[] = [
  { key: "nuevo", label: "Nuevos", hint: "Acepta y manda a cocina" },
  { key: "cocina", label: "En cocina", hint: "Se ve el avance de cada pedido" },
  { key: "empacar", label: "Para empacar", hint: "Revisa la lista antes de cerrar la bolsa" },
  { key: "listo", label: "Listos para salir", hint: "Entrega al domiciliario" },
];

type Item = { status: string };

/** Nuevo mientras haya algo sin mandar a cocina; en cocina mientras algo se prepare; luego, a empacar. */
export function deliveryStage(items: Item[], packed: boolean): DeliveryStage {
  if (packed) return "listo";
  const live = items.filter((i) => i.status !== "void");
  if (!live.length || live.some((i) => i.status === "draft")) return "nuevo";
  if (live.some((i) => i.status === "sent")) return "cocina";
  return "empacar";
}

/**
 * Lo que no puede faltar en la bolsa: cada producto con su cantidad y sus opciones, y lo de siempre.
 * Las líneas iguales (el mismo producto en dos rondas) se juntan sumando cantidades: así cada línea es única
 * y marcar una no marca otra. La factura se emite al despachar: en la bolsa va la comanda.
 */
export function packingList(items: (Item & { name: string; qty: number; modifiers: { name: string }[] })[]) {
  const lines = new Map<string, number>();
  for (const i of items.filter((x) => x.status !== "void")) {
    const key = `${i.name}${i.modifiers.length ? ` (${i.modifiers.map((m) => m.name).join(", ")})` : ""}`;
    lines.set(key, (lines.get(key) ?? 0) + i.qty);
  }
  return [...[...lines].map(([name, qty]) => `${qty} × ${name}`), ...PACKING_EXTRAS];
}

export const PACKING_EXTRAS = ["Salsas y cubiertos", "Comanda en la bolsa", "Bolsa sellada"];
