import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { OfflineNotice } from "@/components/offline-notice";
import { RegisterServiceWorker } from "@/components/service-worker";
import { Toaster } from "@/components/toast";
import { type Brand, brandIcon, brandInitials, getBrand } from "@/lib/server/business";
import "./globals.css";

// Todo es en vivo: mesas, cuentas y caja cambian a cada momento
export const dynamic = "force-dynamic";

const archivo = localFont({
  src: "../node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2",
  variable: "--font-archivo",
  weight: "100 900",
  display: "swap",
  declarations: [{ prop: "font-stretch", value: "62% 125%" }],
});

const jetbrains = localFont({
  src: "../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
  variable: "--font-jetbrains",
  weight: "100 800",
  display: "swap",
});

/** Para instalar en la tablet: el manifiesto y el ícono del iPad llevan la marca en la dirección (no leen la base). */
function installable(brand: Brand): Pick<Metadata, "manifest" | "appleWebApp"> & { apple: { url: string; sizes: string; type: string } } {
  const q = brand.whiteLabel ? new URLSearchParams({ n: brand.name, i: brandInitials(brand), bg: brand.primary.slice(1), fg: brand.accent.slice(1) }).toString() : "";
  return {
    manifest: `/app.webmanifest${q ? `?${q}` : ""}`,
    appleWebApp: { capable: true, title: brand.whiteLabel ? brand.name : "Ronda", statusBarStyle: "default" },
    apple: { url: `/app-icon?s=180&v=full${q ? `&${q}` : ""}`, sizes: "180x180", type: "image/png" },
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  const { apple, ...app } = installable(brand);
  if (!brand.whiteLabel)
    return {
      title: { default: "Ronda · POS para cafés y bares", template: "%s · Ronda" },
      description: "Mesas, barra y cocina sin papel, factura electrónica, Bre-B, sellos para tus clientes y lo que cuesta cada turno, en la tablet que ya tienes.",
      applicationName: "Ronda",
      icons: { icon: "/ronda-icon.svg", apple },
      ...app,
    };
  // Con la marca del local: su nombre y su ícono, y fuera de los buscadores (es su sistema, no una página pública)
  return {
    title: { default: `${brand.name} · Pedidos, cocina y caja`, template: `%s · ${brand.name}` },
    description: `El sistema de ${brand.name}: mesas, cocina y barra sin papel, cobro, carta QR, inventario y el costo de cada turno.`,
    applicationName: brand.name,
    icons: { icon: brandIcon(brand), apple },
    robots: { index: false, follow: false },
    ...app,
  };
}

export const viewport: Viewport = {
  themeColor: "#f4f5f1",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const brand = await getBrand();
  const colors = brand.whiteLabel ? ({ "--brand-primary": brand.primary, "--brand-accent": brand.accent } as React.CSSProperties) : undefined;
  return (
    <html lang="es-CO" className={`${archivo.variable} ${jetbrains.variable}`} style={colors}>
      <body className="min-h-dvh antialiased">
        {children}
        <OfflineNotice />
        <Toaster />
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
