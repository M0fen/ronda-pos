import { MessageCircle } from "lucide-react";
import type { Viewport } from "next";
import type { StaticImageData } from "next/image";
import Link from "next/link";
import { RoundTicket } from "@/components/landing/round-ticket";
import { type ShiftStep, ShiftTour } from "@/components/landing/shift-tour";
import { btn } from "@/components/ui";
import { getBrand } from "@/lib/server/business";
import { cn } from "@/lib/utils";
import barra from "@/public/shots/barra.webp";
import cadena from "@/public/shots/cadena.webp";
import cobro from "@/public/shots/cobro.webp";
import domicilios from "@/public/shots/domicilios.webp";
import inventario from "@/public/shots/inventario.webp";
import panel from "@/public/shots/panel.webp";
import qr from "@/public/shots/qr.webp";
import rentabilidad from "@/public/shots/rentabilidad.webp";
import salon from "@/public/shots/salon.webp";

const WHATSAPP = process.env.NEXT_PUBLIC_SALES_WHATSAPP ?? "573122143556";
const wa = (text: string) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;

/** La hora en que cada cosa pasa en un turno de noche (con espacios que no se parten). */
const at = (time: string, half: "a" | "p") => `${time}\u00a0${half}.\u00a0m.`;

/** Un nombre corto no se parte entre dos líneas; uno largo sí, o no cabría en el celular. */
const whole = (name: string) => (name.length <= 11 ? name.replace(/ /g, "\u00a0") : name);

/**
 * Cuántas letras tiene un texto y cuántas su palabra más larga. Con eso `.brand-fit` y `.hero-title` (`app/globals.css`)
 * bajan la letra lo justo para que el nombre de cualquier local quepa sin cortarse.
 */
const fit = (text: string) => ({ "--name": text.length, "--word": Math.max(...text.split(/\s+/).map((w) => w.length)) }) as React.CSSProperties;

/** Una captura de la portada: importada, sale con su huella en el nombre y cada pantalla baja el tamaño que le toca. */
const shot = ({ src, width, height }: StaticImageData) => ({ src, width, height });

const STEPS: ShiftStep[] = [
  {
    time: at("5:00", "p"),
    title: "El salón, en vivo",
    text: "Cada mesa dice si pidió la cuenta, si hay algo listo para llevar o si es hora de otra ronda. Las cuentas se separan, se unen o cambian de mesa en dos toques.",
    shot: shot(salon),
  },
  {
    time: at("6:30", "p"),
    title: "Barra y cocina sin papel",
    text: "Los pedidos llegan con su tiempo y un sonido por estación. Las alergias salen en rojo, lo anulado avisa hasta que alguien lo ve y cada plato trae la ficha con los gramos de la receta. En el mostrador, una pantalla de turnos llama a cada cliente por su número.",
    shot: shot(barra),
  },
  {
    time: at("7:15", "p"),
    title: "La carta QR que vende",
    text: "El cliente pide desde la mesa, llama al mesero y paga su parte con Bre-B. El mesero lo ve en el salón, aprueba y el pedido entra directo a la barra.",
    shot: shot(qr),
    phone: true,
    tablet: shot(salon),
  },
  {
    time: at("8:20", "p"),
    title: "Rappi y domicilios, sin errores en la bolsa",
    text: "Rappi y el domicilio propio en un solo tablero, de que entran a que salen. La cocina ve en cuánto llega el domiciliario y ninguna bolsa se cierra sin revisar la lista: cada producto con sus salsas, los cubiertos y la comanda.",
    shot: shot(domicilios),
  },
  {
    time: at("9:40", "p"),
    title: "Cobrar toma segundos",
    text: "Pregunta la propina como pide la ley, divide la cuenta, calcula las vueltas y recibe tarjeta, Nequi o Bre-B. Cada venta queda con su factura y su código QR.",
    shot: shot(cobro),
  },
  {
    time: at("11:30", "p"),
    title: "Inventario por trago y por gramo",
    text: "Una botella son 25 tragos; una bandeja para compartir, 600 gramos de papa. Se descuenta solo con cada venta, te dice qué comprar y cuántos días te alcanza.",
    shot: shot(inventario),
  },
  {
    time: at("12:10", "a"),
    title: "Sabes qué turno se paga solo",
    text: "Cada quien marca su entrada y su salida con su PIN. El sistema cruza lo que cuesta el equipo, con recargos nocturnos, dominicales y festivos, con lo que vende cada turno, y te avisa antes de que alguien pase de 42 horas.",
    shot: shot(rentabilidad),
  },
  {
    time: at("12:45", "a"),
    title: "Todas las sedes en una pantalla",
    text: "Ventas, insumos, equipo y comisiones de Rappi de cada sede, lado a lado: cuál deja más, cuál hay que revisar y qué hay que comprar en cada una. Cada sede tiene su equipo, su caja y su propia numeración de facturas.",
    shot: shot(cadena),
  },
  {
    time: at("1:15", "a"),
    title: "El dueño duerme tranquilo",
    text: "Anular lo enviado, una cortesía o un descuento grande los autoriza otra persona con su PIN, y todo queda con nombre y motivo. La caja se cierra con arqueo a ciegas y el resumen del día sale listo para mandarlo por WhatsApp.",
    shot: shot(panel),
  },
];

const FAQ = [
  ["¿Tengo que comprar equipos?", "No. Funciona en la tablet o el celular que ya tienes. La pre-cuenta, la factura y los QR se imprimen desde la tablet en una impresora térmica de 80 mm; la comanda de cocina se ve en la pantalla de barra y cocina."],
  ["¿Qué pasa si se cae el internet?", "El sistema trabaja en línea. Si se cae el internet del local, la tablet puede seguir con los datos de un celular."],
  ["¿Emite factura electrónica?", "Sí, a través de un proveedor tecnológico autorizado por la DIAN, que se conecta cuando el sistema se instala en el local. Si el cliente pide la factura a su nombre, se pone su NIT o cédula en el cobro. En la demo la factura es de prueba: se numera y lleva su código QR, pero no se envía a la DIAN."],
  ["¿Cómo sabe lo que cuesta cada turno?", "Con el salario o el valor de la hora de cada persona y las horas que marca con su PIN. Suma los recargos nocturnos, dominicales y festivos de la ley vigente, la seguridad social y las prestaciones. Es una estimación para decidir turnos: la nómina la liquida tu contador."],
  ["¿Sirve para varias sedes?", "Sí. Cada sede trabaja con su equipo, su caja, su inventario y su numeración de facturas, y el dueño las ve todas juntas en la pantalla de la cadena. La tablet de cada sede muestra solo a su equipo al entrar."],
  ["¿Se conecta con Rappi?", "Hoy el pedido de Rappi se pasa al tablero de domicilios en segundos, con su código y los minutos del domiciliario, y de ahí sigue como cualquier pedido: cocina, lista de empaque y factura. La conexión directa, para que los pedidos entren solos, se hace con la API de aliados de Rappi o con un integrador, y Rappi tiene que aprobarla."],
  ["¿Cómo funciona el pago con Bre-B?", "El cliente paga a la llave de tu negocio desde cualquier banco y la plata llega al instante. En la caja se registra con la referencia del pago."],
  ["¿De quién son los datos?", "Tuyos. Los datos de tus clientes se guardan solo con su autorización, como pide la Ley 1581."],
];

/** En el celular, la barra del navegador toma el color del encabezado: con la marca del local, el suyo. */
export async function generateViewport(): Promise<Viewport> {
  const brand = await getBrand();
  return brand.whiteLabel ? { themeColor: brand.primary } : {};
}

export default async function Landing() {
  // Con la marca del local (Ajustes → Marca), la portada es la de su propio sistema
  const brand = await getBrand();
  const wl = brand.whiteLabel;
  const open = wl ? "Abrir el sistema" : "Probar la demo";
  const hello = wl ? `Hola, vi la propuesta del sistema para ${brand.name}` : "Hola, quiero probar Ronda en mi local";
  const logo = wl ? brand.name : "ronda";
  const headline = wl ? [`${brand.name},`, "en una tablet."] : ["Tu local", "en una tablet."];
  return (
    <div className="overflow-x-clip bg-cal">
      <header className={cn("sticky top-0 z-40 backdrop-blur-md", wl ? "bg-balcon/92 text-white" : "border-b border-linea/70 bg-cal/90")}>
        <div className="px-page mx-auto flex max-w-6xl items-center gap-3 py-3.5 short:py-1.5 sm:gap-4">
          {/* El nombre ocupa lo que dejan el menú y el botón, y ajusta su letra a ese espacio */}
          <div className="@container min-w-0 flex-1">
            <span className="brand-fit block leading-[1.05] font-extrabold tracking-tight text-balance break-words [font-stretch:122%]" style={fit(logo)}>
              {logo}
            </span>
          </div>
          <nav className={cn("hidden gap-6 text-[15px] font-semibold md:flex", wl ? "text-white/75" : "text-tinto-2")}>
            <a href="#turno" className={cn("py-3", wl ? "hover:text-white" : "hover:text-tinto")}>
              Un turno
            </a>
            <a href="#preguntas" className={cn("py-3", wl ? "hover:text-white" : "hover:text-tinto")}>
              Preguntas
            </a>
          </nav>
          <Link href="/entrar" className={btn(wl ? "warn" : "dark", "md")}>
            {open}
          </Link>
        </div>
      </header>
      <div className={wl ? "bg-balcon text-white" : ""}>
        <section className="px-page mx-auto grid max-w-6xl gap-10 pt-8 pb-16 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:pt-14">
          <div className="@container min-w-0">
            <h1 className={cn("hero-title leading-[0.92] font-black tracking-tight break-words [font-stretch:118%]", wl && "text-fachada")} style={fit(headline[0]!)}>
              {headline.map((line, i) => (
                <span key={line} className="rise-line block overflow-hidden pb-[0.06em]" style={{ "--i": i } as React.CSSProperties}>
                  <span>{line}</span>
                </span>
              ))}
            </h1>
            <p className={cn("mt-6 max-w-[34ch] text-xl leading-relaxed", wl ? "text-white/80" : "text-tinto-2")}>
              Mesas, barra y cocina sin papel, domicilios de Rappi, factura electrónica, Bre-B, lo que cuesta cada turno y todas las sedes en una pantalla, en la tablet o el celular que ya tienes.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
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
          <div className={cn("min-w-0 rounded-[34px] bg-[#ecebe5] p-5 text-tinto sm:p-7", wl ? "ring-[10px] ring-white/[0.07]" : "ring-1 ring-linea")}>
            <p className="mb-3 text-sm font-semibold text-tinto-2">Arma una ronda: toca los productos</p>
            <RoundTicket business={wl ? brand.name : "Tu local"} />
          </div>
        </section>
      </div>

      <section id="turno" className="scroll-mt-16 border-t border-linea bg-cal">
        <div className="px-page mx-auto max-w-6xl pt-16 pb-8 lg:pt-24">
          <h2 className="max-w-[16ch] text-[clamp(2.2rem,4.6vw,3.6rem)] leading-[0.98] font-black tracking-tight break-words [font-stretch:118%]">{`Un turno en ${whole(wl ? brand.name : "tu local")}`}</h2>
          <p className="mt-4 max-w-[46ch] text-xl leading-relaxed text-tinto-2">De la primera mesa al resumen que le llega al dueño, sin papel y sin cuadernos.</p>
          <div className="mt-10 lg:mt-4">
            <ShiftTour steps={STEPS} business={wl ? brand.name : "Tu local"} />
          </div>
        </div>
      </section>

      <section id="preguntas" className="px-page mx-auto max-w-3xl scroll-mt-16 py-16">
        <h2 className="text-4xl font-extrabold tracking-tight [font-stretch:112%]">Preguntas</h2>
        <div className="mt-8 divide-y divide-linea">
          {FAQ.map(([q, a]) => (
            <details key={q} className="faq group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-lg font-semibold [&::-webkit-details-marker]:hidden">
                {q}
                <span aria-hidden className="text-2xl text-humo transition-transform duration-300 group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="-mt-2 pb-4 text-[17px] leading-relaxed text-tinto-2">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className={wl ? "bg-balcon text-white" : "bg-tinto text-cal"}>
        <div className="px-page mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 py-14">
          <h2 className="max-w-[18ch] min-w-0 text-4xl font-extrabold tracking-tight text-balance break-words [font-stretch:112%]">{wl ? `Así se vive un turno en ${whole(brand.name)}.` : "Pruébala con la carta de un local de verdad."}</h2>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Link href="/entrar" className={btn("warn", "xl")}>
              {wl ? open : "Abrir la demo"}
            </Link>
            <a href={wa(wl ? hello : "Hola, quiero Ronda para mi local")} target="_blank" rel="noopener" className={btn("light", "xl")}>
              <MessageCircle size={20} /> WhatsApp
            </a>
          </div>
        </div>
        <p className="px-page mx-auto max-w-6xl pb-8 text-sm text-cal/60">{wl ? `Sistema de ${brand.name}, hecho en Pereira por PuntoNeutro.` : "Ronda, hecha en Pereira por PuntoNeutro."}</p>
      </section>
    </div>
  );
}
