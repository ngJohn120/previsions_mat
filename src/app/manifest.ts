import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Prévisions Matières — Complexe Scolaire SILOE",
    short_name: "Prévisions Matières",
    description:
      "Gestion des prévisions annuelles des matières (Primaire & Secondaire). Fonctionne hors connexion.",
    start_url: "/",
    display: "standalone",
    background_color: "#f1f5f9",
    theme_color: "#1d4ed8",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
