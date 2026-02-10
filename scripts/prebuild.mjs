import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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
  writeIfMissing("site-config.json", {
    siteName: "Jinkun Chen.",
    lang: "en",
    seo: {
      title: "Jinkun Chen",
      description:
        "Jinkun Chen (he/him/his) - Ph.D. student studying Computer Science at Dalhousie University.",
      favicon: "/assets/favicon.png",
    },
    integrations: {},
    security: {
      contentGithubUsers: [],
    },
    nav: {
      top: [
        { href: "/", label: "Home" },
        { href: "/news", label: "News" },
        { href: "/publications", label: "Publications" },
        { href: "/works", label: "Works" },
      ],
      more: [
        { href: "/blog", label: "Blog" },
        { href: "/teaching", label: "Teaching" },
        { href: "/bio", label: "BIO" },
        { href: "/notice", label: "Notice" },
      ],
    },
  });
}

async function main() {
  const skipSync = process.env.SKIP_SYNC === "1" || process.env.SKIP_SYNC === "true";
  if (skipSync) {
    console.log("[prebuild] SKIP_SYNC enabled; skipping content sync");
    return;
  }

  const hasNotion =
    Boolean(process.env.NOTION_TOKEN) && Boolean(process.env.NOTION_SITE_ADMIN_PAGE_ID);

  if (hasNotion) {
    console.log("[prebuild] Running Notion sync...");
    await run("npm", ["run", "sync:notion"]);
    return;
  }

  // Keep builds usable without Notion credentials (local dev / clone mode).
  // On Vercel, missing NOTION_* is almost certainly misconfiguration.
  ensureGeneratedStubs();
  if (process.env.VERCEL) {
    console.warn(
      "[prebuild] VERCEL detected but NOTION_TOKEN/NOTION_SITE_ADMIN_PAGE_ID are missing; skipping Notion sync.",
    );
  } else {
    console.log("[prebuild] No Notion config found; skipping Notion sync.");
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exitCode = 1;
});
