"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Pantallas públicas (sin sesión): vuelven a pedir la página cada pocos segundos. */
export function AutoRefresh({ every = 4000 }: { every?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && router.refresh(), every);
    return () => clearInterval(t);
  }, [every, router]);
  return null;
}
