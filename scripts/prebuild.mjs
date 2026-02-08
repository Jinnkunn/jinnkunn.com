import { spawn } from "node:child_process";

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

