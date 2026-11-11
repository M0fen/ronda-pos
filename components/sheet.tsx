"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Hoja: sube desde abajo en el teléfono y aparece al centro en la tablet. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
  dark,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
  dark?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Al cerrar, la hoja se queda un instante para salir con su animación, mostrando lo último que tenía
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  const closing = shown && !open;
  const last = useRef({ title, children, footer });
  if (open) last.current = { title, children, footer };
  const view = open ? { title, children, footer } : last.current;
  useEffect(() => {
    if (!closing) return;
    const quiet = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(() => setShown(false), quiet ? 0 : 190);
    return () => clearTimeout(t);
  }, [closing]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!shown) return null;
  return (
    <div
      className={cn("fixed inset-x-0 top-(--offline-h,0px) bottom-0 z-[60] flex items-end justify-center sm:items-center sm:p-6", closing && "sheet-closing pointer-events-none")}
      role="dialog"
      aria-modal="true"
      aria-label={typeof view.title === "string" ? view.title : undefined}
    >
      <button className="sheet-backdrop absolute inset-0 bg-tinto/45" onClick={onClose} aria-label="Cerrar" tabIndex={-1} />
      <div
        ref={ref}
        className={cn(
          "sheet-panel relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl shadow-2xl sm:rounded-3xl",
          wide ? "sm:max-w-2xl" : "sm:max-w-md",
          dark ? "bg-noche-2 text-cal" : "bg-papel text-tinto",
        )}
      >
        <div className={cn("flex items-center justify-between gap-3 border-b px-5 py-4", dark ? "border-white/10" : "border-linea")}>
          <h2 className="text-lg font-bold">{view.title}</h2>
          <button onClick={onClose} className={cn("flex size-10 items-center justify-center rounded-full", dark ? "hover:bg-white/10" : "hover:bg-tinto/5")} aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{view.children}</div>
        {view.footer ? <div className={cn("border-t px-5 py-4", dark ? "border-white/10" : "border-linea")}>{view.footer}</div> : null}
      </div>
    </div>
  );
}
