import { spawn } from "node:child_process";
import crypto from "node:crypto";
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
  writeIfMissing("classic-css-assets.json", { source: "", stylesheets: [] });
  writeIfMissing("site-config.json", DEFAULT_SITE_CONFIG);
}

function sha1Hex(input) {
  return crypto.createHash("sha1").update(input, "utf8").digest("hex");
}

function gitBlobSha(input) {
  const header = `blob ${Buffer.byteLength(input, "utf8")}\0`;
  return crypto.createHash("sha1").update(header, "utf8").update(input, "utf8").digest("hex");
}

function writeIfChanged(file, obj) {
  const next = `${JSON.stringify(obj, null, 2)}\n`;
  try {
    if (fs.readFileSync(file, "utf8") === next) return;
  } catch {
    // ignore
  }
  fs.writeFileSync(file, next, "utf8");
}

function writeComponentSourceManifest() {
  const root = process.cwd();
  const componentsDir = path.join(root, "content", "components");
  const generatedDir = path.join(root, "content", "generated");
  fs.mkdirSync(generatedDir, { recursive: true });
  const components = {};
  let names = [];
  try {
    names = fs
      .readdirSync(componentsDir)
      .filter((name) => name.endsWith(".mdx"))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    names = [];
  }
  for (const filename of names) {
    const name = filename.replace(/\.mdx$/, "");
    const relPath = `content/components/${filename}`;
    const content = fs.readFileSync(path.join(componentsDir, filename), "utf8");
    components[name] = {
      path: relPath,
      sha: gitBlobSha(content),
      contentSha: sha1Hex(content),
      size: Buffer.byteLength(content, "utf8"),
    };
  }
  writeIfChanged(path.join(generatedDir, "component-sources.json"), {
    components,
  });
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
    ensureGeneratedStubs();
    writeComponentSourceManifest();
    return;
  }

  ensureGeneratedStubs();
  writeComponentSourceManifest();
  console.log("[prebuild] CONTENT_SYNC_MODE=stubs; ensured generated stubs.");
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exitCode = 1;
});
