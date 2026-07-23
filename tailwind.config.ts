import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#302B27",
        primary: "#9B7F58",
        surface: "#FBF8F3",
      },
    },
  },
  plugins: [],
};

export default config;
