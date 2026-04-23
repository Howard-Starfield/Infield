import { defineConfig } from "vite";
import checker from "vite-plugin-checker";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  clearScreen: false,
  plugins: [
    react(),
    ...(command === "build" ? [checker({ typescript: { tsconfigPath: "./tsconfig.json" } })] : [])
  ],
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true
  }
}));
