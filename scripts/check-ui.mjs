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
  // A single command to keep the clone stable over time.
  // Default sequence:
  // 1) sync raw hydrated HTML from the live Super site
  // 2) audit which Notion/Super block classes are in use
  // 3) run E2E smoke checks for key interactions
  // 4) take UI snapshots for visual regression
  const skipSync = process.env.SKIP_SYNC === "1" || process.env.SKIP_SYNC === "true";

  if (!skipSync) {
    await run("npm", ["run", "sync:raw"]);
  } else {
    console.log("[check:ui] SKIP_SYNC enabled; skipping `npm run sync:raw`");
  }

  await run("npm", ["run", "audit:notion"]);
  await run("npm", ["run", "smoke:ui"]);
  await run("npm", ["run", "snapshot:ui"]);
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

