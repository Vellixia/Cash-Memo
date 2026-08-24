import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cashmemo",
    short_name: "Cashmemo",
    description: "Private money journal",
    start_url: "/app",
    display: "standalone",
    background_color: "#f7f8f5",
    theme_color: "#163b35",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
