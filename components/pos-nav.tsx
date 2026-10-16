"use client";

import { LogOut, Martini } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { logoutAction } from "@/app/entrar/actions";
import { Avatar } from "@/components/ui";
import { cn } from "@/lib/utils";
import { Live } from "./live";

export function PosNav({
  business,
  links,
  staff,
  happy,
}: {
  business: string;
  links: { href: string; label: string }[];
  staff: { name: string; color: string; role: string };
  happy: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <header className="no-print sticky top-0 z-40 border-b border-linea bg-cal/95 backdrop-blur">
      <div className="flex h-14 items-center gap-3 px-3 sm:px-4">
        <Link href="/salon" className="hidden shrink-0 text-xl font-extrabold tracking-tight [font-stretch:118%] md:block">
          ronda
        </Link>
        <span className="hidden max-w-[180px] truncate text-sm text-humo lg:block">{business}</span>
        <nav className="scrollbar-none flex flex-1 items-center gap-1 overflow-x-auto md:justify-center">
          {links.map((l) => {
            const active = pathname === l.href || pathname.startsWith(`${l.href}/`) || (l.href === "/salon" && pathname.startsWith("/cuenta"));
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cn("whitespace-nowrap rounded-xl px-3.5 py-2 text-[15px] font-semibold transition-colors", active ? "bg-tinto text-cal" : "text-tinto-2 hover:bg-tinto/6")}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        {happy ? (
          <span className="hidden items-center gap-1 rounded-full bg-fachada px-2.5 py-1 text-[13px] font-bold sm:inline-flex">
            <Martini size={14} /> {happy}
          </span>
        ) : null}
        <Live />
        <div className="flex items-center gap-2">
          <Avatar name={staff.name} color={staff.color} size={34} />
          <span className="hidden text-sm leading-tight xl:block">
            <span className="block font-semibold">{staff.name}</span>
            <span className="block text-humo">{staff.role}</span>
          </span>
          <button
            onClick={async () => {
              await logoutAction();
              router.replace("/entrar");
            }}
            className="flex size-10 items-center justify-center rounded-xl text-humo hover:bg-tinto/6 hover:text-tinto"
            aria-label="Cambiar de usuario"
            title="Cambiar de usuario"
          >
            <LogOut size={19} />
          </button>
        </div>
      </div>
    </header>
  );
}
