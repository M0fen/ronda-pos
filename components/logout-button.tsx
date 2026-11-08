"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { logoutAction } from "@/app/entrar/actions";

/** Cierra la sesión de esta tablet (la sesión queda cerrada también en el servidor). */
export function LogoutButton({ className, label = "Salir" }: { className?: string; label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      className={className}
      disabled={pending}
      onClick={() =>
        start(async () => {
          await logoutAction();
          router.replace("/entrar");
          router.refresh();
        })
      }
    >
      <LogOut size={16} /> {label}
    </button>
  );
}
