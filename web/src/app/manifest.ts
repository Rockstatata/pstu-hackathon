import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Chorui",
    short_name: "Chorui",
    description: "A quiet, dependable way to move money.",
    start_url: "/",
    display: "standalone",
    background_color: "#F8F7FC",
    theme_color: "#6D28D9",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
