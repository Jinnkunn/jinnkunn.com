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
  writeIfMissing("sync-meta.json", { syncedAt: "1970-01-01T00:00:00.000Z" });
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

function resolveMode() {
  // Explicit env always wins. When unset, infer `db` from
  // SITE_ADMIN_STORAGE=db so users only need one knob to flip the whole
  // content pipeline; everything else falls through to the legacy `stubs`
  // default.
  const explicit = String(process.env.CONTENT_SYNC_MODE || "").trim().toLowerCase();
  if (explicit === "notion" || explicit === "stubs" || explicit === "db") {
    return explicit;
  }
  const storage = String(process.env.SITE_ADMIN_STORAGE || "").trim().toLowerCase();
  if (storage === "db") return "db";
  return "stubs";
}

async function dumpFromD1() {
  // Pass through the deploy env + location so the same prebuild can target
  // dev / staging / production D1 instances. Defaults (no env, --remote)
  // match `npm run build` from a developer machine.
  const args = ["scripts/dump-content-from-db.mjs"];
  const envName = String(process.env.SITE_ADMIN_DB_ENV || "").trim();
  if (envName) args.push(`--env=${envName}`);
  const location = String(process.env.SITE_ADMIN_DB_LOCATION || "remote").trim().toLowerCase();
  if (location === "local") args.push("--local");
  else args.push("--remote");
  args.push("--quiet");
  await run("node", args);
}

async function main() {
  const skipSync = process.env.SKIP_SYNC === "1" || process.env.SKIP_SYNC === "true";
  if (skipSync) {
    console.log("[prebuild] SKIP_SYNC enabled; skipping content sync");
    return;
  }

  const mode = resolveMode();

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

  if (mode === "db") {
    console.log("[prebuild] CONTENT_SYNC_MODE=db; dumping content from D1...");
    await dumpFromD1();
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
