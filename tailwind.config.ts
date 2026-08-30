import type { Config } from "tailwindcss";

// Owner: TM2. Design tokens live in app/globals.css and are surfaced here.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
