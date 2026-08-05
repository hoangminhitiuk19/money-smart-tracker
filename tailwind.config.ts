import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        primary: "#4f46e5",
        "sidebar-bg": "#0f172a",
        "sidebar-text": "#cbd5e1",
        "sidebar-active": "#6366f1",
        "card-bg": "#ffffff",
        "page-bg": "#f8fafc",
        income: "#059669",
        expense: "#e11d48",
        transfer: "#2563eb",
        refund: "#f97316",
        adjustment: "#64748b",
        "quality-s": "#7c3aed",
        "quality-a": "#059669",
        "quality-b": "#2563eb",
        "quality-c": "#d97706",
        "quality-d": "#e11d48",
        "capture-canvas": "#F5F7FB",
        "capture-ink": "#172033",
        "capture-primary": "#4338CA",
        "capture-ready": "#087F5B",
        "capture-review": "#C97912",
        "capture-error": "#C92A5B"
      },
      fontFamily: {
        "capture-display": [
          "var(--font-capture-display)",
          "ui-sans-serif",
          "system-ui",
          "sans-serif"
        ],
        "capture-ui": [
          "var(--font-capture-ui)",
          "ui-sans-serif",
          "system-ui",
          "sans-serif"
        ],
        "capture-data": [
          "var(--font-capture-data)",
          "ui-monospace",
          "SFMono-Regular",
          "monospace"
        ]
      }
    }
  },
  plugins: []
};

export default config;
