import Link from "next/link";
import { btn } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-bold">No encontramos esta página</h1>
      <p className="text-humo">El enlace está mal escrito o ya no existe. Si escaneaste el QR de una mesa, pídele ayuda al mesero.</p>
      <Link href="/" className={btn("soft", "lg")}>
        Ir al inicio
      </Link>
    </main>
  );
}
