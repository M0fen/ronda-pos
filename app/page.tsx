import { Check, MessageCircle } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { RoundTicket } from "@/components/landing/round-ticket";
import { btn } from "@/components/ui";

export const metadata: Metadata = {
  title: "Ronda · POS para cafés y bares",
  description: "Mesas, barra sin papel, factura electrónica, Bre-B y sellos para tus clientes, en la tablet que ya tienes. $189.900 al mes, sin porcentaje de tus ventas.",
};

const WHATSAPP = process.env.NEXT_PUBLIC_SALES_WHATSAPP ?? "573122143556";
const wa = (text: string) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;

const FEATURES = [
  {
    title: "El salón, en vivo",
    text: "Cada mesa dice si está ocupada, si pidió la cuenta o si hay algo listo para llevar. Y avisa cuándo ofrecer otra ronda.",
    shot: "/shots/salon.webp",
  },
  {
    title: "Barra y cocina sin papel",
    text: "Los pedidos llegan con su tiempo corriendo y un sonido. Un toque y el mesero ve que está listo. Sirve en una tablet o en un televisor con navegador.",
    shot: "/shots/barra.webp",
    dark: true,
  },
  {
    title: "Cobrar toma segundos",
    text: "Pregunta la propina como pide la ley, divide la cuenta, calcula las vueltas y recibe tarjeta, Nequi o Bre-B. Cada venta sale con factura electrónica.",
    shot: "/shots/cobro.webp",
  },
  {
    title: "La carta QR que vende",
    text: "El cliente pide desde la mesa, llama al mesero y paga su parte con Bre-B. El mesero aprueba y el pedido entra directo a la barra.",
    shot: "/shots/qr.webp",
    phone: true,
  },
  {
    title: "Inventario por trago y por gramo",
    text: "Una botella son 25 tragos; un espresso, 18 gramos de café. Se descuenta solo, te dice qué comprar y cuántos días te alcanza.",
    shot: "/shots/inventario.webp",
  },
  {
    title: "El dueño duerme tranquilo",
    text: "Anular lo enviado pide el PIN del encargado. La caja se cierra con arqueo ciego y el resumen del día te llega por WhatsApp.",
    shot: "/shots/panel.webp",
  },
];

const PLANS = [
  {
    name: "Café",
    price: "$119.900",
    for: "Mostrador y para llevar",
    items: ["Caja en tablet o celular", "Factura electrónica", "Carta QR", "Sellos para clientes", "Reportes del día", "Usuarios y equipos ilimitados"],
  },
  {
    name: "Bar",
    price: "$189.900",
    for: "Café bar y bares con mesas",
    items: ["Todo lo del plan Café", "Mesas y meseros en el celular", "Pantalla de barra y cocina", "Inventario con recetas por trago", "Happy hour automático", "Cuenta y pago desde la mesa", "Resumen del día por WhatsApp"],
    featured: true,
  },
  {
    name: "Grupo",
    price: "A convenir",
    for: "Varias sedes",
    items: ["Todo lo del plan Bar", "Varias sedes y bodegas", "Soporte prioritario"],
  },
];

const FAQ = [
  ["¿Tengo que comprar equipos?", "No. Funciona en la tablet o el celular que ya tienes. Si quieres imprimir, recomendamos una impresora térmica de 80 mm de red; te la cotizamos con un proveedor de Pereira y la puedes pagar en cuotas."],
  ["¿Qué pasa si se cae el internet?", "La app de la caja para Android, que se instala en tu local, sigue tomando pedidos, cobrando e imprimiendo sin conexión y sincroniza cuando vuelve. La factura electrónica queda en cola con el procedimiento de contingencia de la DIAN."],
  ["¿Emite factura electrónica?", "Sí, cada venta sale con factura electrónica a través de un proveedor autorizado. Si el cliente pide la factura a su nombre, se pone su NIT o cédula en el cobro."],
  ["¿Cómo funciona el pago con Bre-B?", "El cliente paga a la llave de tu negocio desde cualquier banco y la plata llega al instante. En la caja se registra con la referencia del pago."],
  ["¿Me cobran un porcentaje de lo que vendo?", "No. Pagas la mensualidad de tu plan y ya. La pantalla de cocina y el inventario no se cobran aparte."],
  ["¿De quién son los datos?", "Tuyos. Los exportas cuando quieras. Los datos de tus clientes se guardan con su autorización, como pide la Ley 1581."],
  ["¿Y si no me sirve?", "Pruebas 15 días con tu carta antes de pagar. Si en los primeros 30 días no te sirve, te devolvemos la implementación."],
];

export default function Landing() {
  return (
    <div className="bg-cal">
      <header className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-4 sm:px-6">
        <span className="text-2xl font-extrabold tracking-tight [font-stretch:122%]">ronda</span>
        <nav className="ml-auto hidden gap-6 text-[15px] font-semibold text-tinto-2 md:flex">
          <a href="#funciones" className="hover:text-tinto">
            Funciones
          </a>
          <a href="#precios" className="hover:text-tinto">
            Precios
          </a>
          <a href="#preguntas" className="hover:text-tinto">
            Preguntas
          </a>
        </nav>
        <Link href="/entrar" className={btn("dark", "md", "ml-auto md:ml-0")}>
          Probar la demo
        </Link>
      </header>

      <section className="mx-auto grid max-w-6xl gap-10 px-4 pt-8 pb-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:pt-14">
        <div>
          <h1 className="text-[clamp(2.6rem,7vw,4.8rem)] leading-[0.95] font-extrabold tracking-tight [font-stretch:115%]">Tu café bar en una tablet.</h1>
          <p className="mt-6 max-w-[34ch] text-xl leading-relaxed text-tinto-2">
            Mesas, barra sin papel, factura electrónica, Bre-B y sellos para tus clientes. En la tablet que ya tienes, por <b className="text-tinto">$189.900 al mes</b> y sin porcentaje de tus ventas.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/entrar" className={btn("primary", "xl")}>
              Probar la demo
            </Link>
            <a href={wa("Hola, quiero probar Ronda en mi local")} target="_blank" rel="noopener" className={btn("soft", "xl")}>
              <MessageCircle size={20} /> Escribir por WhatsApp
            </a>
          </div>
          <p className="mt-4 text-sm text-humo">La demo abre sin registro, con un café bar de ejemplo y el servicio en marcha.</p>
        </div>
        <div className="rounded-[32px] bg-[#e9ebe4] p-5 sm:p-7">
          <p className="mb-3 text-sm font-semibold text-tinto-2">Arma una ronda: toca los productos</p>
          <RoundTicket />
        </div>
      </section>

      <section id="funciones" className="border-t border-linea bg-papel">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="max-w-[20ch] text-4xl leading-tight font-extrabold tracking-tight [font-stretch:112%]">Lo que hace por ti en un turno</h2>
          <div className="mt-12 space-y-16">
            {FEATURES.map((f, i) => (
              <article key={f.title} className={`grid items-center gap-8 ${i % 2 ? "lg:grid-cols-[1.5fr_1fr] lg:[&>div:first-child]:order-2" : "lg:grid-cols-[1fr_1.5fr]"}`}>
                <div>
                  <h3 className="text-2xl font-bold [font-stretch:108%]">{f.title}</h3>
                  <p className="mt-3 max-w-[42ch] text-lg leading-relaxed text-tinto-2">{f.text}</p>
                </div>
                <div className={f.phone ? "flex justify-center rounded-[28px] bg-cal p-6" : ""}>
                  <Image
                    src={f.shot}
                    alt={f.title}
                    width={f.phone ? 390 : 1280}
                    height={f.phone ? 844 : 800}
                    className={f.phone ? "h-auto w-[260px] rounded-[28px] shadow-xl ring-1 ring-linea" : `h-auto w-full rounded-2xl shadow-xl ring-1 ${f.dark ? "ring-noche" : "ring-linea"}`}
                  />
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="precios" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-4xl font-extrabold tracking-tight [font-stretch:112%]">Precio claro, sin letra pequeña</h2>
        <p className="mt-3 max-w-[60ch] text-lg text-tinto-2">Mensualidad fija. No cobramos un porcentaje de tus ventas, ni la pantalla de cocina, ni el inventario aparte. Sin permanencia.</p>
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {PLANS.map((p) => (
            <article key={p.name} className={`flex flex-col rounded-[28px] p-6 ${p.featured ? "bg-tinto text-cal" : "bg-papel ring-1 ring-linea"}`}>
              <div className="flex items-baseline justify-between">
                <h3 className="text-2xl font-bold">{p.name}</h3>
                {p.featured ? <span className="rounded-full bg-fachada px-3 py-1 text-sm font-bold text-tinto">El de un café bar</span> : null}
              </div>
              <p className={`mt-1 ${p.featured ? "text-cal/75" : "text-humo"}`}>{p.for}</p>
              <p className="mt-6 text-4xl font-extrabold tnum [font-stretch:105%]">
                {p.price}
                {p.price.startsWith("$") ? <span className={`text-base font-semibold ${p.featured ? "text-cal/70" : "text-humo"}`}> al mes</span> : null}
              </p>
              <ul className="mt-6 flex-1 space-y-2.5">
                {p.items.map((it) => (
                  <li key={it} className="flex gap-2.5">
                    <Check size={18} className={`mt-0.5 shrink-0 ${p.featured ? "text-fachada" : "text-puerta"}`} /> {it}
                  </li>
                ))}
              </ul>
              <a href={wa(`Hola, me interesa el plan ${p.name} de Ronda`)} target="_blank" rel="noopener" className={`${btn(p.featured ? "warn" : "soft", "lg", "mt-8 w-full")}`}>
                {p.price.startsWith("$") ? "Quiero mi prueba" : "Hablemos"}
              </a>
            </article>
          ))}
        </div>
        <p className="mt-6 text-[15px] text-tinto-2">
          Implementación en tu local: $490.000 una sola vez, gratis si pagas el año. Con el pago anual te regalamos dos meses.
        </p>
      </section>

      <section className="border-y border-linea bg-papel">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.4fr]">
          <h2 className="text-4xl font-extrabold tracking-tight [font-stretch:112%]">Así empiezas</h2>
          <ol className="space-y-6">
            {[
              ["Mándanos la foto de tu carta", "Por WhatsApp. Con eso armamos tus productos, precios y categorías."],
              ["En 24 horas tienes tu prueba", "Con tu carta, tus mesas y tu equipo, lista para usar."],
              ["Pruébala 15 días", "En servicio real. Si algo no encaja con tu forma de trabajar, se ajusta."],
              ["La dejamos andando en tu local", "Configuramos la impresora, capacitamos al equipo y te acompañamos el primer viernes."],
            ].map(([t, d], i) => (
              <li key={t} className="grid grid-cols-[48px_1fr] gap-4">
                <span className="flex size-12 items-center justify-center rounded-full bg-balcon text-xl font-bold text-white tnum">{i + 1}</span>
                <span>
                  <span className="block text-xl font-bold">{t}</span>
                  <span className="mt-1 block text-lg text-tinto-2">{d}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="preguntas" className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h2 className="text-4xl font-extrabold tracking-tight [font-stretch:112%]">Preguntas</h2>
        <div className="mt-8 divide-y divide-linea">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-semibold">
                {q}
                <span className="text-2xl text-humo transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-2 text-[17px] leading-relaxed text-tinto-2">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="bg-tinto text-cal">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-4 py-14 sm:px-6">
          <h2 className="max-w-[18ch] text-4xl font-extrabold tracking-tight [font-stretch:112%]">Pruébala con un café bar de verdad.</h2>
          <div className="flex flex-wrap gap-3">
            <Link href="/entrar" className={btn("warn", "xl")}>
              Abrir la demo
            </Link>
            <a href={wa("Hola, quiero Ronda para mi local")} target="_blank" rel="noopener" className={btn("light", "xl")}>
              <MessageCircle size={20} /> WhatsApp
            </a>
          </div>
        </div>
        <p className="mx-auto max-w-6xl px-4 pb-8 text-sm text-cal/60 sm:px-6">Ronda · hecho en Pereira por PuntoNeutro.</p>
      </section>
    </div>
  );
}
