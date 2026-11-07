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

/** Lo que no puede faltar en la bolsa: cada producto con su cantidad y sus opciones, y lo de siempre. */
export function packingList(items: (Item & { name: string; qty: number; modifiers: { name: string }[] })[]) {
  const lines = items
    .filter((i) => i.status !== "void")
    .map((i) => `${i.qty} × ${i.name}${i.modifiers.length ? ` (${i.modifiers.map((m) => m.name).join(", ")})` : ""}`);
  return [...lines, "Salsas y cubiertos", "Factura en la bolsa", "Bolsa sellada"];
}
