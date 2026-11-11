/*
 * Ronda: si la tablet abre o recarga una pantalla sin internet, muestra "Sin conexión" en lugar de la página de
 * error del navegador, y vuelve sola cuando regresa la red. No guarda la app en caché: con internet todo va
 * directo al servidor, así nunca se ve una versión vieja.
 */
const OFFLINE = `<!doctype html>
<html lang="es-CO">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f4f5f1">
<title>Sin conexión</title>
<style>
  html, body { margin: 0; min-height: 100%; background: #f4f5f1; color: #24150f; font: 16px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { min-height: 100dvh; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 24px; text-align: center; }
  .dot { width: 56px; height: 56px; border-radius: 50%; background: #fbe3e3; display: grid; place-items: center; }
  .dot span { width: 18px; height: 18px; border-radius: 50%; background: #d2232a; animation: beat 1.6s ease-in-out infinite; }
  h1 { margin: 0; font-size: 28px; line-height: 1.1; }
  p { margin: 0; max-width: 28rem; color: #6b6660; }
  button { min-height: 52px; padding: 0 28px; border: 0; border-radius: 16px; background: #24150f; color: #f4f5f1; font: 600 17px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  @keyframes beat { 50% { transform: scale(0.7); opacity: 0.6; } }
  @media (prefers-reduced-motion: reduce) { .dot span { animation: none; } }
</style>
</head>
<body>
<main>
  <div class="dot"><span></span></div>
  <h1>Sin conexión</h1>
  <p>Esta pantalla no tiene internet. Revisa el wifi del local. Lo que ya estaba guardado sigue guardado, y la pantalla vuelve sola apenas regrese la conexión.</p>
  <button type="button" onclick="location.reload()">Intentar de nuevo</button>
</main>
<script>
  addEventListener("online", function () { location.reload(); });
  setInterval(function () {
    fetch("/ronda-icon.svg?ping=" + Date.now(), { cache: "no-store" }).then(function (r) { if (r.ok) location.reload(); }).catch(function () {});
  }, 5000);
</script>
</body>
</html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  // Solo las pantallas que se abren o recargan; lo demás (datos, acciones, imágenes) pasa directo
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(
      () => new Response(OFFLINE, { status: 503, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }),
    ),
  );
});
