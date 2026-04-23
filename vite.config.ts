/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // Path aliases
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@/bindings": resolve(__dirname, "./src/bindings.ts"),
    },
    dedupe: ["react", "react-dom"],
  },

  // Glide data grid imports lodash submodules as `import x from "lodash/has.js"` (CJS).
  // Without pre-bundling, dev server serves them as ESM and default import throws (white screen).
  optimizeDeps: {
    include: [
      "lodash/has.js",
      "lodash/debounce.js",
      "lodash/throttle.js",
      "lodash/clamp.js",
      "lodash/range.js",
      "lodash/groupBy.js",
      "lodash/uniq.js",
      "lodash/flatten.js",
    ],
  },

  // Single entry: src/overlay/ was deleted in the wholesale-swap
  // (third_party_selling_desktop has no overlay surface). H6 wires
  // the Glide data-grid overlay back if Notes/Databases needs it.
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
      },
    },
  },

  // Vitest configuration. src/test-setup.ts was deleted in the
  // wholesale-swap — third_party's test files don't rely on it.
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
