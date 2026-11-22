import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Event Storey · Daily Stocktake",
    short_name: "Event Storey",
    description: "Daily stocktake and purchase orders for the café and kitchen.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "en-GB",
    background_color: "#FAF6EF",
    theme_color: "#1F4D3A",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}

