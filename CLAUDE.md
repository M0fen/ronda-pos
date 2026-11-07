# CLAUDE.md

Guía para trabajar en Ronda con Claude Code. Lee también `AGENTS.md`: Next.js 16 cambió APIs; consulta `node_modules/next/dist/docs/` antes de usar algo que no conozcas.

## Qué es
Punto de venta para cafés, bares y restaurantes en Colombia (COP, impuesto al consumo, propina voluntaria, Bre-B, Nequi, costo de turnos) con portada de presentación en `/`. Textos en español de Colombia, tuteando, frases cortas. Se usa en tablets y celulares: botones grandes, nada que dependa del mouse.

## Comandos
- `npm run dev` → http://localhost:3000 (demo en `/entrar`; sede Circunvalar: Andrés 1234 dueño, Valentina 2222 caja, Juan Pablo 3333 y Camila 4444 meseros, Mateo 5555, Luisa 6666 y Sofía 7777 barra y cocina. Andrés entra en las cuatro sedes; los PIN de las otras se ven en `/entrar` al elegir la sede)
- `npm test` (vitest: `tests/`), `npm run typecheck`, `npm run build`
- Sin `DATABASE_URL` usa PGlite en `.data/` con la cadena de ejemplo (Sr. Patata, cuatro sedes, `lib/seed.ts`). Borra `.data` para reiniciar (o Panel → Ajustes → Reiniciar demo).

## Arquitectura
- Next.js 16 App Router, React 19, Tailwind 4 (tokens en `app/globals.css` con `@theme inline`). Todo dinámico (`force-dynamic` en el layout raíz).
- Rutas: `app/(pos)/` salón, cuenta, cobro, caja, domicilios y panel (con `PosNav`; `panel/rentabilidad` solo para dueño y administrador; `panel/cadena` solo para el dueño, `can.chain`); `app/barra` pantalla de barra y cocina; `app/pantalla` pantalla de turnos del mostrador (pública, sede por cookie o `?sede=`); `app/m/[token]` carta QR del cliente; `app/recibo/[id]` precuenta y factura; `app/r/[token]` factura pública del QR; `app/entrar` PIN y sede de la tablet.
- `proxy.ts` (antes "middleware") protege las rutas del equipo con la cookie `ronda_session` (JWT, `lib/session.ts`). Cada página y Server Action vuelve a verificar con `requireStaff()`; los permisos por rol están en `can` (`lib/server/auth.ts`).
- **No hay rutas `/api`.** En Vercel las páginas y las rutas `/api` son funciones distintas y en la demo en memoria cada una tendría su propia base. Todo lo que lee va en Server Components y todo lo que escribe va por Server Actions: `app/(pos)/actions.ts`, `app/(pos)/panel/actions.ts`, `app/m/actions.ts`, `app/entrar/actions.ts`. Devuelven `ActionResult`; los errores para el usuario son `UserError`.
- Datos: `lib/db-core.ts` (pg o PGlite, migraciones) → `lib/server/db.ts` (`getDb()`, siembra demo). SQL a mano con parámetros `$1`; no hay ORM. Cambios de esquema: migración nueva al final de `lib/schema.ts` (nunca edites una publicada).
- Reglas puras con pruebas en `lib/core/`: `pricing.ts` (impuesto incluido, propina, división, vueltas, sellos) y `time.ts` (hora de Bogotá, happy hour, jornada). Si cambias una regla, actualiza `tests/pricing.test.ts`.
- Marca: con `settings.theme.whiteLabel` el sistema entero lleva el nombre y los colores del local en lugar de Ronda. `getBrand()` (`lib/server/business.ts`) la lee sin fallar; el layout raíz pone `--brand-primary` y `--brand-accent` en `<html>` (los tokens `balcon` y `fachada` de `app/globals.css` salen de ahí), el título, el ícono con las iniciales y `noindex`. El ícono va por metadatos (`public/ronda-icon.svg` o el del local): no vuelvas a crear `app/icon.svg`, que tiene prioridad.
- Tiempo real: cada escritura llama `bump()` (tabla `pulse`); `components/live.tsx` consulta `pulseAction` y hace `router.refresh()` cuando cambia.
- Turnos y rentabilidad: `lib/core/labor.ts` (puro, con pruebas en `tests/labor.test.ts`) cuesta cada turno minuto a minuto: nocturno, dominical o festivo (festivos con Ley Emiliani y Pascua), extra por más de 9 h en el día o de la jornada semanal, carga prestacional y auxilio de transporte; también arma las alertas de jornada. Las cifras de ley van con fecha en `LABOR_CHANGES`: agrega una entrada cada enero (salario mínimo y auxilio) y revisa julio de 2027 (dominical al 100 %). `lib/server/labor.ts` marca entrada y salida con PIN (`clockToggle`, tabla `shifts`, sin abrir sesión) y arma `profitReport` (ventas netas por la hora de cierre de la cuenta, insumos por receta, equipo por minuto trabajado, todo por jornada y turno del local de `settings.labor.turnos`).
- Inventario: las rondas descuentan insumos según la receta (`moveStock()` en `lib/server/checks.ts`); compras, mermas y conteos con `stockMove()` (`lib/server/inventory.ts`). Todo movimiento queda en `stock_movements`.
- Anulaciones de lo enviado, cortesías y descuentos sobre el límite piden el PIN de quien tenga permiso: el error trae `fields.auth` y la pantalla abre `AuthSheet`. Todo queda en `audit_log`.
- Sedes: cada sede es una fila de `businesses` con el mismo `chain_id` y su nombre en `sede` (con su equipo, carta, caja, inventario y ajustes). La tablet guarda su sede en la cookie `ronda_sede` (`getDefaultBusiness()`, `chooseSedeAction`); al entrar con PIN queda la sede de esa persona. Cuentas y facturas se numeran por sede en `counters` con `nextNumber()`: no uses `check_number_seq` ni `invoice_number_seq` para nada nuevo. `chainReport()` (`lib/server/chain.ts`) arma la cadena con `profitReport` de cada sede, una a la vez.
- Domicilios: `checks.kind = 'domicilio'` con `channel` (`rappi`, `didi`, `propio`; lo demás es `local`) y `delivery` jsonb (código, celular, dirección, `packedAt`, `packedBy`, `riderAt`). Etapas y lista de empaque, puras, en `lib/core/delivery.ts` (pruebas en `tests/delivery.test.ts`); el servidor en `lib/server/delivery.ts`. La bolsa no se cierra sin la lista completa. Lo de la plataforma se paga con el método `plataforma` (no entra al cajón) al entregarlo al domiciliario; la comisión de cada canal está en `settings.channels` y rentabilidad la descuenta.
- Mostrador: si el salón solo tiene sillas de barra, se ve en modo mostrador (pedidos primero). En el mostrador se cobra antes de preparar: las cuentas `llevar` pagadas siguen en barra y cocina hasta que se entregan, y `counterOrders()` llena la pantalla de turnos.
- Demo en Vercel: sin base de datos, `isEphemeralDb()` carga en memoria `lib/generated/demo-schema.tar.gz` (lo genera `npm run build`) y siembra el ejemplo al arrancar (~3 s).

## Convenciones
- Pesos colombianos en enteros (`cop()` de `lib/money.ts`); los precios incluyen el impuesto y se separa base e impuesto por línea.
- Fechas y horas en America/Bogotá (UTC−5, sin horario de verano): `lib/core/time.ts` y `lib/format.ts`. Los reportes agrupan por **jornada**: lo cerrado antes de las 5:00 a. m. cuenta para el día anterior (`jornadaKey()`, `JORNADA_CUTOFF_HOUR`).
- Propina: voluntaria, se pregunta siempre y la sugerida no pasa del 10 % (Ley 1935 de 2018). No es salario: en rentabilidad va aparte.
- Ventas netas = sin impuesto ni propina (`invoices.subtotal`). El costo del equipo es una estimación para decidir turnos; la nómina la liquida el contador, y así se dice en pantalla.
- Clientes y mensajes: solo con autorización explícita (`consent_at`, Ley 1581).
- Celulares de 10 dígitos sin el 57 (`normalizePhone`).
- Componentes de cliente solo donde hay interacción. Nada que dependa de la hora del navegador en el primer render: pasa la hora del servidor (ver `serverNow` en la barra) o usa `suppressHydrationWarning` en el número.
- No guardes secretos en el código: todo va en variables de entorno (`.env.example`).

## Gotchas
- **PGlite tiene una sola conexión:** dentro de `db.tx(async (tx) => …)` usa siempre `tx`. Llamar `getDb().query` dentro de una transacción la bloquea para siempre (por eso `authorizeWithPin` y `authorizer` reciben `tx`).
- `server-only` revienta en scripts de Node: los scripts (`scripts/*.ts`) importan `lib/db-core.ts`, no `lib/server/*`.
- En modo demo no corras scripts con `npm run dev` encendido (PGlite es de un solo proceso).
- Accesos dinámicos a disco llevan `/*turbopackIgnore: true*/` para que el build no empaque todo el proyecto.
- Datos de la demo: todo lo que siembres lleva `stableId()` para que coincida entre instancias. Las sedes están en `DEMO_SEDES`; la principal (Circunvalar) conserva los ids de cuando la demo tenía un solo local (`keyOf()`), así que no cambies sus llaves.
- Las capturas de la portada (`public/shots/*.webp`) salen de la demo; si cambias pantallas, vuelve a tomarlas.
