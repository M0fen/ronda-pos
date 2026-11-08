"use client";

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Pencil, Plus, Trash2, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteZoneAction, placeTableAction, removeTableAction, saveTableAction, saveZoneAction } from "@/app/(pos)/panel/actions";
import { btn } from "@/components/ui";
import { cn } from "@/lib/utils";
import { Sheet } from "../sheet";
import { report } from "../toast";

type Zone = { id: string; name: string };
type Table = { id: string; zone_id: string; name: string; seats: number; x: number; y: number; shape: string; busy: boolean };

const SHAPES = [
  ["square", "Cuadrada"],
  ["round", "Redonda"],
  ["long", "Larga"],
] as const;
const MAX = { x: 83, y: 66 };
const field = "mt-1 h-12 w-full rounded-xl border border-linea-2 bg-papel px-3 outline-none focus:border-tinto";

/** Zonas y mesas del salón: el plano que ve el equipo, los puestos y la forma de cada mesa. */
export function FloorEditor({ zones, tables }: { zones: Zone[]; tables: Table[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [zoneId, setZoneId] = useState(zones[0]?.id ?? "");
  const [selected, setSelected] = useState<string | null>(null);
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>({});
  const [table, setTable] = useState<{ id: string | null; zoneId: string; name: string; seats: number; shape: string; busy: boolean } | null>(null);
  const [zone, setZone] = useState<{ id: string | null; name: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const zoneNow = zones.some((z) => z.id === zoneId) ? zoneId : (zones[0]?.id ?? "");
  const here = tables.filter((t) => t.zone_id === zoneNow).map((t) => ({ ...t, ...moved[t.id] }));
  const sel = here.find((t) => t.id === selected) ?? null;
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string; data?: unknown }>, after?: (data: unknown) => void) =>
    start(async () => {
      const r = await fn();
      if (report(r)) {
        after?.(r.data);
        router.refresh();
      }
    });
  const nextName = () => {
    const nums = tables.map((t) => parseInt(t.name, 10)).filter(Number.isFinite);
    return String(nums.length ? Math.max(...nums) + 1 : 1);
  };
  const nudge = (dx: number, dy: number) => {
    if (!sel) return;
    const pos = { x: Math.min(MAX.x, Math.max(0, sel.x + dx)), y: Math.min(MAX.y, Math.max(0, sel.y + dy)) };
    setMoved((m) => ({ ...m, [sel.id]: pos }));
    start(async () => {
      const r = await placeTableAction(sel.id, pos);
      if (!r.ok) report(r);
    });
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Mesas y zonas</h1>
          <p className="text-humo">Es el plano que ve el equipo en Salón. Toca una mesa para moverla o cambiarla. Cada mesa nueva trae su QR.</p>
        </div>
        <div className="flex gap-2">
          <button className={btn("soft", "md")} onClick={() => (setConfirm(false), setZone({ id: null, name: "" }))}>
            <Plus size={18} /> Zona
          </button>
          <button
            className={btn("primary", "md")}
            disabled={!zoneNow}
            onClick={() => (setConfirm(false), setTable({ id: null, zoneId: zoneNow, name: nextName(), seats: 4, shape: "square", busy: false }))}
          >
            <Plus size={18} /> Mesa
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="scrollbar-none flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-tinto/6 p-1">
          {zones.map((z) => (
            <button
              key={z.id}
              onClick={() => (setZoneId(z.id), setSelected(null))}
              className={cn("shrink-0 rounded-xl px-4 py-2 text-[15px] font-semibold", zoneNow === z.id ? "bg-papel shadow-sm" : "text-tinto-2")}
            >
              {z.name} <span className="text-humo tnum">{tables.filter((t) => t.zone_id === z.id).length}</span>
            </button>
          ))}
        </div>
        {zoneNow ? (
          <button
            className={btn("ghost", "sm")}
            onClick={() => (setConfirm(false), setZone({ id: zoneNow, name: zones.find((z) => z.id === zoneNow)?.name ?? "" }))}
            aria-label="Cambiar el nombre de la zona"
          >
            <Pencil size={15} /> Zona
          </button>
        ) : null}
      </div>

      {/* Plano en tablet y computador, igual al del salón */}
      <div className="relative mt-4 hidden aspect-[16/7.2] rounded-3xl border border-linea bg-papel/60 sm:block">
        {here.map((t) => (
          <button
            key={t.id}
            onClick={() => setSelected(t.id === selected ? null : t.id)}
            className={cn(
              "absolute flex flex-col items-center justify-center gap-1 bg-papel font-bold ring-1 ring-linea-2 transition-[left,top]",
              t.shape === "round" ? "rounded-[999px]" : "rounded-3xl",
              t.id === selected && "z-10 ring-4 ring-balcon",
            )}
            style={{ left: `${t.x}%`, top: `${t.y}%`, width: t.shape === "long" ? "17%" : "16%", height: "34%" }}
            aria-pressed={t.id === selected}
            aria-label={`Mesa ${t.name}`}
          >
            <span className="text-2xl">{t.name}</span>
            <span className="flex items-center gap-1 text-[13px] font-medium text-humo">
              <Users size={13} /> {t.seats}
            </span>
          </button>
        ))}
        {!here.length ? <p className="absolute inset-0 flex items-center justify-center text-humo">Sin mesas en esta zona. Toca “Mesa” para agregar la primera.</p> : null}
      </div>
      {sel ? (
        <div className="mt-3 hidden flex-wrap items-center gap-2 rounded-2xl bg-papel p-3 ring-1 ring-linea sm:flex">
          <p className="mr-auto font-semibold">Mesa {sel.name}: muévela en el plano</p>
          <button className={btn("soft", "md")} aria-label="Mover a la izquierda" onClick={() => nudge(-3, 0)} disabled={sel.x <= 0}>
            <ArrowLeft size={18} />
          </button>
          <button className={btn("soft", "md")} aria-label="Mover arriba" onClick={() => nudge(0, -5)} disabled={sel.y <= 0}>
            <ArrowUp size={18} />
          </button>
          <button className={btn("soft", "md")} aria-label="Mover abajo" onClick={() => nudge(0, 5)} disabled={sel.y >= MAX.y}>
            <ArrowDown size={18} />
          </button>
          <button className={btn("soft", "md")} aria-label="Mover a la derecha" onClick={() => nudge(3, 0)} disabled={sel.x >= MAX.x}>
            <ArrowRight size={18} />
          </button>
          <button
            className={btn("dark", "md")}
            onClick={() => (setConfirm(false), setTable({ id: sel.id, zoneId: sel.zone_id, name: sel.name, seats: sel.seats, shape: sel.shape, busy: sel.busy }))}
          >
            <Pencil size={16} /> Editar
          </button>
        </div>
      ) : null}

      {/* En el celular, una lista */}
      <ul className="mt-4 divide-y divide-linea rounded-3xl bg-papel px-4 ring-1 ring-linea sm:hidden">
        {here.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2 py-3">
            <span>
              <span className="font-semibold">Mesa {t.name}</span>
              <span className="block text-sm text-humo">
                {t.seats} puestos · {SHAPES.find(([k]) => k === t.shape)?.[1] ?? "Cuadrada"}
              </span>
            </span>
            <button className={btn("soft", "sm")} onClick={() => (setConfirm(false), setTable({ id: t.id, zoneId: t.zone_id, name: t.name, seats: t.seats, shape: t.shape, busy: t.busy }))}>
              <Pencil size={15} /> Editar
            </button>
          </li>
        ))}
        {!here.length ? <li className="py-4 text-center text-humo">Sin mesas en esta zona.</li> : null}
      </ul>
      <p className="mt-3 text-sm text-humo">Si todo el salón es de sillas de barra (un puesto cada una), Ronda pasa a modo mostrador: pedidos primero y cobro antes de preparar.</p>

      <Sheet
        open={!!table}
        onClose={() => setTable(null)}
        title={table?.id ? `Mesa ${table.name}` : "Nueva mesa"}
        footer={
          table ? (
            <button
              className={btn("primary", "lg", "w-full")}
              disabled={pending}
              onClick={() =>
                run(
                  () => saveTableAction({ id: table.id, zoneId: table.zoneId, name: table.name, seats: table.seats, shape: table.shape }),
                  (id) => (setTable(null), typeof id === "string" && (setSelected(id), setZoneId(table.zoneId))),
                )
              }
            >
              {table.id ? "Guardar" : "Crear mesa"}
            </button>
          ) : null
        }
      >
        {table ? (
          <div>
            <label className="block">
              <span className="text-sm font-semibold text-humo">Nombre o número</span>
              <input className={field} value={table.name} maxLength={12} onChange={(e) => setTable({ ...table, name: e.target.value })} />
            </label>
            <p className="mt-3 text-sm font-semibold text-humo">Puestos</p>
            <div className="mt-1 flex items-center gap-3">
              <button className={btn("soft", "lg", "w-14")} onClick={() => setTable({ ...table, seats: Math.max(1, table.seats - 1) })} aria-label="Un puesto menos">
                −
              </button>
              <span className="w-10 text-center text-2xl font-bold tnum">{table.seats}</span>
              <button className={btn("soft", "lg", "w-14")} onClick={() => setTable({ ...table, seats: Math.min(30, table.seats + 1) })} aria-label="Un puesto más">
                +
              </button>
            </div>
            <p className="mt-3 text-sm font-semibold text-humo">Forma</p>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {SHAPES.map(([k, l]) => (
                <button key={k} onClick={() => setTable({ ...table, shape: k })} className={cn("h-12 rounded-xl font-semibold ring-1", table.shape === k ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}>
                  {l}
                </button>
              ))}
            </div>
            <label className="mt-3 block">
              <span className="text-sm font-semibold text-humo">Zona</span>
              <select className={field} value={table.zoneId} onChange={(e) => setTable({ ...table, zoneId: e.target.value })}>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            </label>
            {table.id ? (
              <div className="mt-5 border-t border-linea pt-4">
                {table.busy ? (
                  <p className="text-sm text-humo">Tiene una cuenta abierta: para quitarla, ciérrala primero.</p>
                ) : confirm ? (
                  <button className={btn("danger", "md", "w-full")} disabled={pending} onClick={() => run(() => removeTableAction(table.id!), () => (setTable(null), setSelected(null)))}>
                    Sí, quitar la mesa {table.name}
                  </button>
                ) : (
                  <button className={btn("ghost", "md", "text-cereza")} onClick={() => setConfirm(true)}>
                    <Trash2 size={16} /> Quitar mesa
                  </button>
                )}
                <p className="mt-2 text-[13px] text-humo">Su QR deja de funcionar. Las cuentas que ya tuvo quedan en el historial.</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </Sheet>

      <Sheet
        open={!!zone}
        onClose={() => setZone(null)}
        title={zone?.id ? "Zona" : "Nueva zona"}
        footer={
          zone ? (
            <button
              className={btn("primary", "lg", "w-full")}
              disabled={pending}
              onClick={() => run(() => saveZoneAction(zone), (id) => (setZone(null), typeof id === "string" && setZoneId(id)))}
            >
              Guardar
            </button>
          ) : null
        }
      >
        {zone ? (
          <div>
            <label className="block">
              <span className="text-sm font-semibold text-humo">Nombre</span>
              <input className={field} value={zone.name} maxLength={24} data-autofocus onChange={(e) => setZone({ ...zone, name: e.target.value })} placeholder="Ej. Salón, Terraza, Barra" />
            </label>
            {zone.id ? (
              <div className="mt-5 border-t border-linea pt-4">
                {confirm ? (
                  <button className={btn("danger", "md", "w-full")} disabled={pending} onClick={() => run(() => deleteZoneAction(zone.id!), () => (setZone(null), setZoneId("")))}>
                    Sí, quitar la zona
                  </button>
                ) : (
                  <button className={btn("ghost", "md", "text-cereza")} onClick={() => setConfirm(true)}>
                    <Trash2 size={16} /> Quitar zona
                  </button>
                )}
                <p className="mt-2 text-[13px] text-humo">Solo se puede quitar si ya no tiene mesas.</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
