# Bitácora de la noche · 8 al 10 de noviembre de 2026

Misión: llevar a Ronda de demo fuerte a compra segura para Sr. Patata (cuatro sedes) y dejarla como producto comercial para restobares del Eje Cafetero.

El diagnóstico (decisiones por frente, arreglos confirmados, competencia verificada y ley con fuentes) está en [`DIAGNOSTICO_NOCHE.md`](DIAGNOSTICO_NOCHE.md). Como el repositorio es público, la versión completa queda solo en el computador de Carlos: `.noche/DIAGNOSTICO_COMPLETO.md` (carpeta fuera de git).

## Cómo está organizado el trabajo

- **Base:** `main` (trae los PR #3, #5, #6 y #7). Nunca se fusiona a `main` desde esta sesión: la demo pública (ronda-pos-fegn.vercel.app) sigue intacta.
- **Pila de ramas.** Cada rama parte de la anterior y cada una tiene su PR **hacia `main`**. Hay que fusionarlas en este orden; mientras la de abajo no entre, el PR de arriba muestra también sus cambios (cada descripción trae el enlace para ver solo lo propio):
  1. `noche/exportar-contador` (PR #4): Panel → Contador.
  2. `noche/arreglos-plata`: plata, concurrencia y operación (migración v6).
  3. `noche/factura-electronica`: documento POS electrónico y factura con capa de proveedor y simulador (migración v7).
  4. `noche/impresion-termica`: ESC/POS directo a la térmica.
  5. `noche/caja-sin-conexion`: app instalable con cola de operaciones y contingencia (migración v8).
  6. `noche/ola2-*` y `noche/ola3-*` siguen la pila.
- Esta bitácora viaja con la pila: la versión completa está en la rama más alta.
- Vercel despliega cada rama sola en cuatro proyectos; las vistas previas piden el inicio de sesión de Vercel.

## Decisiones tomadas sin preguntar

1. **8 nov.** Apilar la noche sobre el PR #3 (entonces abierto) en lugar de `main`. Ya no aplica: el #3 se fusionó y la base volvió a ser `main`.
2. **8 nov.** Exportar para el contador en CSV y no en `.xlsx`: sin dependencias nuevas y cualquier contador lo importa.
3. **10 nov.** Todos los PR apuntan a `main` y las ramas van apiladas. Razón: lo pidió el encargo («cada una con su PR hacia main») y evita que un PR se fusione por error dentro de otra rama.
4. **10 nov.** Las migraciones de la noche arrancan en la v6 (la v5 la tomó el PR #7).
5. **10 nov.** Orden de la ola 1 según el juez final: arreglos de plata → factura → impresión → sin conexión. La pieza fiscal define el modelo de documentos que usan las demás, y la comanda impresa es la única salida de cocina cuando no hay red.
6. **10 nov.** Proveedor de facturación: **Matias API** detrás de una interfaz propia, con Factus de respaldo y un simulador fiel para la demo. Ni Matias ni Factus están en la lista de proveedores tecnológicos de la DIAN del 15 de octubre de 2026: el local se habilita con «software propio» y Ronda transmite por la API. Por eso se quita «Proveedor tecnológico: Factus» del tiquete, la portada y el README.
7. **10 nov.** Caja sin conexión como app web instalable (PWA), sin envoltorio Android y sin `experimental.useOffline`. El envoltorio (TWA) queda para después de la demo.
8. **10 nov.** Impresión por una capa ESC/POS propia con tres salidas: Web Bluetooth, RawBT (Bluetooth clásico, USB y red) y la impresión del navegador como respaldo.
9. **10 nov.** El repositorio está público. Por eso el diagnóstico que se sube no trae el detalle de los endurecimientos de seguridad que quedan para las olas 2 y 3 ni notas de la conversación comercial; la versión completa queda en `.noche/` (local, ignorada por git). Recomendación: volver privado el repositorio, que ya estaba pendiente desde el PR #3.
10. **10 nov. · Para confirmar con Carlos.** Con la caja abierta, quien cuenta la caja (rol caja) no ve en el panel los totales de esa jornada; vuelven a verse al cerrarla. Lo decidió el constructor de arreglos, más allá del diagnóstico: quitar solo la fila «Efectivo» no bastaba, porque el efectivo se deducía restando los otros medios al total. Dueño y administración ven todo. Se revierte quitando una línea en `app/(pos)/panel/page.tsx` (`if (hidden(day)) return <TotalsAfterCount …/>`).
11. **10 nov.** `npm test` corre dos archivos a la vez (`vitest.config.mts`): con más, las pruebas de integración se quedan sin memoria en este equipo.

## Lo que Carlos debe hacer antes de mostrarle la demo a Sr. Patata

- **Poner una base Postgres en la vista previa que se va a mostrar** (Neon desde el Marketplace de Vercel, plan gratis): `DATABASE_URL`, `DEMO_MODE=true`, `ALLOW_DEMO_RESET=true` y `SESSION_SECRET` (32 caracteres al azar). Sin base, cada copia de la función tiene sus propios datos y la demo se vuelve a sembrar sola a los 15 minutos sin escrituras: una mesa abierta puede desaparecer a mitad de la reunión. Esta sesión no tiene acceso a Vercel para hacerlo.
- Antes de la reunión: Panel → Ajustes → Reiniciar demo.

## Registro

### 8 de noviembre

- 06:00 · Repo clonado, dependencias instaladas, línea base medida: typecheck limpio y 60 pruebas en verde.
- 06:05 · Fase 1 lanzada: cinco jueces (comprador, operación, competencia, ley, código), tres investigaciones (proveedor, impresión térmica, sin conexión), verificación adversarial de los hallazgos de código y juez final.
- 07:05 · Carlos pidió un avance cerrable en media hora. Sin esperar al juez se construyó **Exportar para el contador** en `noche/exportar-contador`: Panel → Contador con cinco archivos CSV (ventas, impuestos, propinas, caja, compras y mermas) por rango de jornadas y por sede o toda la cadena. Formato: `;`, UTF-8 con BOM y coma decimal. Reglas puras en `lib/core/csv.ts` con pruebas; servidor en `lib/server/export.ts` con prueba de integración contra la demo.
  - Pendiente: guardar el valor exacto de cada compra (hoy `stock_movements` no lo tiene y el archivo trae un valor estimado con el costo promedio).
- 07:40 · Avance cerrado: typecheck, 70 pruebas y build en verde; recorrido en tablet (1280×800) y celular (390×844) sin desbordes, con descarga real del CSV. **PR #4** abierto.
- 08:05 · **Fase 1 terminada.** 61 agentes, 1.835 lecturas y búsquedas, sin errores. De 26 hallazgos de código, los escépticos refutaron los que no tenían respaldo y el juez dejó 27 arreglos ordenados por severidad, las decisiones de los cuatro frentes de la ola 1, cinco mejoras para la ola 2 y diez decisiones para la ola 3. La sesión se interrumpió aquí.

### 10 de noviembre

- 16:40 · Sesión retomada. En dos días `main` recibió los PR #3, #5, #6 y #7 (salón, portada, barra y cocina, cuentas que se separan, se unen y retienen, migración v5). El diagnóstico se hizo sobre la rama anterior, así que cada arreglo se vuelve a verificar contra el código actual antes de aplicarlo.
- 16:55 · `noche/exportar-contador` puesta al día con `main` (un conflicto en el README, resuelto con el texto de `main` más las líneas del contador). Typecheck, **87 pruebas** y build en verde. El PR #4 pasa a apuntar a `main`. Se agrega `DIAGNOSTICO_NOCHE.md`.
- 17:05 · Arranca la ola 1 con tres constructores en paralelo, cada uno en su worktree: arreglos de plata, factura electrónica (servidor) e impresión térmica. Después: pantallas de la factura y caja sin conexión.
- 17:30 · Se instaló un Postgres 16 real, embebido y local (en el scratchpad de la sesión, sin crear nada en la nube), para probar la ruta de Postgres. La base actual pasó el recorrido completo sobre Postgres real: migraciones, siembra de las cuatro sedes y 21 pantallas en tablet y celular sin errores.
- 19:20 · **Arreglos de plata cerrados** en `noche/arreglos-plata` (migración v6). Los doce arreglos del diagnóstico quedaron con su prueba:
  - Cobro: cada intento lleva una llave (`payments.attempt_key`); un reintento tras caída de red no cobra dos veces y la pantalla avisa cuando no supo si el pago quedó. «Efectivo exacto y cerrar» es una sola acción y una sola transacción.
  - Arqueo a ciegas de verdad: el esperado, la base y el efectivo cobrado no viajan al navegador de quien cuenta la caja (ni en la página, ni en el historial, ni en el panel, ni en el texto de WhatsApp).
  - Propina por persona en «Cada quien lo suyo»: múltiplos de $100 que suman exactamente lo que aceptó el cliente.
  - Rentabilidad y Cadena ya no duplican la venta de una cuenta refacturada.
  - Guardia de transacciones: usar la base de afuera dentro de `db.tx` lanza un error claro en vez de colgar la demo.
  - Con Postgres real: candado de arranque (dos copias no siembran a la vez) y candado de la caja al cobrar (un pago no entra a una caja que se está cerrando).
  - La demo en memoria no se vuelve a sembrar mientras haya una pantalla del equipo abierta.
  - Hojas de autorización que no pierden el PIN con cada refresco, premio de sellos que cuenta las adiciones, saldo solo con pagos en firme y opciones de la carta sin precio negativo.
  - La revisión propia del constructor encontró y corrigió cinco defectos más; el más serio, un interbloqueo de pagar y cerrar con Postgres real, reproducido antes del arreglo.
  - Verificado: typecheck, 130 pruebas y build; 8 pruebas de concurrencia contra Postgres real (17.9 del constructor y 16.15 del integrador). Recorrido en tablet y celular.
- 19:25 · Trampa de este equipo, ya anotada en CLAUDE.md: si la terminal está parada en `c:…` con la unidad en minúscula (como abre VS Code la carpeta), vitest falla en todas las pruebas con «Vitest failed to find the current suite». Entrando con `cd C:Users…` pasa todo. No es del código: pasa igual en `main`.

## Pendiente

- Ola 1: arreglos de plata, factura electrónica, impresión térmica, caja sin conexión; ampliar el archivo de ventas del contador con el tipo de documento y las notas como filas propias cuando exista el modelo fiscal.
- Ola 2: reparto de propinas y horas por persona para el contador, conciliación de Bre-B y Nequi contra el extracto, caja por cajero, Rappi por API, carta central de la cadena.
- Ola 3: Postgres real sin romper la demo, copias de seguridad, alta de un local en minutos.

## Paso exacto para retomar

`git fetch` y partir de la rama más alta de la pila que exista en el remoto (`git branch -r | grep noche/`). Leer el final del registro de esta bitácora en esa rama. Los informes crudos de la Fase 1 están resumidos en `DIAGNOSTICO_NOCHE.md`.
