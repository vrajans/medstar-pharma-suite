import type { MetadataRoute } from "next";

/** Lets Chrome install the POS as a desktop app (own window, taskbar icon, opens straight to billing). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MedStar POS",
    short_name: "MedStar",
    description: "Pharmacy billing, inventory and compliance",
    start_url: "/pos",
    scope: "/",
    display: "standalone",
    background_color: "#f6f7f9",
    theme_color: "#134e4a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
