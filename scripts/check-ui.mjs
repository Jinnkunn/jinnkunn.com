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
  // UI regression sequence:
  // 1) E2E smoke checks for key interactions
  // 2) representative accessibility checks in light/dark themes
  // 3) UI snapshots for visual regression
  const skipSync = process.env.SKIP_SYNC === "1" || process.env.SKIP_SYNC === "true";

  if (!skipSync) {
    const hasNotion =
      Boolean(process.env.NOTION_TOKEN) && Boolean(process.env.NOTION_SITE_ADMIN_PAGE_ID);
    if (hasNotion) {
      await run("npm", ["run", "sync:notion"]);
    }
  } else {
    console.log("[check:ui] SKIP_SYNC enabled; skipping content sync");
  }

  await run("npm", ["run", "smoke:ui"]);
  await run("npm", ["run", "check:a11y"]);
  await run("npm", ["run", "snapshot:ui"]);

  const doCompare =
    process.env.CHECK_COMPARE === "1" || process.env.CHECK_COMPARE === "true";
  if (doCompare) {
    await run("npm", ["run", "snapshot:compare"]);
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
