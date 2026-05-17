import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const appRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      react: resolve(appRoot, "node_modules/react"),
      "react-dom": resolve(appRoot, "node_modules/react-dom"),
    },
    dedupe: ["react", "react-dom"],
  },
  server: {
    host: "127.0.0.1",
    port: 1440,
    strictPort: true,
    fs: {
      allow: [appRoot, resolve(appRoot, "../..")],
    },
  },
  clearScreen: false,
});
