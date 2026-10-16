"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveStaffAction } from "@/app/(pos)/panel/actions";
import { Avatar, btn, Pill } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { Sheet } from "../sheet";
import { report } from "../toast";

type Person = { id: string; name: string; role: string; color: string; active: boolean };
const ROLES = ["owner", "admin", "cashier", "waiter", "bar"];
const PERMS: Record<string, string> = {
  owner: "Todo, incluidos ajustes y equipo",
  admin: "Todo, incluidos ajustes y equipo",
  cashier: "Cobra, abre y cierra caja, anula y ve el panel",
  waiter: "Toma pedidos y cobra; anular lo enviado pide autorización",
  bar: "Pantalla de barra y pedidos en la barra",
};

export function TeamEditor({ people, me }: { people: Person[]; me: string }) {
  const router = useRouter();
  const [edit, setEdit] = useState<Partial<Person> | null>(null);
  const [pin, setPin] = useState("");
  const [pending, start] = useTransition();
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Equipo</h1>
          <p className="text-humo">Cada persona entra con su PIN de 4 números. Todo lo que hace queda con su nombre.</p>
        </div>
        <button className={btn("primary", "md")} onClick={() => (setEdit({ role: "waiter", active: true }), setPin(""))}>
          <Plus size={18} /> Agregar persona
        </button>
      </div>
      <ul className="mt-4 grid gap-2 md:grid-cols-2">
        {people.map((p) => (
          <li key={p.id}>
            <button onClick={() => (setEdit(p), setPin(""))} className={cn("flex w-full items-center gap-3 rounded-2xl bg-papel p-4 text-left ring-1 ring-linea hover:ring-tinto", !p.active && "opacity-50")}>
              <Avatar name={p.name} color={p.color} size={44} />
              <span className="flex-1">
                <span className="block font-semibold">
                  {p.name} {p.id === me ? <span className="text-humo">(tú)</span> : null}
                </span>
                <span className="block text-sm text-humo">{PERMS[p.role]}</span>
              </span>
              <Pill tone={p.active ? "blue" : "neutral"}>{p.active ? ROLE_LABEL[p.role] : "Inactivo"}</Pill>
            </button>
          </li>
        ))}
      </ul>
      <Sheet
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? `Editar a ${edit.name}` : "Nueva persona"}
        footer={
          <button
            className={btn("primary", "lg", "w-full")}
            disabled={pending}
            onClick={() =>
              start(async () => {
                if (report(await saveStaffAction({ id: edit?.id, name: edit?.name ?? "", role: edit?.role ?? "waiter", pin: pin || undefined, active: edit?.active }))) {
                  setEdit(null);
                  router.refresh();
                }
              })
            }
          >
            Guardar
          </button>
        }
      >
        <label className="block">
          <span className="text-sm font-semibold text-humo">Nombre</span>
          <input className="mt-1 h-12 w-full rounded-xl border border-linea-2 px-3 outline-none focus:border-tinto" value={edit?.name ?? ""} onChange={(e) => setEdit((x) => ({ ...x, name: e.target.value }))} />
        </label>
        <p className="mt-4 text-sm font-semibold text-humo">Rol</p>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {ROLES.map((r) => (
            <button key={r} onClick={() => setEdit((x) => ({ ...x, role: r }))} className={cn("h-11 rounded-xl font-semibold ring-1", edit?.role === r ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}>
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>
        <label className="mt-4 block">
          <span className="text-sm font-semibold text-humo">{edit?.id ? "Nuevo PIN (déjalo vacío para no cambiarlo)" : "PIN de 4 números"}</span>
          <input inputMode="numeric" maxLength={4} className="mt-1 h-12 w-full rounded-xl border border-linea-2 px-3 font-mono text-lg tracking-[0.4em] outline-none focus:border-tinto" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} />
        </label>
        {edit?.id && edit.id !== me ? (
          <label className="mt-4 flex items-center gap-3">
            <input type="checkbox" className="size-5" checked={edit.active ?? true} onChange={(e) => setEdit((x) => ({ ...x, active: e.target.checked }))} />
            Puede entrar al sistema
          </label>
        ) : null}
      </Sheet>
    </div>
  );
}
