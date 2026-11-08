# Bitácora de la noche · 8 de noviembre de 2026

Misión: llevar a Ronda de demo fuerte a compra segura para Sr. Patata (cuatro sedes) y dejarla como producto comercial para restobares del Eje Cafetero.

## Cómo está organizado el trabajo

- **Base de todas las ramas:** `auditoria-arreglos` (PR #3, abierto, 6.114 líneas, migración v4, resolución DIAN, nota crédito, alta en `/alta`). Basar la noche en `main` chocaría con todo eso y duplicaría trabajo, así que las ramas `noche/*` van **apiladas** sobre el PR #3, en este orden:
  1. `noche/factura-electronica` → PR hacia `auditoria-arreglos` (GitHub lo pasa a `main` solo cuando se fusione el #3).
  2. `noche/caja-sin-conexion` → PR hacia `noche/factura-electronica`.
  3. `noche/impresion-termica` → PR hacia la anterior.
  4. `noche/exportar-contador` → PR hacia la anterior.
  5. `noche/ola2-*` y `noche/ola3-*` siguen la pila.
- Cada PR muestra solo su propio cambio. El orden de fusión es el de la pila. La vista previa de Vercel de la rama más alta trae todo lo de abajo.
- Esta bitácora vive en la raíz y viaja con la pila: la versión completa está en la rama más alta.
- **Nunca se toca `main`.** La demo pública (ronda-pos-fegn.vercel.app) sigue intacta.

## Línea base (antes de tocar nada)

- `npm run typecheck`: limpio. `npm test`: 60 pruebas en verde (6 archivos, incluidos los `*.integration.test.ts` del PR #3).
- Vercel está conectado al repo (cuatro proyectos despliegan cada rama: ronda-pos, ronda-pos-fegn, ronda-pos-4yij, rond4-pos). Empujar una rama `noche/*` crea su vista previa sola.

## Decisiones tomadas sin preguntar

1. Apilar sobre el PR #3 en lugar de `main` (razón arriba).
2. Los PR de la pila apuntan a la rama de abajo, no a `main`, para que cada uno se pueda revisar por separado. GitHub los re-apunta a `main` al fusionar la base.

## Registro

- 06:00 · Repo clonado, dependencias instaladas, línea base medida.
- 06:05 · Fase 1 lanzada: cinco jueces (comprador, operación, competencia, ley, código), tres investigaciones (proveedor tecnológico, impresión térmica, sin conexión), verificación adversarial de los hallazgos de código y juez final.
- 07:05 · Carlos pidió un avance cerrable en media hora. Sin esperar al juez, se construyó **Exportar para el contador** (ola 1, frente 4) en `noche/exportar-contador`: Panel → Contador con cinco archivos CSV (ventas, impuestos, propinas, caja, compras y mermas) por rango de jornadas y por sede o toda la cadena. Formato: `;`, UTF-8 con BOM y coma decimal (Excel en Colombia los abre con doble clic). Reglas puras en `lib/core/csv.ts` con pruebas; servidor en `lib/server/export.ts` con prueba de integración contra la demo (base + impuesto = total en cada factura; la suma de impuestos por tarifa coincide con las facturas vigentes; permisos por rol).
  - Decisión: CSV y no XLSX esta noche (sin dependencias nuevas; un contador lo importa igual a Siigo, Alegra o Excel). Si un contador pide .xlsx, se agrega un escritor sin dependencias en otra ola.
  - Pendiente: guardar el valor exacto de cada compra (hoy `stock_movements` no lo tiene y el archivo trae un valor estimado con el costo promedio); va con la migración de la ola 3.
- 07:40 · Cerrado el avance del contador: typecheck, 70 pruebas y build de producción en verde; recorrido en tablet (1280×800) y celular (390×844) sin desbordes, con descarga real del CSV (193 facturas del mes, BOM correcto). **PR #4** → https://github.com/M0fen/ronda-pos/pull/4 (base `auditoria-arreglos`). Vistas previas de Vercel desplegadas en los cuatro proyectos; están protegidas con el inicio de sesión de Vercel (p. ej. https://ronda-pos-fegn-git-noche-exportar-contador-m0fens-projects.vercel.app). Los worktrees con junction a `node_modules` sirven para typecheck y pruebas, pero Turbopack no compila con ellos: el build se corre con `node_modules` propio o en el repo principal.
