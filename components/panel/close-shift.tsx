"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { closeShiftAction } from "@/app/(pos)/panel/actions";
import { btn } from "@/components/ui";
import { cn } from "@/lib/utils";
import { Sheet } from "../sheet";
import { report } from "../toast";

/** El dueño marca la salida de alguien que se fue sin marcarla, con la hora en que salió. */
export function CloseShift({ shiftId, name, nowHHMM, urgent }: { shiftId: string; name: string; nowHHMM: string; urgent?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState(nowHHMM);
  const [pending, start] = useTransition();
  return (
    <>
      <button className={cn(btn(urgent ? "warn" : "light", "sm"))} onClick={() => (setTime(nowHHMM), setOpen(true))}>
        Marcar salida
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={`Salida de ${name}`}
        footer={
          <button
            className={btn("primary", "lg", "w-full")}
            disabled={pending}
            onClick={() =>
              start(async () => {
                if (report(await closeShiftAction(shiftId, time))) {
                  setOpen(false);
                  router.refresh();
                }
              })
            }
          >
            Cerrar el turno
          </button>
        }
      >
        <p className="text-tinto-2">Si se fue sin marcar, pon la hora en que salió. Queda en el registro con tu nombre.</p>
        <label className="mt-4 block">
          <span className="text-sm font-semibold text-humo">Hora de salida</span>
          <input type="time" className="mt-1 h-12 w-full rounded-xl border border-linea-2 px-3 text-lg outline-none focus:border-tinto" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </Sheet>
    </>
  );
}
