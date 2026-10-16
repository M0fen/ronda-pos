"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function PanelNav({ links }: { links: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav className="scrollbar-none no-print -mx-1 flex gap-1 overflow-x-auto px-1" aria-label="Secciones del panel">
      {links.map((l) => {
        const active = l.href === "/panel" ? pathname === "/panel" : pathname.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} className={cn("whitespace-nowrap rounded-full px-4 py-2 text-[15px] font-semibold", active ? "bg-balcon text-white" : "bg-papel text-tinto-2 ring-1 ring-linea hover:ring-tinto")}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
