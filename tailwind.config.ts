import type { Config } from "tailwindcss";
// Owner: TM2. Design tokens live in app/globals.css and are surfaced here.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        ink: "var(--ink)",
        "ink-soft": "var(--ink-soft)",
        line: "var(--line)",
        accent: "var(--accent)",
        calm: "var(--calm)",
        "dot-blue": "var(--dot-blue)",
        alert: "var(--alert)",
      },
      borderRadius: {
        card: "var(--r-card)",
        btn: "var(--r-btn)",
      },
      fontFamily: {
        display: ["var(--font-display)", "serif"],
        body: ["var(--font-body)", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;