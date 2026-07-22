import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Greenlit",
    short_name: "Greenlit",
    description: "Acceptance-to-invoice evidence for web agencies.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f4ec",
    theme_color: "#10231d",
    icons: [
      { src: "/brand/greenlit-mark-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/greenlit-mark-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
