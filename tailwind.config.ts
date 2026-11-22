import type { Config } from "tailwindcss";

/**
 * Brand tokens inspired by the reference design:
 * black, electric yellow, emerald green, peach paper, deep purple, cyan links.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#FDEAD9", // peach section background
        card: "#FFFFFF",
        ink: { DEFAULT: "#000000", soft: "#4A4046" },
        volt: { DEFAULT: "#F8FA00", dark: "#D9DB00" }, // electric yellow (CTAs, highlights)
        brand: { DEFAULT: "#018168", dark: "#00604E", light: "#D5EEE8" }, // emerald green
        plum: { DEFAULT: "#35004E", light: "#4B1A66" }, // footer purple
        aqua: "#00E0D8", // footer links
        accent: { DEFAULT: "#D3342B", light: "#FBDAD6" }, // errors / alerts
        ok: { DEFAULT: "#017A5F", light: "#D5EEE8" },
        warn: { DEFAULT: "#9A5200", light: "#FFE6B8" },
        line: "#E8CBB2",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Impact", "Haettenschweiler", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
