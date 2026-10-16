import { cop } from "@/lib/money";
import { cn } from "@/lib/utils";

type Variant = "primary" | "send" | "danger" | "dark" | "soft" | "ghost" | "warn" | "light";
type Size = "sm" | "md" | "lg" | "xl";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-balcon text-white hover:bg-balcon-2 disabled:bg-balcon/40",
  send: "bg-puerta text-white hover:bg-puerta-2 disabled:bg-puerta/40",
  danger: "bg-cereza text-white hover:brightness-95 disabled:bg-cereza/40",
  dark: "bg-tinto text-cal hover:bg-tinto/90 disabled:bg-tinto/40",
  soft: "bg-papel text-tinto ring-1 ring-linea-2 hover:ring-tinto disabled:text-humo",
  ghost: "text-tinto hover:bg-tinto/5 disabled:text-humo",
  warn: "bg-fachada text-tinto hover:brightness-95",
  light: "bg-white/10 text-cal ring-1 ring-white/15 hover:bg-white/15",
};

const SIZES: Record<Size, string> = {
  sm: "h-10 px-3.5 text-sm gap-1.5 rounded-xl",
  md: "h-12 px-4 text-[15px] gap-2 rounded-xl",
  lg: "h-14 px-5 text-base gap-2 rounded-2xl",
  xl: "h-16 px-6 text-lg gap-2.5 rounded-2xl",
};

export function btn(variant: Variant = "soft", size: Size = "md", extra?: string) {
  return cn("inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-semibold transition-colors disabled:cursor-not-allowed", VARIANTS[variant], SIZES[size], extra);
}

export function Money({ value, className }: { value: number; className?: string }) {
  return <span className={cn("tnum whitespace-nowrap", className)}>{cop(value)}</span>;
}

export function Pill({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: "neutral" | "blue" | "green" | "red" | "yellow" | "dark"; className?: string }) {
  const tones = {
    neutral: "bg-tinto/6 text-tinto",
    blue: "bg-balcon-soft text-balcon-2",
    green: "bg-puerta-soft text-puerta-2",
    red: "bg-cereza-soft text-cereza",
    yellow: "bg-fachada-soft text-[#7a5600]",
    dark: "bg-tinto text-cal",
  } as const;
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[13px] font-semibold", tones[tone], className)}>{children}</span>;
}

export function Avatar({ name, color, size = 40 }: { name: string; color: string; size?: number }) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white" style={{ background: color, width: size, height: size, fontSize: size * 0.38 }} aria-hidden>
      {initials}
    </span>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-linea-2 px-5 py-8 text-center">
      <p className="font-semibold">{title}</p>
      {children ? <div className="mt-1 text-sm text-humo">{children}</div> : null}
    </div>
  );
}
