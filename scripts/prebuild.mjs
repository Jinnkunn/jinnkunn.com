import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { DEFAULT_SITE_CONFIG } from "../lib/shared/default-site-config.mjs";

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
  // even when NOTION_* is not configured.
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

  const modeRaw = String(process.env.CONTENT_SYNC_MODE || "stubs").trim().toLowerCase();
  const mode =
    modeRaw === "notion" || modeRaw === "stubs" ? modeRaw : "stubs";

  if (mode === "notion") {
    const hasNotion =
      Boolean(process.env.NOTION_TOKEN) && Boolean(process.env.NOTION_SITE_ADMIN_PAGE_ID);
    if (!hasNotion) {
      throw new Error(
        "CONTENT_SYNC_MODE=notion requires NOTION_TOKEN and NOTION_SITE_ADMIN_PAGE_ID",
      );
    }
    console.log("[prebuild] CONTENT_SYNC_MODE=notion; running Notion sync...");
    await run("npm", ["run", "sync:notion"]);
    return;
  }

  ensureGeneratedStubs();
  console.log("[prebuild] CONTENT_SYNC_MODE=stubs; ensured generated stubs.");
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exitCode = 1;
});
