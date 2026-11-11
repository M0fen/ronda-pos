import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // La compilación parte de cero en vez de reutilizar la caché de Turbopack. Con la caché, una compilación llegó a salir
  // con la hoja de estilos de la rama anterior (sin sus utilidades nuevas) y sin avisar. Cuesta unos segundos por despliegue.
  experimental: { turbopackFileSystemCacheForBuild: false },
  // Base de la demo ya migrada (scripts/demo-snapshot.ts); se lee desde el disco al arrancar
  outputFileTracingIncludes: { "/**": ["./lib/generated/demo-schema.tar.gz"] },
  // Las capturas de la portada salen en AVIF donde el navegador lo recibe (pesan menos) y en WebP donde no
  images: { formats: ["image/avif", "image/webp"] },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
