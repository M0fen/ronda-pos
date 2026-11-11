"use client";

import { ChevronDown, Lock, LogOut, Martini, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { unlockAction } from "@/app/(pos)/actions";
import { logoutAction } from "@/app/entrar/actions";
import { Avatar } from "@/components/ui";
import { cn } from "@/lib/utils";
import { Keypad } from "./keypad";
import { Live } from "./live";
import { Sheet } from "./sheet";
import { report } from "./toast";

const LOCK_KEY = "ronda-locked";

export function PosNav({
  business,
  whiteLabel,
  sede,
  links,
  staff,
  happy,
  lockMinutes,
}: {
  business: string;
  whiteLabel?: boolean;
  sede?: string;
  links: { href: string; label: string }[];
  staff: { id: string; name: string; color: string; role: string; pinLen: number };
  happy: string | null;
  /** Bloqueo por inactividad: tras estos minutos sin tocar la pantalla, pide el PIN de nuevo (0: apagado) */
  lockMinutes: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`) || (href === "/salon" && pathname.startsWith("/cuenta"));
  const current = links.find((l) => isActive(l.href));
  const logout = async () => {
    try {
      localStorage.removeItem(LOCK_KEY);
    } catch {}
    await logoutAction();
    router.replace("/entrar");
  };
  return (
    <header className="no-print sticky top-0 z-40 border-b border-linea bg-cal/95 backdrop-blur">
      <div className="flex h-14 items-center gap-3 px-3 sm:px-4">
        <Link href="/salon" className="hidden shrink-0 text-xl font-extrabold tracking-tight [font-stretch:118%] md:block">
          {whiteLabel ? business : "ronda"}
        </Link>
        {whiteLabel ? (sede ? <span className="hidden max-w-[180px] truncate text-sm text-humo lg:block">{sede}</span> : null) : <span className="hidden max-w-[180px] truncate text-sm text-humo lg:block">{[business, sede].filter(Boolean).join(" · ")}</span>}
        {/* En el celular no caben todas: un menú que dice dónde estás y muestra el resto */}
        <button onClick={() => setMenu(true)} className="mr-auto flex h-11 min-w-0 items-center gap-2 rounded-xl bg-tinto/6 pr-2.5 pl-3 text-left font-semibold md:hidden" aria-label="Menú" aria-haspopup="dialog">
          <Menu size={20} className="shrink-0" />
          <span className="truncate">{current?.label ?? "Menú"}</span>
          <ChevronDown size={16} className="shrink-0 text-humo" />
        </button>
        <nav className="hidden flex-1 items-center gap-1 overflow-x-auto md:flex md:justify-center">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={cn("whitespace-nowrap rounded-xl px-3.5 py-2 text-[15px] font-semibold transition-colors", isActive(l.href) ? "bg-tinto text-cal" : "text-tinto-2 hover:bg-tinto/6")}>
              {l.label}
            </Link>
          ))}
        </nav>
        {happy ? (
          <span className="hidden items-center gap-1 rounded-full bg-fachada px-2.5 py-1 text-[13px] font-bold sm:inline-flex">
            <Martini size={14} /> {happy}
          </span>
        ) : null}
        {/* En el panel no se recarga con cada cambio del salón: los reportes pesan */}
        <Live refresh={!pathname.startsWith("/panel")} />
        <div className="flex items-center gap-2">
          <Avatar name={staff.name} color={staff.color} size={34} />
          <span className="hidden text-sm leading-tight xl:block">
            <span className="block font-semibold">{staff.name}</span>
            <span className="block text-humo">{staff.role}</span>
          </span>
          <button onClick={logout} className="flex size-10 items-center justify-center rounded-xl text-humo hover:bg-tinto/6 hover:text-tinto" aria-label="Cambiar de usuario" title="Cambiar de usuario">
            <LogOut size={19} />
          </button>
        </div>
      </div>
      <Sheet open={menu} onClose={() => setMenu(false)} title={whiteLabel ? business : "ronda"}>
        <div className="grid gap-2">
          {links.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setMenu(false)} className={cn("flex h-14 items-center rounded-2xl px-4 text-lg font-semibold ring-1", isActive(l.href) ? "bg-tinto text-cal ring-tinto" : "ring-linea-2")}>
              {l.label}
            </Link>
          ))}
          <button onClick={logout} className="mt-2 flex h-12 items-center gap-2 rounded-2xl px-4 font-semibold text-humo ring-1 ring-linea-2">
            <LogOut size={18} /> Cambiar de usuario ({staff.name})
          </button>
        </div>
      </Sheet>
      {lockMinutes > 0 ? <IdleLock minutes={lockMinutes} staff={staff} onLogout={logout} /> : null}
    </header>
  );
}

/** Tras unos minutos sin uso, la tablet pide otra vez el PIN de quien tiene la sesión (o cambiar de usuario). */
function IdleLock({ minutes, staff, onLogout }: { minutes: number; staff: { id: string; name: string; pinLen: number }; onLogout: () => void }) {
  const [locked, setLocked] = useState(false);
  const [pin, setPin] = useState("");
  const [pending, start] = useTransition();
  const last = useRef(Date.now());
  const lock = useCallback(() => {
    setLocked(true);
    try {
      localStorage.setItem(LOCK_KEY, staff.id);
    } catch {}
  }, [staff.id]);
  useEffect(() => {
    try {
      if (localStorage.getItem(LOCK_KEY) === staff.id) setLocked(true);
    } catch {}
    const touch = () => (last.current = Date.now());
    const events = ["pointerdown", "keydown", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const t = setInterval(() => Date.now() - last.current > minutes * 60_000 && lock(), 15_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      clearInterval(t);
    };
  }, [minutes, lock, staff.id]);
  if (!locked) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-tinto/80 p-4 backdrop-blur" role="dialog" aria-modal="true" aria-label="Pantalla bloqueada">
      <div className="w-full max-w-sm rounded-3xl bg-papel p-5">
        <p className="flex items-center gap-2 text-xl font-bold">
          <Lock size={20} /> Pantalla bloqueada
        </p>
        <p className="mt-1 text-tinto-2">Nadie la usó en {minutes} minutos. {staff.name}, escribe tu PIN para seguir.</p>
        <div className="my-5 flex justify-center gap-4">
          {Array.from({ length: staff.pinLen }, (_, i) => (
            <span key={i} className={`size-4 rounded-full ${i < pin.length ? "bg-tinto" : "bg-tinto/12"}`} />
          ))}
        </div>
        <Keypad
          onKey={(k) => {
            if (pending) return;
            if (k === "del") return setPin((p) => p.slice(0, -1));
            const next = (pin + k).slice(0, staff.pinLen);
            setPin(next);
            if (next.length !== staff.pinLen) return;
            start(async () => {
              const r = await unlockAction(next);
              setPin("");
              if (report(r)) {
                last.current = Date.now();
                setLocked(false);
                try {
                  localStorage.removeItem(LOCK_KEY);
                } catch {}
              }
            });
          }}
        />
        <button onClick={onLogout} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl font-semibold ring-1 ring-linea-2">
          <LogOut size={18} /> Cambiar de usuario
        </button>
      </div>
    </div>
  );
}
