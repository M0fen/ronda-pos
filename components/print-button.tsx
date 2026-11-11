"use client";

import { useEffect } from "react";

export function PrintButton({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <button className={className} onClick={() => window.print()}>
      {children}
    </button>
  );
}

/** Abre la impresión apenas cargan las letras (la comanda con ?auto=1). */
export function AutoPrint() {
  useEffect(() => {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      window.print();
    };
    const t = setTimeout(go, 1500);
    document.fonts?.ready.then(() => setTimeout(go, 100));
    return () => {
      done = true;
      clearTimeout(t);
    };
  }, []);
  return null;
}
