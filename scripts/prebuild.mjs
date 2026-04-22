import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { DEFAULT_SITE_CONFIG } from "../lib/shared/default-site-config.mjs";
import { resolveContentSourceKind } from "../lib/shared/content-source.mjs";

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      env: process.env,
      ...opts,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

function ensureGeneratedStubs() {
  const dir = path.join(process.cwd(), "content", "generated");
  fs.mkdirSync(dir, { recursive: true });

  const writeIfMissing = (name, obj) => {
    const file = path.join(dir, name);
    try {
      if (fs.statSync(file).isFile()) return;
    } catch {
      // ignore
    }
    fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n", "utf8");
  };

  // These files are imported at build time (edge / proxy) so CI must have *something*
  // even when no content source is configured.
  writeIfMissing("routes.json", {});
  writeIfMissing("routes-manifest.json", []);
  writeIfMissing("search-index.json", []);
  writeIfMissing("protected-routes.json", []);
  writeIfMissing("site-config.json", DEFAULT_SITE_CONFIG);
}

async function main() {
  const skipSync = process.env.SKIP_SYNC === "1" || process.env.SKIP_SYNC === "true";
  if (skipSync) {
    console.log("[prebuild] SKIP_SYNC enabled; skipping content sync");
    return;
  }

  const filesystemSourceDir = path.join(process.cwd(), "content", "filesystem");
  const hasFilesystem =
    fs.existsSync(path.join(filesystemSourceDir, "site-config.json")) ||
    fs.existsSync(path.join(filesystemSourceDir, "raw")) ||
    fs.existsSync(path.join(filesystemSourceDir, "pages"));
  const source = resolveContentSourceKind();

  if (source === "notion") {
    console.log("[prebuild] Running content sync (notion)...");
    await run("npm", ["run", "sync:content"]);
    return;
  }

  if (hasFilesystem) {
    console.log("[prebuild] Running content sync (filesystem)...");
    await run("npm", ["run", "sync:content"]);
    return;
  }

  // Keep builds usable without a configured content source (local dev / clone mode).
  ensureGeneratedStubs();
  if (process.env.VERCEL) {
    console.warn(
      "[prebuild] VERCEL detected but no content source is configured; skipping content sync.",
    );
  } else {
    console.log("[prebuild] No content source found; skipping content sync.");
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exitCode = 1;
});
