import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = process.cwd();

function resolveAliasPath(specifier) {
  const absPath = path.join(rootDir, specifier.slice(2));
  const candidates = [
    absPath,
    `${absPath}.ts`,
    `${absPath}.tsx`,
    `${absPath}.js`,
    `${absPath}.mjs`,
    path.join(absPath, "index.ts"),
    path.join(absPath, "index.tsx"),
    path.join(absPath, "index.js"),
    path.join(absPath, "index.mjs"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return absPath;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        shortCircuit: true,
        url: "data:text/javascript,export {};",
      };
    }
    if (specifier.startsWith("@/")) {
      const fileUrl = pathToFileURL(resolveAliasPath(specifier)).href;
      return nextResolve(fileUrl, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".json")) {
      const source = fs.readFileSync(fileURLToPath(url), "utf8");
      return {
        format: "module",
        shortCircuit: true,
        source: `export default ${source};`,
      };
    }
    return nextLoad(url, context);
  },
});
