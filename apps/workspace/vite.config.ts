/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri dev server binds to 1420 (see `devUrl` in src-tauri/tauri.conf.json
// and `npm run dev` in package.json). Using strictPort means Vite fails
// fast rather than picking a different port when 1420 is busy — that way
// Tauri's webview never silently points at a stale server.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "codemirror",
              test: /node_modules[\\/](@codemirror|@lezer|@uiw[\\/]react-codemirror|crelt|style-mod|w3c-keyname)[\\/]/,
              maxSize: 380 * 1024,
            },
          ],
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  clearScreen: false,
  test: {
    // Vitest picks up *.test.{ts,tsx} files under src/ without extra config. We
    // don't need jsdom yet — all tests to date cover pure-function modules.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
