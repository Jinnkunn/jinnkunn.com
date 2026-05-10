#!/usr/bin/env node

import { spawn } from "node:child_process";
import { hostname } from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";

import { loadProjectEnv } from "./load-project-env.mjs";

const ROOT = process.cwd();

const COMMANDS = {
  status: {
    args: ["run", "release:status:json", "--", "--skip-routes"],
    label: "Release status",
  },
  "smart-release": {
    args: ["run", "release:site"],
    label: "Smart release",
  },
  "publish-content-staging": {
    args: ["run", "publish:content:staging"],
    label: "Publish staging content",
  },
  "deploy-staging-code": {
    args: ["run", "release:staging"],
    label: "Deploy staging code",
  },
  "promote-production-code": {
    args: ["run", "release:prod:from-staging"],
    label: "Promote production code",
  },
  "publish-content-production-from-staging": {
    args: ["run", "publish:content:prod:from-staging"],
    label: "Publish production content from staging",
  },
};

function parseArgs(argv = process.argv.slice(2)) {
  const valueAfter = (name) => {
    const direct = argv.find((arg) => arg.startsWith(`${name}=`));
    if (direct) return direct.slice(name.length + 1);
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : "";
  };
  return {
    once: argv.includes("--once"),
    dryRun: argv.includes("--dry-run"),
    pollMs: Math.max(1000, Number(valueAfter("--poll-ms") || process.env.RELEASE_AGENT_POLL_MS || 5000)),
    repo: path.resolve(valueAfter("--repo") || process.env.RELEASE_AGENT_REPO || ROOT),
  };
}

function readEnv(name) {
  return String(process.env[name] || "").trim();
}

function requiredEnv(name) {
  const value = readEnv(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function normalizeBaseUrl(value) {
  const url = String(value || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) throw new Error("RELEASE_AGENT_BASE_URL must be an http(s) URL");
  return url;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tailPush(lines, line, max = 120) {
  lines.push(line);
  while (lines.length > max) lines.shift();
}

function redactor() {
  const secrets = [
    "SITE_ADMIN_RELEASE_AGENT_TOKEN",
    "CLOUDFLARE_API_TOKEN",
    "CF_API_TOKEN",
    "DEPLOY_TOKEN",
    "NEXTAUTH_SECRET",
    "AUTH_SECRET",
    "SITE_ADMIN_APP_TOKEN_SECRET",
  ]
    .map(readEnv)
    .filter((value) => value.length >= 8);
  return (line) => {
    let out = String(line || "");
    for (const secret of secrets) {
      out = out.split(secret).join("[redacted]");
    }
    return out;
  };
}

async function postJson(baseUrl, pathName, token, agentId, body) {
  const res = await fetch(`${baseUrl}${pathName}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Release-Agent-Id": agentId,
    },
    body: JSON.stringify(body || {}),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      payload && typeof payload === "object" && "error" in payload
        ? String(payload.error)
        : `HTTP ${res.status}`;
    throw new Error(detail);
  }
  return payload && typeof payload === "object" ? payload : {};
}

async function safePostEvent(baseUrl, token, agentId, jobId, event) {
  try {
    await postJson(baseUrl, `/api/site-admin/release-jobs/${jobId}/events`, token, agentId, event);
  } catch (error) {
    console.error(`[release-agent] failed to post event: ${error?.message || error}`);
  }
}

async function claim(baseUrl, token, agentId) {
  const payload = await postJson(baseUrl, "/api/site-admin/release-jobs/claim", token, agentId, {
    agentId,
    capabilities: Object.keys(COMMANDS),
  });
  const data = payload.data && typeof payload.data === "object" ? payload.data : payload;
  const job = data.job && typeof data.job === "object" ? data.job : null;
  return job;
}

async function complete(baseUrl, token, agentId, jobId, body) {
  await postJson(baseUrl, `/api/site-admin/release-jobs/${jobId}/complete`, token, agentId, body);
}

function runCommand({ action, repo, dryRun, onLine }) {
  const command = COMMANDS[action];
  if (!command) throw new Error(`Unsupported release action: ${action}`);
  if (dryRun) {
    onLine("status", `[dry-run] would run: npm ${command.args.join(" ")}`);
    return Promise.resolve({ code: 0, tail: [`[dry-run] npm ${command.args.join(" ")}`] });
  }
  return new Promise((resolve, reject) => {
    const tail = [];
    const proc = spawn("npm", command.args, {
      cwd: repo,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const read = (stream, label) => {
      const rl = readline.createInterface({ input: stream });
      rl.on("line", (line) => {
        tailPush(tail, line);
        onLine(label, line);
      });
    };
    read(proc.stdout, "stdout");
    read(proc.stderr, "stderr");

    proc.on("error", reject);
    proc.on("exit", (code) => {
      resolve({ code: code ?? 1, tail });
    });
  });
}

async function runJob({ baseUrl, token, agentId, repo, dryRun, job }) {
  const id = String(job.id || "");
  const action = String(job.action || "");
  const redact = redactor();
  const command = COMMANDS[action];
  if (!id || !command) throw new Error("Claimed malformed release job");
  await safePostEvent(baseUrl, token, agentId, id, {
    phase: "starting",
    stream: "status",
    message: `${command.label}: npm ${command.args.join(" ")}`,
  });
  const started = Date.now();
  const result = await runCommand({
    action,
    repo,
    dryRun,
    onLine: (stream, line) => {
      void safePostEvent(baseUrl, token, agentId, id, {
        phase: "running",
        stream,
        message: redact(line),
      });
    },
  });
  const durationMs = Date.now() - started;
  const ok = result.code === 0;
  await complete(baseUrl, token, agentId, id, {
    status: ok ? "succeeded" : "failed",
    error: ok ? "" : `Command exited with status ${result.code}.`,
    result: {
      action,
      command: `npm ${command.args.join(" ")}`,
      durationMs,
      exitCode: result.code,
      stdoutTail: result.tail.slice(-80).map(redact).join("\n"),
    },
  });
  return ok;
}

async function main() {
  loadProjectEnv({ cwd: ROOT, override: false, files: [".env.local", ".env"] });
  const args = parseArgs();
  const baseUrl = normalizeBaseUrl(
    readEnv("RELEASE_AGENT_BASE_URL") || "https://staging.jinkunchen.com",
  );
  const token = requiredEnv("SITE_ADMIN_RELEASE_AGENT_TOKEN");
  const agentId = readEnv("RELEASE_AGENT_ID") || `${hostname()}:${process.pid}`;
  console.log(`[release-agent] base=${baseUrl} repo=${args.repo} agent=${agentId}`);

  do {
    const job = await claim(baseUrl, token, agentId);
    if (job) {
      console.log(`[release-agent] claimed ${job.id} action=${job.action}`);
      await runJob({ baseUrl, token, agentId, repo: args.repo, dryRun: args.dryRun, job });
    } else if (args.once) {
      console.log("[release-agent] no queued job");
    } else {
      await delay(args.pollMs);
    }
  } while (!args.once);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});

