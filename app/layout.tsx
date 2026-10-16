import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Toaster } from "@/components/toast";
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

export const metadata: Metadata = {
  title: { default: "Ronda · POS para cafés y bares", template: "%s · Ronda" },
  description: "Mesas, barra, factura electrónica y cobro con Bre-B desde la tablet que ya tienes. Para cafés y bares de Colombia.",
  applicationName: "Ronda",
};

export const viewport: Viewport = {
  themeColor: "#f4f5f1",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CO" className={`${archivo.variable} ${jetbrains.variable}`}>
      <body className="min-h-dvh antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
