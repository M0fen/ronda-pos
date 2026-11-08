# Ronda

Sistema de punto de venta para cafés, bares y restaurantes en Colombia: mesas, comandas a barra y cocina con la ficha de cada plato, domicilios de Rappi y propios con lista de empaque, mostrador con pantalla de turnos, cobro con propina voluntaria y cuentas divididas, Nequi y Bre-B, factura electrónica, carta QR, inventario por receta, sellos para clientes, caja con arqueo ciego, turnos marcados con PIN, el costo de cada turno y de cada persona frente a lo que vende, varias sedes con un panel de la cadena y el resumen del día por WhatsApp. Funciona en el navegador de la tablet o el celular que ya tiene el local.

La portada (`/`) presenta el sistema. La demo abre en `/entrar` con Sr. Patata, cadena de Pereira y Dosquebradas con cuatro sedes (Circunvalar, Belmonte, Dosquebradas y el mostrador de Galicia Mall Plaza): su carta pública con precios redondeados y, en cada sede, su equipo con los turnos de las últimas dos semanas, ventas en mesa, para llevar y por Rappi, y el servicio en marcha.

## Demo

Sede Circunvalar (la tablet abre aquí; la sede se cambia abajo en `/entrar`):

| Persona | Rol | PIN |
| --- | --- | --- |
| Andrés | Dueño: todo, incluidos panel, ajustes y la cadena. Entra en las cuatro sedes | 1234 |
| Valentina | Caja: cobra, abre y cierra caja, autoriza anulaciones, despacha domicilios | 2222 |
| Juan Pablo | Mesero | 3333 |
| Camila | Mesero | 4444 |
| Mateo | Barra y cocina (salario) | 5555 |
| Luisa | Barra y cocina, turno de noche | 6666 |
| Sofía | Barra y cocina, por horas | 7777 |

En las otras sedes la pantalla de entrada muestra el PIN de cada persona: Belmonte (Daniela, administradora, 2121), Dosquebradas (Paola, administradora, 3131) y Galicia, un mostrador de centro comercial (Tatiana, caja, 4141).

Un recorrido de cinco minutos:

1. Entra como **Juan Pablo**. Aprueba el pedido QR de la mesa 7 y abre la mesa 4.
2. Pide un Antojo de patatas (elige la salsa), dos Club Colombia y una Burger smash doble. Toca **Enviar**.
3. Anula la burger: como ya salió a cocina, la autoriza otra persona. Elige a Valentina (caja) y escribe su PIN (2222).
4. Abre **Barra y cocina** en otra pestaña y marca el tiquete como listo. El salón lo muestra al instante.
5. Cobra la mesa: propina sí, partes iguales, una parte con Bre-B (con la referencia del comprobante) y otra en efectivo. Sale la factura con su código QR.
6. Entra como **Andrés** y mira el panel (Hoy y Ayer), el inventario, la carta, los clientes y los QR de las mesas. Abre un QR en el celular para ver la carta del cliente.
7. En **Panel → Rentabilidad** mira qué turnos se pagan solos, cuánto costó cada persona con recargos y carga, y las alertas de jornada (42 horas, extras, domingos y festivos).
8. En `/entrar`, toca **Marcar turno**, elige a Luisa y escribe 6666: queda en turno y suma a la mano de obra de hoy.
9. Como **Andrés**, abre **Domicilios**: un pedido de Rappi en cada etapa. Acepta el nuevo, revisa la lista del que está para empacar (la bolsa no se cierra si falta algo) y entrega el que espera el domiciliario: queda pagado en la plataforma y con su factura. En **Barra y cocina** los tiquetes de domicilio dicen en cuánto llega el domiciliario.
10. En **Panel → Cadena** compara las cuatro sedes: ventas, insumos, equipo, comisiones de Rappi, alertas y lo que hay que comprar en cada una. **Ir a Galicia** pasa la tablet a esa sede: abre **Pantalla de turnos** desde Barra y cocina para ver el televisor del mostrador.

En **Panel → Ajustes** está el botón para reiniciar la demo.

### Qué es simulado en la demo

- **Factura electrónica:** se numera y se calcula un CUFE de prueba; no se envía a la DIAN. En producción se conecta un proveedor tecnológico autorizado.
- **Bre-B, Nequi y tarjeta:** se registran con la referencia del pago. No hay conexión con bancos ni datáfonos.
- **Rappi:** el pedido se pasa al tablero con su código y los minutos del domiciliario; no hay conexión directa con Rappi (se hace con su API de aliados o con un integrador, con aprobación de Rappi). La comisión de cada canal se pone en Panel → Ajustes.
- **Impresión:** usa la impresión del navegador (precuenta y factura en formato de tirilla de 80 mm).
- **WhatsApp:** el resumen del día y los mensajes a clientes abren WhatsApp con el texto listo; no hay envío automático.
- **Sin conexión:** la demo necesita internet. La app de caja para Android sin conexión hace parte de la versión 1.
- **Marca:** la demo lleva la marca de Sr. Patata en todo el sistema (nombre, colores, ícono y portada). Se apaga en Panel → Ajustes → Marca y vuelve a ser Ronda.
- **Equipo, carta y cifras:** salarios, horarios, clientes, ventas y comisiones son de ejemplo. Las sedes y sus direcciones salen del perfil público de Sr. Patata; la carta, de su menú público con precios redondeados; bebidas, cervezas, adiciones y recetas son de ejemplo y se editan en Panel → Carta.
- **Costo del equipo:** es una estimación para decidir turnos (recargos, festivos, seguridad social y prestaciones de la ley vigente). La nómina la liquida el contador.

## Correr en local

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # reglas puras y flujos de plata, editores y alta contra una base real
npm run typecheck
npm run build      # genera la base de la demo y compila
```

Sin `DATABASE_URL` la app usa PGlite (Postgres dentro de Node) en `.data/` y siembra el local de ejemplo. Borra `.data` para empezar de cero.

## Publicar en Vercel

1. Importa el repositorio en Vercel. No hace falta configurar nada: el build (`vercel.json`) genera la base de la demo y la app la carga en memoria.
2. Opcional: `NEXT_PUBLIC_SALES_WHATSAPP` con el WhatsApp de contacto de la portada (sin ella usa el que trae `app/page.tsx`) y `SESSION_SECRET` con 32 caracteres al azar.

La demo en memoria se reinicia sola cuando Vercel apaga la función (tras unos minutos sin visitas) y cada copia de la función tiene sus propios datos. Para que los datos persistan, conecta una base Postgres (por ejemplo Neon desde el Marketplace de Vercel) con `DATABASE_URL`; si además pones `DEMO_MODE=true`, se siembra el local de ejemplo y los pagos siguen simulados.

Variables en `.env.example`.

## Instalar un local real

1. Base Postgres propia (Neon o Supabase) en `DATABASE_URL`, sin `DEMO_MODE`. Pon `SESSION_SECRET` (32 caracteres al azar: sin ella no se abren sesiones) y `SETUP_TOKEN` (12 caracteres o más).
2. Abre `/entrar`: con la base vacía lleva a `/alta`. Con el código de instalación se crea el local (nombre, NIT, impuesto), el salón y el dueño con un PIN de 6 números. Esa tablet queda enrolada y el dueño adentro.
3. El panel muestra **Para empezar a vender** hasta completar: carta (categorías, productos y precios), mesas y zonas, equipo con su PIN y sus tablets (Panel → Equipo da un código de 6 números que cada tablet escribe en `/entrar`), resolución de facturación de la DIAN (prefijo, rango y vigencia) y la primera caja. Insumos y recetas son opcionales: con ellos se descuenta el inventario y salen los márgenes.

Seguridad: fuera de la demo solo las tablets enroladas muestran al equipo; cada persona se bloquea 15 minutos tras 5 PIN errados; la tablet se bloquea sola tras unos minutos sin uso (Panel → Ajustes); las sesiones se cierran al cambiar un PIN o un rol, o al quitar una tablet. La factura electrónica no se envía a la DIAN hasta conectar un proveedor tecnológico.

## Cómo está hecho

- Next.js 16 (App Router), React 19 y Tailwind 4. Todo se lee en Server Components y todo lo que escribe va por Server Actions (no hay rutas `/api`).
- `lib/core/`: reglas puras con pruebas (impuesto incluido, propina, división de cuentas, vueltas, sellos, happy hour, jornada; en `labor.ts` el costo de cada turno: recargos, festivos, carga prestacional y alertas de jornada; en `delivery.ts` las etapas de un domicilio y su lista de empaque).
- `lib/server/`: pedidos y rondas, pagos y caja, domicilios, cadena, carta QR, inventario, reportes, recibos, equipo y permisos.
- `lib/schema.ts`: migraciones SQL; `lib/seed.ts`: la cadena de la demo, cuatro sedes con dos semanas de ventas y de turnos.
- Tiempo real por sondeo liviano: cada cambio sube un contador y las pantallas abiertas se refrescan.

## Lo que sigue para la versión 1

Facturación electrónica real con un proveedor autorizado (cada sede ya lleva su prefijo y su numeración), confirmación automática de Bre-B y Nequi, impresión directa en térmicas de red, app de caja para Android sin conexión, conexión directa con Rappi, sellos compartidos entre sedes y envío automático por WhatsApp Business.
