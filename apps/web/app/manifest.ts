import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cash Memo",
    short_name: "Cash Memo",
    description: "Your private money journal",
    start_url: "/",
    display: "standalone",
    background_color: "#faf8f4",
    theme_color: "#1f7a5c",
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/apple-icon.png", type: "image/png", sizes: "180x180" },
    ],
  };
}
