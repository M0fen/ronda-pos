"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Una captura: la ruta del archivo (con su huella) y su tamaño real. */
export interface Shot {
  src: string;
  width: number;
  height: number;
}

export interface ShiftStep {
  time: string;
  title: string;
  text: string;
  shot: Shot;
  /** Captura de celular (la carta QR): sale en un teléfono al lado de la tablet */
  phone?: boolean;
  /** Lo que muestra la tablet mientras el celular está al frente */
  tablet?: Shot;
}

/*
 * El ancho con que se pinta cada captura, para que cada pantalla baje el archivo de su tamaño y no el original.
 * Salen de las medidas de la página: si cambias los márgenes o las columnas del recorrido, cámbialos aquí también.
 * Lo que no se ve en un tamaño (la tablet fija en el celular, las capturas sueltas en el computador) no se baja.
 */
const SIZES = {
  /** Debajo de cada hora, en celular y tablet vertical: el ancho de la página menos los márgenes y la línea del turno */
  inline: "(min-width: 1024px) 1px, (min-width: 640px) calc(100vw - 96px), calc(100vw - 80px)",
  /** El celular de la carta QR debajo de su hora */
  inlinePhone: "(min-width: 1024px) 1px, 230px",
  /** La pantalla de la tablet fija: 7 de las 12 columnas, menos el marco */
  tablet: "(max-width: 1023px) 1px, (min-width: 1200px) 581px, calc(58.33vw - 91px)",
  /** El celular que sale al frente de la tablet */
  phone: "(max-width: 1023px) 1px, 174px",
};

/**
 * Un turno de principio a fin. En computador, la tablet se queda quieta a la derecha y cambia de pantalla
 * según la hora del turno que se está leyendo; la línea amarilla avanza con el turno. En el celular, cada
 * hora trae su captura debajo.
 */
export function ShiftTour({ steps, business }: { steps: ShiftStep[]; business: string }) {
  const [active, setActive] = useState(0);
  const items = useRef<(HTMLLIElement | null)[]>([]);
  useEffect(() => {
    // La hora que se está leyendo es la última que ya subió hasta la mitad de la pantalla. Se mira dónde quedó
    // cada una, no cuál cruzó: así también acierta cuando se llega de un salto (un enlace del menú, volver arriba).
    const pick = () => {
      const line = window.innerHeight * 0.55;
      let current = 0;
      items.current.forEach((el, i) => {
        if (el && el.getBoundingClientRect().top <= line) current = i;
      });
      setActive(current);
    };
    const io = new IntersectionObserver(pick, { rootMargin: "-45% 0px -45% 0px" });
    for (const el of items.current) if (el) io.observe(el);
    return () => io.disconnect();
  }, []);
  const step = steps[active]!;
  const tabletOf = (s: ShiftStep) => (s.phone ? (s.tablet ?? steps[0]!.shot) : s.shot);
  const tabletShot = tabletOf(step).src;
  const tablets = [...new Set(steps.map((s) => tabletOf(s).src))];
  const phones = steps.filter((s) => s.phone);

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
      <ol className="relative">
        {/* La línea del turno: gris de fondo y amarilla hasta la hora que se está leyendo */}
        <span aria-hidden className="absolute top-3 bottom-3 left-[11px] w-[3px] rounded-full bg-linea" />
        <span
          aria-hidden
          className="absolute top-3 bottom-3 left-[11px] hidden w-[3px] origin-top rounded-full bg-fachada transition-transform duration-500 ease-out lg:block"
          style={{ transform: `scaleY(${(active + 0.5) / steps.length})` }}
        />
        {steps.map((s, i) => (
          <li
            key={s.title}
            ref={(el) => {
              items.current[i] = el;
            }}
            data-i={i}
            className={cn("relative py-7 pl-12 transition-opacity duration-300 lg:flex lg:min-h-[62vh] lg:flex-col lg:justify-center lg:py-0", i !== active && "lg:opacity-35")}
          >
            <div className="relative">
              {/* El punto de la hora, a la altura de la hora */}
              <span
                aria-hidden
                className={cn(
                  "absolute top-0 -left-12 size-[25px] rounded-full border-[3px] transition-colors duration-300",
                  i <= active ? "border-fachada bg-fachada" : "border-linea-2 bg-cal",
                  i === active && "lg:ring-[6px] lg:ring-fachada/25",
                )}
              />
              <time className="block text-[15px] leading-[25px] font-semibold text-tinto-2 tnum">{s.time}</time>
              <h3 className="mt-1 text-[clamp(1.6rem,2.6vw,2.1rem)] leading-[1.08] font-extrabold tracking-tight text-balance [font-stretch:112%]">{s.title}</h3>
              <p className="mt-3 max-w-[44ch] text-lg leading-relaxed text-tinto-2">{s.text}</p>
            </div>
            {/* En el celular y la tablet vertical, la captura va aquí mismo */}
            <div className="mt-5 lg:hidden">
              {s.phone ? (
                <Image src={s.shot.src} alt={s.title} width={s.shot.width} height={s.shot.height} sizes={SIZES.inlinePhone} className="mx-auto h-auto w-[230px] rounded-[30px] shadow-xl ring-[7px] ring-noche" />
              ) : (
                <Image src={s.shot.src} alt={s.title} width={s.shot.width} height={s.shot.height} sizes={SIZES.inline} className="h-auto w-full rounded-2xl bg-papel shadow-lg ring-1 ring-linea" />
              )}
            </div>
          </li>
        ))}
      </ol>

      <div className="hidden lg:block">
        <div className="sticky top-[max(6rem,calc(50vh-17rem))] pb-16">
          <div className="relative">
            {/* La tablet del local */}
            <div className="rounded-[30px] bg-noche p-[13px] shadow-[0_50px_90px_-40px_rgba(23,19,16,0.6)]">
              <div className="relative aspect-[16/10] overflow-hidden rounded-[18px] bg-cal">
                {tablets.map((src) => (
                  <Image
                    key={src}
                    src={src}
                    alt={src === tabletShot ? step.title : ""}
                    aria-hidden={src !== tabletShot}
                    fill
                    sizes={SIZES.tablet}
                    className={cn(
                      "object-cover object-top transition-[opacity,transform] duration-500 ease-out",
                      src === tabletShot ? "scale-100 opacity-100" : "opacity-0 motion-safe:scale-[1.015]",
                    )}
                  />
                ))}
              </div>
            </div>
            {/* El celular del cliente, solo en la hora de la carta QR. Con poco margen (tablet acostada) se queda dentro de la página */}
            {phones.map((p) => (
              <div
                key={p.shot.src}
                aria-hidden={p !== step}
                className={cn(
                  "absolute right-1 -bottom-14 w-[31%] rounded-[34px] bg-noche p-[7px] shadow-[0_40px_70px_-30px_rgba(23,19,16,0.7)] transition-[opacity,transform] duration-500 ease-out xl:-right-6",
                  p === step ? "rotate-[4deg] opacity-100" : "pointer-events-none opacity-0 motion-safe:translate-y-10 motion-safe:rotate-[8deg]",
                )}
              >
                <Image src={p.shot.src} alt={p === step ? p.title : ""} width={p.shot.width} height={p.shot.height} sizes={SIZES.phone} className="h-auto w-full rounded-[28px]" />
              </div>
            ))}
          </div>
          <p className="mt-6 text-[15px] text-humo">
            {business} a las <span className="font-semibold text-tinto tnum">{step.time}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
