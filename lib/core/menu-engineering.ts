/**
 * Ingeniería de menú (Kasavana y Smith): cada plato según cuánto se pide y cuánto deja. Popular si su participación
 * llega al 70 % de la que tendría si todos se pidieran igual; rentable si deja por unidad al menos el promedio ponderado.
 */
export type MenuClass = "estrella" | "caballo" | "enigma" | "perro";

export const MENU_CLASS: Record<MenuClass, { label: string; what: string; todo: string }> = {
  estrella: { label: "Estrellas", what: "Se piden mucho y dejan mucho.", todo: "Cuídalas: que no falten y que se vean primero." },
  caballo: { label: "Caballos de batalla", what: "Se piden mucho, pero dejan poco.", todo: "Sube un poco el precio o baja el costo de la receta." },
  enigma: { label: "Enigmas", what: "Dejan mucho, pero casi no se piden.", todo: "Muévelos a un mejor lugar de la carta o que el mesero los ofrezca." },
  perro: { label: "Perros", what: "Ni se piden ni dejan.", todo: "Cámbialos o sácalos de la carta." },
};

export interface DishSales {
  id: string;
  name: string;
  units: number;
  /** Ventas netas (sin impuesto ni propina) del período */
  net: number;
  /** Costo de insumos del período */
  cost: number;
}

export interface EngineeredDish extends DishSales {
  share: number;
  /** Lo que deja cada unidad: venta neta menos costo */
  unitMargin: number;
  cls: MenuClass;
}

export function engineerMenu(dishes: DishSales[]) {
  const sold = dishes.filter((d) => d.units > 0);
  const units = sold.reduce((s, d) => s + d.units, 0);
  if (!sold.length || !units) return { dishes: [] as EngineeredDish[], popularityLine: 0, marginLine: 0 };
  const popularityLine = 0.7 / sold.length;
  const marginLine = sold.reduce((s, d) => s + (d.net - d.cost), 0) / units;
  const out = sold.map((d) => {
    const share = d.units / units;
    const unitMargin = (d.net - d.cost) / d.units;
    const popular = share >= popularityLine;
    const profitable = unitMargin >= marginLine;
    const cls: MenuClass = popular ? (profitable ? "estrella" : "caballo") : profitable ? "enigma" : "perro";
    return { ...d, share, unitMargin, cls };
  });
  return { dishes: out.sort((a, b) => b.units - a.units), popularityLine, marginLine };
}
