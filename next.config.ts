import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // Base de la demo ya migrada (scripts/demo-snapshot.ts); se lee desde el disco al arrancar
  outputFileTracingIncludes: { "/**": ["./lib/generated/demo-schema.tar.gz"] },
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
