# Ronda

Sistema de punto de venta para cafés y bares en Colombia: mesas, comandas a barra y cocina, cobro con propina voluntaria y cuentas divididas, Nequi y Bre-B, factura electrónica, carta QR, inventario por receta, sellos para clientes, caja con arqueo ciego y el resumen del día por WhatsApp. Funciona en el navegador de la tablet o el celular que ya tiene el local.

La portada (`/`) es la página de venta. La demo abre en `/entrar` con un café bar de ejemplo (Café Bar Villa Verde, Pereira) y el servicio en marcha.

## Demo

| Persona | Rol | PIN |
| --- | --- | --- |
| Andrés | Dueño: todo, incluidos panel y ajustes | 1234 |
| Valentina | Caja: cobra, abre y cierra caja, autoriza anulaciones | 2222 |
| Juan Pablo | Mesero | 3333 |
| Camila | Mesero | 4444 |
| Mateo | Barra | 5555 |

Un recorrido de cinco minutos:

1. Entra como **Juan Pablo**. Aprueba el pedido QR de la mesa 7 y abre la mesa 4.
2. Pide un capuchino (elige la leche), dos Poker y unas empanadas. Toca **Enviar**.
3. Anula las empanadas: como ya salieron a cocina, pide el PIN de caja (2222).
4. Abre **Barra y cocina** en otra pestaña y marca el tiquete como listo. El salón lo muestra al instante.
5. Cobra la mesa: propina sí, partes iguales, una parte con Bre-B y otra en efectivo. Sale la factura con su código QR.
6. Entra como **Andrés** y mira el panel (Hoy y Ayer), el inventario, la carta, los clientes y los QR de las mesas. Abre un QR en el celular para ver la carta del cliente.

En **Panel → Ajustes** está el botón para reiniciar la demo.

### Qué es simulado en la demo

- **Factura electrónica:** se numera y se calcula un CUFE de prueba; no se envía a la DIAN. En producción se conecta un proveedor tecnológico autorizado.
- **Bre-B, Nequi y tarjeta:** se registran con la referencia del pago. No hay conexión con bancos ni datáfonos.
- **Impresión:** usa la impresión del navegador (precuenta y factura en formato de tirilla de 80 mm).
- **WhatsApp:** el resumen del día y los mensajes a clientes abren WhatsApp con el texto listo; no hay envío automático.
- **Sin conexión:** la demo necesita internet. La app de caja para Android sin conexión hace parte de la versión 1.

## Correr en local

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # reglas de precios, propina, división de cuentas y jornada
npm run typecheck
npm run build      # genera la base de la demo y compila
```

Sin `DATABASE_URL` la app usa PGlite (Postgres dentro de Node) en `.data/` y siembra el café bar de ejemplo. Borra `.data` para empezar de cero.

## Publicar en Vercel

1. Importa el repositorio en Vercel. No hace falta configurar nada: el build (`vercel.json`) genera la base de la demo y la app la carga en memoria.
2. Opcional: `NEXT_PUBLIC_SALES_WHATSAPP` con el número de ventas de la portada (sin ella usa el que trae `app/page.tsx`) y `SESSION_SECRET` con 32 caracteres al azar.

La demo en memoria se reinicia sola cuando Vercel apaga la función (tras unos minutos sin visitas) y cada copia de la función tiene sus propios datos. Para que los datos persistan, conecta una base Postgres (por ejemplo Neon desde el Marketplace de Vercel) con `DATABASE_URL`; si además pones `DEMO_MODE=true`, se siembra el café bar de ejemplo y los pagos siguen simulados.

Variables en `.env.example`.

## Cómo está hecho

- Next.js 16 (App Router), React 19 y Tailwind 4. Todo se lee en Server Components y todo lo que escribe va por Server Actions (no hay rutas `/api`).
- `lib/core/`: reglas puras con pruebas (impuesto incluido, propina, división de cuentas, vueltas, sellos, happy hour, jornada).
- `lib/server/`: pedidos y rondas, pagos y caja, carta QR, inventario, reportes, recibos, equipo y permisos.
- `lib/schema.ts`: migraciones SQL; `lib/seed.ts`: el café bar de ejemplo con dos semanas de ventas.
- Tiempo real por sondeo liviano: cada cambio sube un contador y las pantallas abiertas se refrescan.

## Lo que sigue para la versión 1

Facturación electrónica real con un proveedor autorizado, confirmación automática de Bre-B y Nequi, impresión directa en térmicas de red, app de caja para Android sin conexión, envío automático por WhatsApp Business y varias sedes.
