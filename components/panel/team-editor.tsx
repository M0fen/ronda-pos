"use client";

import { LockOpen, MonitorSmartphone, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { enrollCodeAction, revokeDeviceAction, saveStaffAction, unlockStaffAction } from "@/app/(pos)/panel/actions";
import { Avatar, btn, Pill } from "@/components/ui";
import { hourCost, laborRules, type LaborSettings } from "@/lib/core/labor";
import { cop, parsePesos } from "@/lib/money";
import { ROLE_LABEL } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { Sheet } from "../sheet";
import { report } from "../toast";

type Person = { id: string; name: string; role: string; color: string; active: boolean; pay_kind: "salario" | "hora"; pay_amount: number; locked: boolean; pin_len: number };
type Device = { id: string; name: string; all_sedes: boolean; created_at: string; last_seen: string | null };
const ROLES = ["owner", "admin", "cashier", "waiter", "bar"];
const HIGH = ["owner", "admin"];
const PERMS: Record<string, string> = {
  owner: "Todo, incluidos ajustes, equipo y todas las sedes",
  admin: "Su sede: ajustes, carta y equipo de caja, meseros y barra",
  cashier: "Cobra, abre y cierra caja, autoriza anulaciones y ve el panel",
  waiter: "Toma pedidos y cobra; anular, cortesías y descuentos grandes los autoriza otra persona",
  bar: "Pantalla de barra y cocina, y pedidos en la barra",
};

function payLabel(p: Pick<Person, "pay_kind" | "pay_amount">) {
  if (!p.pay_amount) return "Sin pago registrado";
  return p.pay_kind === "hora" ? `${cop(p.pay_amount)} la hora` : `Salario de ${cop(p.pay_amount)}`;
}

export function TeamEditor({
  people,
  me,
  myRole,
  labor,
  today,
  devices,
  chain,
}: {
  people: Person[];
  me: string;
  myRole: string;
  labor: LaborSettings;
  today: string;
  devices: Device[];
  chain: boolean;
}) {
  const router = useRouter();
  const [edit, setEdit] = useState<Partial<Person> | null>(null);
  const [pin, setPin] = useState("");
  const [pending, start] = useTransition();
  const owner = myRole === "owner";
  // La administración maneja caja, meseros y barra; dueños y administradores, solo el dueño
  const canEdit = (p: Partial<Person>) => owner || !p.role || !HIGH.includes(p.role) || p.id === me;
  const roles = (p: Partial<Person>) => (owner ? ROLES : p.id === me ? [p.role!] : ROLES.filter((r) => !HIGH.includes(r)));
  const pinLen = HIGH.includes(edit?.role ?? "") ? 6 : 4;
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Equipo</h1>
          <p className="text-humo">Cada persona entra con su PIN (4 números; dueño y administración, 6) y con él marca su turno. Todo lo que hace queda con su nombre.</p>
        </div>
        <button className={btn("primary", "md")} onClick={() => (setEdit({ role: "waiter", active: true, pay_kind: "salario", pay_amount: 0, pin_len: 4 }), setPin(""))}>
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
                <span className="block text-sm font-semibold text-tinto-2">{payLabel(p)}</span>
              </span>
              <span className="flex flex-col items-end gap-1">
                <Pill tone={p.active ? "blue" : "neutral"}>{p.active ? ROLE_LABEL[p.role] : "Inactivo"}</Pill>
                {p.locked ? <Pill tone="red">PIN bloqueado</Pill> : null}
              </span>
            </button>
            {p.locked && canEdit(p) ? (
              <button
                className={btn("soft", "sm", "mt-1 w-full")}
                disabled={pending}
                onClick={() => start(async () => void (report(await unlockStaffAction(p.id)) && router.refresh()))}
              >
                <LockOpen size={16} /> Desbloquear el PIN de {p.name}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <Devices devices={devices} owner={owner} chain={chain} />
      <Sheet
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? `Editar a ${edit.name}` : "Nueva persona"}
        footer={
          <button
            className={btn("primary", "lg", "w-full")}
            disabled={pending || (!!edit && !canEdit(edit))}
            onClick={() =>
              start(async () => {
                const payload = { id: edit?.id, name: edit?.name ?? "", role: edit?.role ?? "waiter", pin: pin || undefined, active: edit?.active, payKind: edit?.pay_kind ?? "salario", payAmount: edit?.pay_amount ?? 0 };
                if (report(await saveStaffAction(payload))) {
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
        {edit && !canEdit(edit) ? <p className="mt-3 rounded-xl bg-fachada-soft px-3 py-2 text-sm font-semibold text-[#6b4b00]">Solo el dueño edita a otro dueño o administrador.</p> : null}
        <p className="mt-4 text-sm font-semibold text-humo">Rol</p>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {(edit ? roles(edit) : []).map((r) => (
            <button key={r} onClick={() => setEdit((x) => ({ ...x, role: r }))} className={cn("h-11 rounded-xl font-semibold ring-1", edit?.role === r ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}>
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>
        {!owner ? <p className="mt-1 text-sm text-humo">Los roles de dueño y administración los asigna el dueño.</p> : null}
        <label className="mt-4 block">
          <span className="text-sm font-semibold text-humo">
            {edit?.id ? `Nuevo PIN de ${pinLen} números (déjalo vacío para no cambiarlo)` : `PIN de ${pinLen} números`}
          </span>
          <input
            inputMode="numeric"
            maxLength={pinLen}
            className="mt-1 h-12 w-full rounded-xl border border-linea-2 px-3 font-mono text-lg tracking-[0.4em] outline-none focus:border-tinto"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, pinLen))}
          />
        </label>
        {edit?.id && pinLen === 6 && edit.pin_len === 4 && !pin ? <p className="mt-1 text-sm text-humo">Su PIN actual es de 4 números: cámbialo por uno de 6 cuando puedas.</p> : null}
        <PayFields value={{ pay_kind: edit?.pay_kind ?? "salario", pay_amount: edit?.pay_amount ?? 0 }} onChange={(v) => setEdit((x) => ({ ...x, ...v }))} labor={labor} today={today} />
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

/** Pago de la persona: con él se calcula lo que cuesta cada turno. La nómina legal la liquida el contador. */
function PayFields({ value, onChange, labor, today }: { value: Pick<Person, "pay_kind" | "pay_amount">; onChange: (v: Pick<Person, "pay_kind" | "pay_amount">) => void; labor: LaborSettings; today: string }) {
  const rules = laborRules(today);
  const salary = value.pay_kind === "salario";
  const amount = value.pay_amount;
  return (
    <div className="mt-4">
      <p className="text-sm font-semibold text-humo">Pago, para calcular el costo de sus turnos</p>
      <div className="mt-1 grid grid-cols-2 gap-2">
        {(
          [
            ["salario", "Salario mensual"],
            ["hora", "Por horas"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} onClick={() => onChange({ pay_kind: k, pay_amount: k === value.pay_kind ? amount : 0 })} className={cn("h-11 rounded-xl font-semibold ring-1", value.pay_kind === k ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}>
            {label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          inputMode="numeric"
          aria-label={salary ? "Salario mensual" : "Valor de la hora"}
          placeholder={salary ? "Salario al mes" : "Valor de la hora"}
          className="h-12 min-w-0 flex-1 rounded-xl border border-linea-2 px-3 text-lg tnum outline-none focus:border-tinto"
          value={amount ? cop(amount) : ""}
          onChange={(e) => onChange({ ...value, pay_amount: Math.max(0, parsePesos(e.target.value)) })}
        />
        {salary ? (
          <button className={btn("soft", "md")} onClick={() => onChange({ ...value, pay_amount: rules.smmlv })}>
            El mínimo
          </button>
        ) : null}
      </div>
      <p className="mt-2 text-sm text-humo">
        {!amount
          ? "Sin pago, sus turnos cuentan las horas pero no el costo."
          : salary
            ? `Hora ordinaria ${cop(amount / rules.divisor)}. Con seguridad social, prestaciones${amount <= 2 * rules.smmlv ? " y auxilio de transporte" : ""}: ${cop(hourCost("salario", amount, labor, today))} la hora, antes de recargos.${amount < rules.smmlv ? ` Ojo: está por debajo del mínimo (${cop(rules.smmlv)}); solo aplica a medio tiempo.` : ""}`
            : "Valor fijo por hora, ya con todo: no suma recargos ni prestaciones."}
      </p>
    </div>
  );
}

/** Tablets enroladas en la sede: solo ellas muestran al equipo en /entrar. */
function Devices({ devices, owner, chain }: { devices: Device[]; owner: boolean; chain: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [all, setAll] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <MonitorSmartphone size={20} /> Tablets
          </h2>
          <p className="text-sm text-humo">Solo las tablets enroladas muestran al equipo para entrar. Si se pierde una, quítala aquí.</p>
        </div>
        <button className={btn("soft", "md")} onClick={() => (setName(""), setAll(false), setCode(null), setOpen(true))}>
          <Plus size={18} /> Enrolar una tablet
        </button>
      </div>
      {devices.length ? (
        <ul className="mt-3 divide-y divide-linea rounded-2xl bg-papel px-4 ring-1 ring-linea">
          {devices.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-3">
              <span>
                <span className="block font-semibold">{d.name}</span>
                <span className="block text-sm text-humo">{d.all_sedes ? "Del dueño: sirve en todas las sedes" : "Esta sede"}</span>
              </span>
              <button className={btn("soft", "sm", "text-cereza")} disabled={pending} onClick={() => start(async () => void (report(await revokeDeviceAction(d.id)) && router.refresh()))}>
                Quitar
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 rounded-2xl bg-papel px-4 py-3 text-sm text-humo ring-1 ring-linea">Ninguna todavía. En la demo se puede entrar sin enrolar.</p>
      )}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Enrolar una tablet"
        footer={
          code ? (
            <button className={btn("dark", "lg", "w-full")} onClick={() => (setOpen(false), router.refresh())}>
              Listo
            </button>
          ) : (
            <button
              className={btn("primary", "lg", "w-full")}
              disabled={pending || name.trim().length < 2}
              onClick={() =>
                start(async () => {
                  const r = await enrollCodeAction({ name, allSedes: all });
                  if (r.ok && r.data) setCode(r.data);
                  else report(r);
                })
              }
            >
              Crear código
            </button>
          )
        }
      >
        {code ? (
          <div className="text-center">
            <p className="text-tinto-2">En la tablet, abre /entrar y escribe este código. Vale 15 minutos y sirve una sola vez.</p>
            <p className="mt-4 font-mono text-5xl font-bold tracking-[0.3em]">{code}</p>
          </div>
        ) : (
          <>
            <label className="block">
              <span className="text-sm font-semibold text-humo">Nombre de la tablet</span>
              <input className="mt-1 h-12 w-full rounded-xl border border-linea-2 px-3 outline-none focus:border-tinto" placeholder="Ej. Caja, Barra, Celular de Andrés" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            {owner && chain ? (
              <label className="mt-3 flex items-start gap-3 rounded-2xl bg-cal p-3">
                <input type="checkbox" className="mt-1 size-5" checked={all} onChange={(e) => setAll(e.target.checked)} />
                <span className="text-sm">Es del dueño: puede entrar en todas las sedes.</span>
              </label>
            ) : null}
          </>
        )}
      </Sheet>
    </section>
  );
}
