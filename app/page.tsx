import { MessageCircle } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { RoundTicket } from "@/components/landing/round-ticket";
import { btn } from "@/components/ui";
import { getBrand } from "@/lib/server/business";
import { cn } from "@/lib/utils";

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
    text: "Pregunta la propina como pide la ley, divide la cuenta, calcula las vueltas y recibe tarjeta, Nequi o Bre-B. Cada venta queda con su factura y su código QR.",
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
    text: "Una botella son 25 tragos; una bandeja para compartir, 600 gramos de papa. Se descuenta solo, te dice qué comprar y cuántos días te alcanza.",
    shot: "/shots/inventario.webp",
  },
  {
    title: "Sabes qué turno se paga solo",
    text: "Cada quien marca su entrada y su salida con su PIN. El sistema cruza lo que cuesta el equipo, con recargos nocturnos, dominicales y festivos, con lo que vende cada turno, y te avisa antes de que alguien pase de 42 horas.",
    shot: "/shots/rentabilidad.webp",
  },
  {
    title: "El dueño duerme tranquilo",
    text: "Anular lo enviado pide el PIN del encargado. La caja se cierra con arqueo ciego y el resumen del día te llega por WhatsApp.",
    shot: "/shots/panel.webp",
  },
];

const FAQ = [
  ["¿Tengo que comprar equipos?", "No. Funciona en la tablet o el celular que ya tienes. Si quieres imprimir la comanda y la factura, sirve una impresora térmica de 80 mm de red."],
  ["¿Qué pasa si se cae el internet?", "El sistema trabaja en línea. Si se cae el internet del local, la tablet puede seguir con los datos de un celular."],
  ["¿Emite factura electrónica?", "Sí, a través de un proveedor tecnológico autorizado por la DIAN, que se conecta cuando el sistema se instala en el local. Si el cliente pide la factura a su nombre, se pone su NIT o cédula en el cobro. En la demo la factura es de prueba: se numera y lleva su código QR, pero no se envía a la DIAN."],
  ["¿Cómo sabe lo que cuesta cada turno?", "Con el salario o el valor de la hora de cada persona y las horas que marca con su PIN. Suma los recargos nocturnos, dominicales y festivos de la ley vigente, la seguridad social y las prestaciones. Es una estimación para decidir turnos: la nómina la liquida tu contador."],
  ["¿Cómo funciona el pago con Bre-B?", "El cliente paga a la llave de tu negocio desde cualquier banco y la plata llega al instante. En la caja se registra con la referencia del pago."],
  ["¿De quién son los datos?", "Tuyos. Los datos de tus clientes se guardan solo con su autorización, como pide la Ley 1581."],
];

export default async function Landing() {
  // Con la marca del local (Ajustes → Marca), la portada es la de su propio sistema
  const brand = await getBrand();
  const wl = brand.whiteLabel;
  const open = wl ? "Abrir el sistema" : "Probar la demo";
  const hello = wl ? `Hola, vi la propuesta del sistema para ${brand.name}` : "Hola, quiero probar Ronda en mi local";
  return (
    <div className="bg-cal">
      <div className={wl ? "bg-balcon text-white" : ""}>
        <header className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-4 sm:px-6">
          <span className="text-2xl font-extrabold tracking-tight [font-stretch:122%]">{wl ? brand.name : "ronda"}</span>
          <nav className={cn("ml-auto hidden gap-6 text-[15px] font-semibold md:flex", wl ? "text-white/75" : "text-tinto-2")}>
            <a href="#funciones" className={wl ? "hover:text-white" : "hover:text-tinto"}>
              Funciones
            </a>
            <a href="#preguntas" className={wl ? "hover:text-white" : "hover:text-tinto"}>
              Preguntas
            </a>
          </nav>
          <Link href="/entrar" className={btn(wl ? "warn" : "dark", "md", "ml-auto md:ml-0")}>
            {open}
          </Link>
        </header>

        <section className="mx-auto grid max-w-6xl gap-10 px-4 pt-8 pb-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:pt-14">
          <div>
            <h1 className="text-[clamp(2.6rem,7vw,4.8rem)] leading-[0.95] font-extrabold tracking-tight [font-stretch:115%]">
              {wl ? (
                <>
                  {brand.name}, <span className="text-fachada">en una tablet.</span>
                </>
              ) : (
                "Tu local en una tablet."
              )}
            </h1>
            <p className={cn("mt-6 max-w-[34ch] text-xl leading-relaxed", wl ? "text-white/80" : "text-tinto-2")}>
              Mesas, barra y cocina sin papel, factura electrónica, Bre-B, sellos para tus clientes y lo que cuesta cada turno, en la tablet o el celular que ya tienes.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/entrar" className={btn(wl ? "warn" : "primary", "xl")}>
                {open}
              </Link>
              <a href={wa(hello)} target="_blank" rel="noopener" className={btn(wl ? "light" : "soft", "xl")}>
                <MessageCircle size={20} /> Escribir por WhatsApp
              </a>
            </div>
            <p className={cn("mt-4 text-sm", wl ? "text-white/60" : "text-humo")}>
              {wl ? `Con la carta de ${brand.name}, su equipo y el servicio en marcha. Los datos son de ejemplo.` : "La demo abre sin registro, con un local de ejemplo y el servicio en marcha."}
            </p>
          </div>
          <div className="rounded-[32px] bg-[#e9ebe4] p-5 text-tinto sm:p-7">
            <p className="mb-3 text-sm font-semibold text-tinto-2">Arma una ronda: toca los productos</p>
            <RoundTicket business={wl ? brand.name : "Tu local"} />
          </div>
        </section>
      </div>

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

      <section className={wl ? "bg-balcon text-white" : "bg-tinto text-cal"}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-4 py-14 sm:px-6">
          <h2 className="max-w-[18ch] text-4xl font-extrabold tracking-tight [font-stretch:112%]">{wl ? `Así se vive un turno en ${brand.name}.` : "Pruébala con la carta de un local de verdad."}</h2>
          <div className="flex flex-wrap gap-3">
            <Link href="/entrar" className={btn("warn", "xl")}>
              {wl ? open : "Abrir la demo"}
            </Link>
            <a href={wa(wl ? hello : "Hola, quiero Ronda para mi local")} target="_blank" rel="noopener" className={btn("light", "xl")}>
              <MessageCircle size={20} /> WhatsApp
            </a>
          </div>
        </div>
        <p className="mx-auto max-w-6xl px-4 pb-8 text-sm text-cal/60 sm:px-6">{wl ? `Sistema de ${brand.name}` : "Ronda"} · hecho en Pereira por PuntoNeutro.</p>
      </section>
    </div>
  );
}
