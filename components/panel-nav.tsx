"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function PanelNav({ links }: { links: { href: string; label: string }[] }) {
  const pathname = usePathname();
  const ref = useRef<HTMLElement>(null);
  // En el celular no caben todas: la sección abierta se trae a la vista y el borde se desvanece si hay más
  const [more, setMore] = useState(false);
  const measure = useCallback(() => {
    const n = ref.current;
    if (n) setMore(n.scrollLeft + n.clientWidth < n.scrollWidth - 4);
  }, []);
  useEffect(() => {
    const n = ref.current;
    if (!n) return;
    const active = n.querySelector<HTMLElement>("[aria-current='page']");
    if (active) n.scrollLeft = Math.max(0, active.offsetLeft - (n.clientWidth - active.offsetWidth) / 2);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(n);
    return () => ro.disconnect();
  }, [pathname, measure]);
  return (
    <nav
      ref={ref}
      onScroll={measure}
      className={cn("scrollbar-none no-print -mx-1 flex gap-1 overflow-x-auto px-1", more && "[mask-image:linear-gradient(to_right,black_calc(100%-3rem),transparent)]")}
      aria-label="Secciones del panel"
    >
      {links.map((l) => {
        const active = l.href === "/panel" ? pathname === "/panel" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn("whitespace-nowrap rounded-full px-4 py-2.5 text-[15px] font-semibold", active ? "bg-balcon text-white" : "bg-papel text-tinto-2 ring-1 ring-linea hover:ring-tinto")}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
