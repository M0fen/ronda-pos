"use client";

import { useEffect, useMemo, useState } from "react";
import { ROLE_LABEL } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { Keypad } from "./keypad";
import { Sheet } from "./sheet";

/** Quién puede autorizar en la sede (lo pasa la página desde el servidor). */
export interface Authorizer {
  id: string;
  name: string;
  role: string;
  color: string;
  pin_len: number;
}

export type AuthLevel = "void" | "manage";
export type AuthRequest = { label: string; level: AuthLevel };

const ROLES: Record<AuthLevel, string[]> = { void: ["owner", "admin", "cashier"], manage: ["owner", "admin"] };

/**
 * Autorización de otra persona en el momento: elige quién autoriza y escribe su PIN.
 * Nunca la misma persona que pide el cambio. Si el PIN falla, la hoja sigue abierta para intentar de nuevo.
 */
export function AuthSheet({
  request,
  authorizers,
  meId,
  pending,
  onClose,
  onAuth,
}: {
  request: AuthRequest | null;
  authorizers: Authorizer[];
  meId: string;
  pending?: boolean;
  onClose: () => void;
  onAuth: (auth: { id: string; pin: string }) => void;
}) {
  const people = useMemo(() => (request ? authorizers.filter((a) => ROLES[request.level].includes(a.role) && a.id !== meId) : []), [request, authorizers, meId]);
  const [who, setWho] = useState<Authorizer | null>(null);
  const [pin, setPin] = useState("");
  // Se reinicia al pedir otra autorización o si cambia quién puede autorizar, no con cada refresco de la pantalla:
  // la lista llega del servidor como un arreglo nuevo cada vez que algo cambia en el local (otra tablet envía, cocina
  // marca listo) y eso borraba el PIN a medio escribir y la persona elegida
  const peopleIds = people.map((p) => p.id).join();
  useEffect(() => {
    setPin("");
    setWho(people.length === 1 ? people[0]! : null);
  }, [request, peopleIds]);
  useEffect(() => {
    if (!pending) setPin("");
  }, [pending]);
  if (!request) return null;
  const len = who?.pin_len ?? 4;
  return (
    <Sheet open onClose={onClose} title="Autorización">
      <p className="text-[15px]">
        {request.label}. {request.level === "manage" ? "La autoriza el dueño o la administración" : "La autoriza caja o el encargado"}, con su PIN.
      </p>
      {people.length ? (
        <>
          <p className="mt-4 text-sm font-semibold text-humo">¿Quién autoriza?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {people.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => (setWho(p), setPin(""))}
                className={cn("flex h-12 items-center gap-2 rounded-xl px-3 font-semibold ring-1", who?.id === p.id ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}
                aria-pressed={who?.id === p.id}
              >
                <span className="size-3 rounded-full" style={{ background: p.color }} />
                {p.name}
                <span className={cn("text-[12px] font-medium", who?.id === p.id ? "text-cal/70" : "text-humo")}>{ROLE_LABEL[p.role]}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="mt-4 rounded-2xl bg-fachada-soft px-4 py-3 text-sm font-semibold text-[#6b4b00]">No hay nadie más en la sede que pueda autorizarlo. Pídeselo al dueño.</p>
      )}
      {who ? (
        <>
          <p className="mt-5 text-center text-sm text-humo">PIN de {who.name}</p>
          <div className="my-3 flex justify-center gap-4" aria-label={`${pin.length} de ${len} números`}>
            {Array.from({ length: len }, (_, i) => (
              <span key={i} className={`size-4 rounded-full ${i < pin.length ? "bg-tinto" : "bg-tinto/12"}`} />
            ))}
          </div>
          <Keypad
            onKey={(k) => {
              if (pending) return;
              if (k === "del") return setPin((p) => p.slice(0, -1));
              const next = (pin + k).slice(0, len);
              setPin(next);
              if (next.length === len) onAuth({ id: who.id, pin: next });
            }}
          />
        </>
      ) : null}
    </Sheet>
  );
}
