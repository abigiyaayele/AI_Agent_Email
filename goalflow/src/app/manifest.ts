import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GoalFlow",
    short_name: "GoalFlow",
    description: "Turn long-term ambitions into daily action.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f7f7f5",
    theme_color: "#2f6f5e",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
