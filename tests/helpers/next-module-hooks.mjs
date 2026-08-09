// Lets `node --test` import Next.js server modules directly.
//
// Three things stop plain Node from loading `lib/server/**.ts`:
//   1. the `@/*` tsconfig path alias,
//   2. `import "server-only"`, which only resolves through the Next bundler,
//   3. bare `import x from "*.json"`, which Node requires an import attribute for.
// Registering these hooks is what lets the sitemap tests exercise the real
// runtime code path instead of a re-implementation of it.

import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
const EMPTY_MODULE_URL = "data:text/javascript,export default {};";
const ALIAS_EXTENSIONS = ["", ".ts", ".tsx", ".mts", ".mjs", ".js", "/index.ts", "/index.mjs"];

let registered = false;

function resolveAlias(specifier) {
  const base = path.join(REPO_ROOT, specifier.slice(2));
  for (const ext of ALIAS_EXTENSIONS) {
    const candidate = `${base}${ext}`;
    try {
      if (fs.statSync(candidate).isFile()) return pathToFileURL(candidate).href;
    } catch {
      // try the next extension
    }
  }
  return null;
}

export function registerNextModuleHooks() {
  if (registered) return REPO_ROOT;
  registered = true;

  module.registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only" || specifier === "client-only") {
        return { url: EMPTY_MODULE_URL, shortCircuit: true };
      }
      if (specifier.startsWith("@/")) {
        const url = resolveAlias(specifier);
        if (url) return { url, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url.startsWith("file:") && url.endsWith(".json")) {
        const source = fs.readFileSync(fileURLToPath(url), "utf8");
        return { format: "module", source: `export default ${source};`, shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });

  return REPO_ROOT;
}
