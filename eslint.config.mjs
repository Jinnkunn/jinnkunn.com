import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    ".open-next/**",
    ".wrangler/**",
    "next-env.d.ts",
    // Third-party vendored scripts; not maintained in this repo.
    "public/cdn-cgi/**",
    // Tauri workspace app — `dist/` is the Vite build output and
    // `src-tauri/target/**` is the Rust/Tauri build directory containing
    // minified generated JS that would otherwise flood ESLint output.
    "apps/workspace/dist/**",
    "apps/workspace/src-tauri/target/**",
    // Local Playwright CLI cache.
    ".playwright-cli/**",
  ]),
]);

export default eslintConfig;
