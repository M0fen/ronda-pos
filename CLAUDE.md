# CLAUDE.md

Guía para trabajar en Ronda con Claude Code. Lee también `AGENTS.md`: Next.js 16 cambió APIs; consulta `node_modules/next/dist/docs/` antes de usar algo que no conozcas.

## Qué es
Punto de venta para cafés y bares en Colombia (COP, impuesto al consumo, propina voluntaria, Bre-B, Nequi) con portada de venta en `/`. Textos en español de Colombia, tuteando, frases cortas. Se usa en tablets y celulares: botones grandes, nada que dependa del mouse.

## Comandos
- `npm run dev` → http://localhost:3000 (demo en `/entrar`; PINs: Andrés 1234 dueño, Valentina 2222 caja, Juan Pablo 3333 y Camila 4444 meseros, Mateo 5555 barra)
- `npm test` (vitest: `tests/`), `npm run typecheck`, `npm run build`
- Sin `DATABASE_URL` usa PGlite en `.data/` con el café bar de ejemplo. Borra `.data` para reiniciar (o Panel → Ajustes → Reiniciar demo).

## Arquitectura
- Next.js 16 App Router, React 19, Tailwind 4 (tokens en `app/globals.css` con `@theme inline`). Todo dinámico (`force-dynamic` en el layout raíz).
- Rutas: `app/(pos)/` salón, cuenta, cobro, caja y panel (con `PosNav`); `app/barra` pantalla de barra y cocina; `app/m/[token]` carta QR del cliente; `app/recibo/[id]` precuenta y factura; `app/r/[token]` factura pública del QR; `app/entrar` PIN.
- `proxy.ts` (antes "middleware") protege las rutas del equipo con la cookie `ronda_session` (JWT, `lib/session.ts`). Cada página y Server Action vuelve a verificar con `requireStaff()`; los permisos por rol están en `can` (`lib/server/auth.ts`).
- **No hay rutas `/api`.** En Vercel las páginas y las rutas `/api` son funciones distintas y en la demo en memoria cada una tendría su propia base. Todo lo que lee va en Server Components y todo lo que escribe va por Server Actions: `app/(pos)/actions.ts`, `app/(pos)/panel/actions.ts`, `app/m/actions.ts`, `app/entrar/actions.ts`. Devuelven `ActionResult`; los errores para el usuario son `UserError`.
- Datos: `lib/db-core.ts` (pg o PGlite, migraciones) → `lib/server/db.ts` (`getDb()`, siembra demo). SQL a mano con parámetros `$1`; no hay ORM. Cambios de esquema: migración nueva al final de `lib/schema.ts` (nunca edites una publicada).
- Reglas puras con pruebas en `lib/core/`: `pricing.ts` (impuesto incluido, propina, división, vueltas, sellos) y `time.ts` (hora de Bogotá, happy hour, jornada). Si cambias una regla, actualiza `tests/pricing.test.ts`.
- Tiempo real: cada escritura llama `bump()` (tabla `pulse`); `components/live.tsx` consulta `pulseAction` y hace `router.refresh()` cuando cambia.
- Inventario: las rondas descuentan insumos según la receta (`moveStock()` en `lib/server/checks.ts`); compras, mermas y conteos con `stockMove()` (`lib/server/inventory.ts`). Todo movimiento queda en `stock_movements`.
- Anulaciones de lo enviado, cortesías y descuentos sobre el límite piden el PIN de quien tenga permiso: el error trae `fields.auth` y la pantalla abre `AuthSheet`. Todo queda en `audit_log`.
- Demo en Vercel: sin base de datos, `isEphemeralDb()` carga en memoria `lib/generated/demo-schema.tar.gz` (lo genera `npm run build`) y siembra el ejemplo al arrancar (~3 s).

## Convenciones
- Pesos colombianos en enteros (`cop()` de `lib/money.ts`); los precios incluyen el impuesto y se separa base e impuesto por línea.
- Fechas y horas en America/Bogotá (UTC−5, sin horario de verano): `lib/core/time.ts` y `lib/format.ts`. Los reportes agrupan por **jornada**: lo cerrado antes de las 5:00 a. m. cuenta para el día anterior (`jornadaKey()`, `JORNADA_CUTOFF_HOUR`).
- Propina: voluntaria, se pregunta siempre y la sugerida no pasa del 10 % (Ley 1935 de 2018).
- Clientes y mensajes: solo con autorización explícita (`consent_at`, Ley 1581).
- Celulares de 10 dígitos sin el 57 (`normalizePhone`).
- Componentes de cliente solo donde hay interacción. Nada que dependa de la hora del navegador en el primer render: pasa la hora del servidor (ver `serverNow` en la barra) o usa `suppressHydrationWarning` en el número.
- No guardes secretos en el código: todo va en variables de entorno (`.env.example`).

## Gotchas
- **PGlite tiene una sola conexión:** dentro de `db.tx(async (tx) => …)` usa siempre `tx`. Llamar `getDb().query` dentro de una transacción la bloquea para siempre (por eso `authorizeWithPin` y `authorizer` reciben `tx`).
- `server-only` revienta en scripts de Node: los scripts (`scripts/*.ts`) importan `lib/db-core.ts`, no `lib/server/*`.
- En modo demo no corras scripts con `npm run dev` encendido (PGlite es de un solo proceso).
- Accesos dinámicos a disco llevan `/*turbopackIgnore: true*/` para que el build no empaque todo el proyecto.
- Datos de la demo: todo lo que siembres lleva `stableId()` para que coincida entre instancias.
- Las capturas de la portada (`public/shots/*.webp`) salen de la demo; si cambias pantallas, vuelve a tomarlas.
