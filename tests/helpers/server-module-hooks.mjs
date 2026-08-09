import fs from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Loader hooks that let tests import `lib/server/*` modules directly.
 *
 * Those modules are written for Next: they import the `server-only`
 * marker (not resolvable outside a Next build) and use the `@/…` path
 * alias. The hooks below map both onto the repo layout so the modules
 * can be exercised under `node --test` without a bundler.
 */

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const EMPTY_MODULE = pathToFileURL(path.join(ROOT, "tests/helpers/empty-module.mjs")).href;
const EXTENSIONS = [".ts", ".tsx", ".mjs", ".js", "/index.ts"];

function resolveExisting(url) {
  const filePath = fileURLToPath(url);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return url;
  for (const extension of EXTENSIONS) {
    const candidate = `${filePath}${extension}`;
    if (fs.existsSync(candidate)) return pathToFileURL(candidate).href;
  }
  return null;
}

let registered = false;

export function registerServerModuleHooks() {
  if (registered) return;
  registered = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return { url: EMPTY_MODULE, shortCircuit: true };
      }
      if (specifier.startsWith("@/")) {
        const found = resolveExisting(pathToFileURL(path.join(ROOT, specifier.slice(2))).href);
        if (found) return { url: found, shortCircuit: true };
      }
      if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
        const found = resolveExisting(new URL(specifier, context.parentURL).href);
        if (found) return { url: found, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
}

export async function importServerModule(relPath) {
  registerServerModuleHooks();
  return import(pathToFileURL(path.join(ROOT, relPath)).href);
}
