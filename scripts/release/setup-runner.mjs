#!/usr/bin/env node

// Provision (or verify) the Mac mini release runner from versioned templates,
// so a dead machine is an hour of restore instead of an archaeology project.
//
// What it manages:
//   - ~/Library/LaunchAgents/com.jinnkunn.release-runner.plist        (agent)
//   - ~/Library/LaunchAgents/com.jinnkunn.release-runner-tunnel.plist (tunnel)
//     both rendered from scripts/release/launchd/*.plist.template
//   - launchctl bootstrap/enable/kickstart for both agents
//   - the runner log directory
//   - presence checks for every required env key (names only, never values —
//     see docs/runbooks/runner-secrets.md for where to re-issue each one)
//   - a warning when system sleep would take the runner offline
//
// Usage (on the runner machine):
//   node scripts/release/setup-runner.mjs                # install + (re)load
//   node scripts/release/setup-runner.mjs --check        # verify only
//   node scripts/release/setup-runner.mjs --repo=/path   # runner repo override
//
// Secrets are never written by this script; the agent reads them from the
// runner repo's .env/.env.local at start.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const TEMPLATE_DIR = path.join(__dirname, "launchd");
const AGENT_LABEL = "com.jinnkunn.release-runner";
const TUNNEL_LABEL = "com.jinnkunn.release-runner-tunnel";

// Required for the agent to claim and execute jobs at all.
const REQUIRED_ENV_KEYS = [
  "SITE_ADMIN_RELEASE_AGENT_TOKEN",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
];
// Required for the wake path + runner self-verification; the agent still
// polls without them, so these warn instead of failing.
const RECOMMENDED_ENV_KEYS = [
  "RELEASE_AGENT_HTTP_PORT",
  "RELEASE_AGENT_WAKE_TOKEN",
  "RELEASE_RUNNER_CF_ACCESS_CLIENT_ID",
  "RELEASE_RUNNER_CF_ACCESS_CLIENT_SECRET",
  "RELEASE_RUNNER_WAKE_TOKEN",
  "RELEASE_RUNNER_WAKE_URL",
  "NEXTAUTH_SECRET",
  "RELEASE_RUNNER_HOST",
];

function parseArgs(argv = process.argv.slice(2)) {
  const value = (name) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) || "";
  return {
    check: argv.includes("--check"),
    repo: path.resolve(value("repo") || process.env.RELEASE_AGENT_REPO || ROOT),
    nodeBin: value("node") || process.execPath,
    cloudflaredBin: value("cloudflared") || which("cloudflared"),
    tunnelName: value("tunnel") || "jinnkunn-release-runner",
  };
}

function which(bin) {
  const result = spawnSync("which", [bin], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0 ? result.stdout.trim() : "";
}

function log(message) {
  console.log(`[setup-runner] ${message}`);
}

function warn(message) {
  console.warn(`[setup-runner] warning: ${message}`);
}

function renderTemplate(name, substitutions) {
  const raw = fs.readFileSync(path.join(TEMPLATE_DIR, name), "utf8");
  return raw.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => {
    if (!(key in substitutions)) throw new Error(`template ${name} uses unknown key ${key}`);
    return substitutions[key];
  });
}

function envKeysPresent(repo) {
  const present = new Set();
  for (const file of [".env", ".env.local"]) {
    let raw = "";
    try {
      raw = fs.readFileSync(path.join(repo, file), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(line.trim());
      if (match && match[2].trim()) present.add(match[1]);
    }
  }
  return present;
}

function checkEnvKeys(repo) {
  const present = envKeysPresent(repo);
  const missingRequired = REQUIRED_ENV_KEYS.filter((key) => !present.has(key));
  const missingRecommended = RECOMMENDED_ENV_KEYS.filter((key) => !present.has(key));
  for (const key of REQUIRED_ENV_KEYS.filter((k) => present.has(k))) {
    log(`env ok: ${key}`);
  }
  if (missingRecommended.length > 0) {
    warn(
      `recommended env keys missing from ${repo}/.env(.local): ${missingRecommended.join(", ")} — see docs/runbooks/runner-secrets.md`,
    );
  }
  if (missingRequired.length > 0) {
    throw new Error(
      `required env keys missing from ${repo}/.env(.local): ${missingRequired.join(", ")} — re-issue them per docs/runbooks/runner-secrets.md`,
    );
  }
}

function checkSleepSettings() {
  const result = spawnSync("pmset", ["-g", "custom"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    warn("could not read pmset settings; verify manually that system sleep is disabled");
    return;
  }
  const sleepLines = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^sleep\s+\d+/.test(line));
  const sleepy = sleepLines.some((line) => Number(line.split(/\s+/)[1]) !== 0);
  if (sleepy) {
    warn(
      "system sleep is enabled — a sleeping runner misses wakes until the next poll after it resumes. Fix (needs admin): sudo pmset -c sleep 0",
    );
  } else if (sleepLines.length > 0) {
    log("pmset: system sleep disabled");
  }
}

function launchctl(args, { allowFailure = false } = {}) {
  const result = spawnSync("launchctl", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(
      `launchctl ${args.join(" ")} failed: ${(result.stderr || result.stdout || "").trim()}`,
    );
  }
  return result.status === 0;
}

function agentLoaded(uid, label) {
  return spawnSync("launchctl", ["print", `gui/${uid}/${label}`], { stdio: "ignore" }).status === 0;
}

function installAgent({ uid, label, plistPath, rendered, check }) {
  const current = fs.existsSync(plistPath) ? fs.readFileSync(plistPath, "utf8") : "";
  const upToDate = current === rendered;
  const loaded = agentLoaded(uid, label);
  if (check) {
    if (!upToDate) throw new Error(`${label}: installed plist differs from template render (or is missing). Run without --check to install.`);
    if (!loaded) throw new Error(`${label}: LaunchAgent is not loaded. Run without --check to bootstrap it.`);
    log(`${label}: plist up to date and loaded`);
    return;
  }
  if (!upToDate) {
    fs.mkdirSync(path.dirname(plistPath), { recursive: true });
    fs.writeFileSync(plistPath, rendered, "utf8");
    log(`${label}: wrote ${plistPath}`);
  } else {
    log(`${label}: plist already up to date`);
  }
  // Reload so a changed plist takes effect; bootout is expected to fail when
  // the agent was never loaded.
  launchctl(["bootout", `gui/${uid}/${label}`], { allowFailure: true });
  launchctl(["bootstrap", `gui/${uid}`, plistPath]);
  launchctl(["enable", `gui/${uid}/${label}`], { allowFailure: true });
  launchctl(["kickstart", "-k", `gui/${uid}/${label}`], { allowFailure: true });
  if (!agentLoaded(uid, label)) {
    throw new Error(`${label}: bootstrap reported success but the agent is not loaded`);
  }
  log(`${label}: loaded and kickstarted`);
}

function main() {
  const args = parseArgs();
  if (process.platform !== "darwin") {
    throw new Error("setup-runner manages macOS LaunchAgents; run it on the runner machine");
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : 501;
  const home = os.homedir();
  const logDir = path.join(home, "Services", "jinnkunn-release-runner", "logs");
  const agentsDir = path.join(home, "Library", "LaunchAgents");

  log(`repo: ${args.repo}`);
  if (!fs.existsSync(path.join(args.repo, "scripts", "release", "release-agent.mjs"))) {
    throw new Error(`${args.repo} does not look like the runner repo (missing scripts/release/release-agent.mjs)`);
  }
  if (!fs.existsSync(path.join(args.repo, "node_modules"))) {
    warn(`${args.repo}/node_modules is missing — run \`npm ci\` there before the first job`);
  }
  checkEnvKeys(args.repo);
  checkSleepSettings();
  if (!args.check) fs.mkdirSync(logDir, { recursive: true });

  const pathLine = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
    .concat(path.dirname(args.nodeBin))
    .filter((entry, index, all) => entry && all.indexOf(entry) === index)
    .join(":");

  installAgent({
    uid,
    label: AGENT_LABEL,
    plistPath: path.join(agentsDir, `${AGENT_LABEL}.plist`),
    rendered: renderTemplate(`${AGENT_LABEL}.plist.template`, {
      NODE_BIN: args.nodeBin,
      REPO_ROOT: args.repo,
      LOG_DIR: logDir,
      PATH_LINE: pathLine,
      HOME: home,
    }),
    check: args.check,
  });

  if (!args.cloudflaredBin) {
    warn(
      "cloudflared not found — the wake tunnel LaunchAgent was skipped. Install cloudflared (brew install cloudflared), authenticate the tunnel, then re-run. The agent still claims jobs via its poll loop.",
    );
  } else {
    installAgent({
      uid,
      label: TUNNEL_LABEL,
      plistPath: path.join(agentsDir, `${TUNNEL_LABEL}.plist`),
      rendered: renderTemplate(`${TUNNEL_LABEL}.plist.template`, {
        CLOUDFLARED_BIN: args.cloudflaredBin,
        TUNNEL_NAME: args.tunnelName,
        LOG_DIR: logDir,
        HOME: home,
      }),
      check: args.check,
    });
  }

  log(
    args.check
      ? "check passed"
      : "done. Verify end-to-end with: npm run verify:release-runner",
  );
}

try {
  main();
} catch (error) {
  console.error(`[setup-runner] ${error?.message || error}`);
  process.exit(1);
}
