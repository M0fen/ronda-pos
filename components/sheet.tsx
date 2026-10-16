"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";
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
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}>
      <button className="absolute inset-0 bg-tinto/45" onClick={onClose} aria-label="Cerrar" tabIndex={-1} />
      <div
        ref={ref}
        className={cn(
          "relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl shadow-2xl sm:rounded-3xl",
          wide ? "sm:max-w-2xl" : "sm:max-w-md",
          dark ? "bg-noche-2 text-cal" : "bg-papel text-tinto",
        )}
      >
        <div className={cn("flex items-center justify-between gap-3 border-b px-5 py-4", dark ? "border-white/10" : "border-linea")}>
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className={cn("flex size-10 items-center justify-center rounded-full", dark ? "hover:bg-white/10" : "hover:bg-tinto/5")} aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className={cn("border-t px-5 py-4", dark ? "border-white/10" : "border-linea")}>{footer}</div> : null}
      </div>
    </div>
  );
}
