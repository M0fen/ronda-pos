import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SetupWizard } from "@/components/setup-wizard";
import { needsSetup, setupConfigured } from "@/lib/server/setup";

export const metadata: Metadata = { title: "Alta del local", robots: { index: false, follow: false } };

/** Primera vez con una base de datos vacía: se crea el local y su dueño. Después, esta página manda a /entrar. */
export default async function SetupPage({ searchParams }: { searchParams: Promise<{ codigo?: string }> }) {
  if (!(await needsSetup())) redirect("/entrar");
  const { codigo } = await searchParams;
  return (
    <main className="mx-auto min-h-dvh max-w-xl px-4 py-8 sm:py-12">
      <h1 className="text-3xl font-extrabold tracking-tight">Alta del local</h1>
      <p className="mt-1 text-humo">Cinco minutos: el local, el salón y tu PIN de dueño. Lo demás (carta, equipo, insumos) lo completas después en el panel.</p>
      {setupConfigured() ? (
        <SetupWizard code={typeof codigo === "string" ? codigo : ""} />
      ) : (
        <div className="mt-6 rounded-3xl bg-papel p-5 ring-1 ring-linea">
          <p className="font-bold">Falta el código de instalación</p>
          <p className="mt-1 text-[15px]">
            Quien instala el sistema define la variable <code className="rounded bg-cal px-1">SETUP_TOKEN</code> (12 caracteres o más) en el servidor y vuelve a abrir esta página. Así nadie más puede dar de alta el local.
          </p>
        </div>
      )}
    </main>
  );
}
