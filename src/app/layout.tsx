import type { Metadata } from "next";
import localFont from "next/font/local";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import "./globals.css";

/**
 * Source Sans Pro — police de l'application (chargée localement).
 * Fichiers : src/app/fonts/ (copiés depuis le dossier Fonts de l'utilisateur).
 */
const sourceSans = localFont({
  src: [
    { path: "./fonts/SourceSansPro-Regular.otf", weight: "400", style: "normal" },
    { path: "./fonts/SourceSansPro-It.otf", weight: "400", style: "italic" },
    { path: "./fonts/SourceSansPro-Semibold.otf", weight: "600", style: "normal" },
    { path: "./fonts/SourceSansPro-Bold.otf", weight: "700", style: "normal" },
    { path: "./fonts/SourceSansPro-Black.otf", weight: "900", style: "normal" },
  ],
  variable: "--font-source-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Prévisions Matières — Complexe Scolaire SILOE",
  description: "Gestion des prévisions annuelles des matières (Primaire & Secondaire)",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="fr"
      className={`${sourceSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
