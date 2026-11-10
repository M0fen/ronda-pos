/**
 * Cuándo se vuelve a sembrar la demo en memoria (la de Vercel sin base de datos). Puro, con pruebas en tests/demo.test.ts.
 *
 * Se resiembra cuando los datos ya están viejos (más de 2 horas, o cambió la jornada) y nadie la está usando.
 * "Usarla" es escribir algo en los últimos 15 minutos o tener abierta una pantalla del equipo: su pulso, con sesión
 * válida, cuenta como uso para que una mesa abierta no desaparezca a mitad de una presentación mientras se habla.
 * Una pantalla sigue contando 45 minutos después de su último pulso (la tablet se durmió) y deja de contar si nadie
 * escribe nada en 3 horas (una pestaña olvidada no deja la demo con datos viejos para siempre).
 */
export const DEMO_MAX_AGE = 2 * 3_600_000;
export const DEMO_IDLE = 15 * 60_000;
export const DEMO_SCREEN_IDLE = 45 * 60_000;
export const DEMO_SCREEN_HOLD = 3 * 3_600_000;

export interface DemoClock {
  /** Cuándo se sembró (milisegundos) y en qué jornada */
  at: number;
  jornada: string;
  /** Última escritura (cada bump) */
  lastWrite: number;
  /** Último pulso de una pantalla del equipo con sesión válida */
  lastSeen: number;
}

export function demoShouldReseed(s: DemoClock, now: number, jornada: string) {
  const stale = now - s.at > DEMO_MAX_AGE || jornada !== s.jornada;
  if (!stale) return false;
  if (now - s.lastWrite < DEMO_IDLE) return false;
  const watched = now - s.lastSeen < DEMO_SCREEN_IDLE && now - s.lastWrite < DEMO_SCREEN_HOLD;
  return !watched;
}
