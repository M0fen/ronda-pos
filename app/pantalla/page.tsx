import type { Metadata } from "next";
import { AutoRefresh } from "@/components/auto-refresh";
import { getBusiness, getDefaultBusiness } from "@/lib/server/business";
import { counterOrders } from "@/lib/server/delivery";

export const metadata: Metadata = { title: "Pantalla de turnos" };

/** Para un televisor en el mostrador: el cliente ve su número y su nombre cuando el pedido está listo. */
export default async function TurnosPage({ searchParams }: { searchParams: Promise<{ sede?: string }> }) {
  const { sede } = await searchParams;
  const biz = sede && /^[0-9a-f-]{36}$/i.test(sede) ? await getBusiness(sede).catch(() => getDefaultBusiness()) : await getDefaultBusiness();
  const { preparing, ready } = await counterOrders(biz.id);
  return (
    <main className="flex min-h-dvh flex-col bg-balcon p-6 text-white sm:p-10">
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <p className="text-[clamp(1.75rem,3vw,3rem)] font-extrabold tracking-tight [font-stretch:118%]">
          {biz.name}
          {biz.sede ? <span className="text-white/55"> · {biz.sede}</span> : null}
        </p>
        <p className="text-[clamp(1rem,1.6vw,1.75rem)] text-white/60">Pedidos para llevar</p>
      </header>
      <div className="mt-8 grid flex-1 gap-8 md:grid-cols-[2fr_3fr]">
        <section>
          <h1 className="text-[clamp(1.5rem,2.4vw,2.5rem)] font-bold text-white/70">Preparando</h1>
          <ul className="mt-4 grid gap-3">
            {preparing.map((o) => (
              <li key={o.number} className="flex items-baseline gap-4 rounded-2xl bg-white/8 px-6 py-4">
                <span className="text-[clamp(2.75rem,5vw,5.5rem)] font-extrabold leading-none tnum">{o.number}</span>
                <span className="truncate text-[clamp(1.25rem,2.2vw,2.25rem)] text-white/75">{o.name}</span>
              </li>
            ))}
            {!preparing.length ? <li className="text-xl text-white/45">Nada en preparación</li> : null}
          </ul>
        </section>
        <section>
          <h2 className="text-[clamp(1.5rem,2.4vw,2.5rem)] font-bold text-fachada">¡Listo! Pasa por tu pedido</h2>
          <ul className="mt-4 grid gap-3">
            {ready.map((o) => (
              <li key={o.number} className="flex items-baseline gap-5 rounded-3xl bg-fachada px-7 py-6 text-tinto">
                <span className="text-[clamp(3.5rem,7.5vw,8.5rem)] font-extrabold leading-none tnum">{o.number}</span>
                <span className="truncate text-[clamp(1.5rem,3vw,3.25rem)] font-bold">{o.name}</span>
              </li>
            ))}
            {!ready.length ? <li className="text-xl text-white/45">Aquí sale tu número cuando esté listo</li> : null}
          </ul>
        </section>
      </div>
      <AutoRefresh bizId={biz.id} />
    </main>
  );
}
