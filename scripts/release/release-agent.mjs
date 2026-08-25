#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createServer } from "node:http";
import { hostname } from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { loadProjectEnv } from "../_lib/load-project-env.mjs";

const ROOT = process.cwd();

export const COMMANDS = {
  status: {
    args: ["run", "release:status:json", "--", "--skip-routes"],
    label: "Release status",
  },
  "smart-release": {
    args: ["run", "release:site"],
    label: "Smart release",
  },
  "runner-self-test": {
    args: ["run", "verify:release-runner", "--", "--skip-job"],
    label: "Release runner self-test",
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
  "publish-content-production": {
    args: ["run", "publish:content:prod"],
    label: "Publish production content",
  },
  "publish-now-production-from-staging": {
    args: ["run", "publish:now:prod:from-staging"],
    label: "Publish Now to live",
  },
};

const CONTENT_PUBLISH_ACTIONS = new Set([
  "publish-content-staging",
  "publish-content-production",
  "publish-content-production-from-staging",
  "publish-now-production-from-staging",
]);

export function releasePhaseForOutput(action, line) {
  if (!CONTENT_PUBLISH_ACTIONS.has(String(action || ""))) return "";
  const message = String(line || "").toLowerCase();
  if (!message.includes("[publish-content]")) return "";
  if (
    message.includes("verifying ") ||
    message.includes("checking ")
  ) {
    return "verify";
  }
  if (
    message.includes("uploading ") ||
    message.includes("deleting ") ||
    message.includes("creating d1 overlay")
  ) {
    return "upload";
  }
  if (message.includes("exporting ")) return "export";
  if (message.includes("running next build")) return "build";
  if (
    message.includes("dumping ") ||
    (message.includes("using ") && message.includes("d1 snapshot")) ||
    message.includes("building content against")
  ) {
    return "prepare-content";
  }
  return "";
}

function parseArgs(argv = process.argv.slice(2)) {
  const valueAfter = (name) => {
    const direct = argv.find((arg) => arg.startsWith(`${name}=`));
    if (direct) return direct.slice(name.length + 1);
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : "";
  };
  const serve =
    argv.includes("--serve") ||
    Boolean(process.env.RELEASE_AGENT_HTTP_PORT || process.env.RELEASE_AGENT_WAKE_TOKEN);
  const pollDefault = serve ? 60_000 : 5_000;
  return {
    once: argv.includes("--once"),
    dryRun: argv.includes("--dry-run"),
    noSync: argv.includes("--no-sync"),
    serve: serve && !argv.includes("--once"),
    httpPort: Math.max(1, Number(valueAfter("--http-port") || process.env.RELEASE_AGENT_HTTP_PORT || 0)),
    pollMs: Math.max(1000, Number(valueAfter("--poll-ms") || process.env.RELEASE_AGENT_POLL_MS || pollDefault)),
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

function jsonResponse(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readJsonBody(req, maxBytes = 4096) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > maxBytes) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function readBearerToken(value) {
  const raw = String(value || "").trim();
  const [scheme, ...rest] = raw.split(/\s+/);
  return scheme?.toLowerCase() === "bearer" ? rest.join(" ").trim() : "";
}

export function isWakeAuthorized(authorization, expectedToken) {
  const expected = String(expectedToken || "").trim();
  if (!expected) return false;
  return readBearerToken(authorization) === expected;
}

export function normalizeWakePayload(payload) {
  const body = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const jobId = String(body.jobId || "").trim().slice(0, 160);
  const action = String(body.action || "").trim();
  if (!jobId) return { ok: false, status: 400, error: "jobId is required." };
  if (!Object.hasOwn(COMMANDS, action)) {
    return { ok: false, status: 400, error: "Unsupported release action." };
  }
  return { ok: true, jobId, action };
}

export function wakeHealthPayload(snapshot, authorization, expectedToken) {
  if (isWakeAuthorized(authorization, expectedToken)) {
    return snapshot && typeof snapshot === "object" ? snapshot : { ok: true };
  }
  return { ok: true };
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

async function getJson(baseUrl, pathName, token, agentId) {
  const res = await fetch(`${baseUrl}${pathName}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Release-Agent-Id": agentId,
    },
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

async function claim(baseUrl, token, agentId, preferredJobId = "") {
  const body = {
    agentId,
    capabilities: Object.keys(COMMANDS),
  };
  if (preferredJobId) body.preferredJobId = preferredJobId;
  const payload = await postJson(baseUrl, "/api/site-admin/release-jobs/claim", token, agentId, body);
  const data = payload.data && typeof payload.data === "object" ? payload.data : payload;
  const job = data.job && typeof data.job === "object" ? data.job : null;
  return job;
}

async function complete(baseUrl, token, agentId, jobId, body) {
  await postJson(baseUrl, `/api/site-admin/release-jobs/${jobId}/complete`, token, agentId, body);
}

// Any status that is not queued/running means the control plane has already
// closed this job out. Watching only for "canceled" let a job the API had
// declared stale (status='failed') keep deploying: its completion was then
// discarded by the `WHERE status='running'` guard, the operator saw a failure,
// hit Retry, and two releases raced over the same repo and Worker.
const TERMINAL_RELEASE_STATUSES = new Set(["succeeded", "failed", "canceled"]);

export function releaseJobAbortStatus(payload) {
  const data =
    payload && typeof payload.data === "object" && payload.data !== null
      ? payload.data
      : payload;
  const job = data && typeof data.job === "object" && data.job !== null ? data.job : null;
  const status = String(job?.status || "").trim();
  return TERMINAL_RELEASE_STATUSES.has(status) ? status : "";
}

async function jobAbortStatus(baseUrl, token, agentId, jobId) {
  const payload = await getJson(
    baseUrl,
    `/api/site-admin/release-jobs/${jobId}/agent`,
    token,
    agentId,
  );
  return releaseJobAbortStatus(payload);
}

function runRunnerGit({ args, onLine, repo, spawnSyncImpl }) {
  const result = spawnSyncImpl("git", args, {
    cwd: repo,
    encoding: "utf8",
    env: process.env,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    onLine("status", line);
  }
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed with status ${result.status}`);
  }
  return output;
}

export function syncRepo({
  repo,
  jobId = "manual",
  onLine,
  spawnSyncImpl = spawnSync,
  fsImpl = fs,
}) {
  // The long-lived clone is an object/dependency cache, not an execution
  // worktree. Content builds can materialize D1 files and generated indexes;
  // running the next job in that same tree makes harmless leftovers block all
  // future publishes. A fresh local clone keeps every job on canonical main
  // without resetting or deleting anything in the runner's persistent tree.
  onLine("status", "Preparing isolated release source from origin/main");
  runRunnerGit({
    args: ["fetch", "--prune", "origin", "main"],
    onLine,
    repo,
    spawnSyncImpl,
  });
  const canonicalSha = runRunnerGit({
    args: ["rev-parse", "origin/main"],
    onLine: () => undefined,
    repo,
    spawnSyncImpl,
  }).trim();
  const remoteUrl = runRunnerGit({
    args: ["remote", "get-url", "origin"],
    onLine: () => undefined,
    repo,
    spawnSyncImpl,
  }).trim();
  const safeJobId = String(jobId || "manual").replace(/[^a-z0-9._-]+/gi, "-");
  const executionParent = path.join(repo, ".cache", "release", "agent-execution");
  const executionRepo = path.join(executionParent, safeJobId);
  fsImpl.mkdirSync(executionParent, { recursive: true });
  fsImpl.rmSync(executionRepo, { force: true, recursive: true });

  try {
    runRunnerGit({
      args: ["clone", "--shared", "--no-checkout", repo, executionRepo],
      onLine,
      repo,
      spawnSyncImpl,
    });
    runRunnerGit({
      args: ["switch", "-C", "main", canonicalSha],
      onLine,
      repo: executionRepo,
      spawnSyncImpl,
    });
    runRunnerGit({
      args: ["remote", "set-url", "origin", remoteUrl],
      onLine: () => undefined,
      repo: executionRepo,
      spawnSyncImpl,
    });

    const nodeModules = path.join(repo, "node_modules");
    if (!fsImpl.existsSync(nodeModules)) {
      throw new Error("Release runner dependencies are missing; node_modules was not found.");
    }
    fsImpl.symlinkSync(nodeModules, path.join(executionRepo, "node_modules"), "dir");
    onLine("status", `Release runner source: main ${canonicalSha.slice(0, 12)} (isolated)`);
  } catch (error) {
    fsImpl.rmSync(executionRepo, { force: true, recursive: true });
    throw error;
  }

  return {
    repo: executionRepo,
    cleanup() {
      fsImpl.rmSync(executionRepo, { force: true, recursive: true });
    },
  };
}

export function runCommand({ action, repo, dryRun, onLine, abortStatus, spawnImpl = spawn }) {
  const command = COMMANDS[action];
  if (!command) throw new Error(`Unsupported release action: ${action}`);
  if (dryRun) {
    onLine("status", `[dry-run] would run: npm ${command.args.join(" ")}`);
    return Promise.resolve({ code: 0, tail: [`[dry-run] npm ${command.args.join(" ")}`] });
  }
  return new Promise((resolve, reject) => {
    const tail = [];
    let aborted = "";
    let cancelTimer;
    let finished = false;
    const proc = spawnImpl("npm", command.args, {
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

    const checkAbort = async () => {
      if (finished || aborted || !abortStatus) return;
      try {
        const status = await abortStatus();
        if (!status) return;
        aborted = status;
        const message = `Release job is ${status}; terminating command.`;
        tailPush(tail, message);
        onLine("status", message);
        proc.kill("SIGTERM");
        // The live child keeps the loop alive on its own; unref so the escalation
        // timer never becomes the last thing holding the runner open.
        setTimeout(() => {
          if (!finished) proc.kill("SIGKILL");
        }, 5_000).unref?.();
      } catch (error) {
        console.error(`[release-agent] abort check failed: ${error?.message || error}`);
      }
    };
    cancelTimer = setInterval(() => void checkAbort(), 2_500);
    if (cancelTimer.unref) cancelTimer.unref();
    void checkAbort();

    proc.on("error", (error) => {
      finished = true;
      if (cancelTimer) clearInterval(cancelTimer);
      reject(error);
    });
    proc.on("exit", (code) => {
      finished = true;
      if (cancelTimer) clearInterval(cancelTimer);
      resolve({ aborted, code: aborted ? 130 : code ?? 1, tail });
    });
  });
}

async function runJob({ baseUrl, token, agentId, repo, dryRun, noSync, job }) {
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
  let eventQueue = Promise.resolve();
  let runningPhase = "running";
  const pushLine = (phase) => (stream, line) => {
    if (phase === "running") {
      runningPhase = releasePhaseForOutput(action, line) || runningPhase;
    }
    const nextPhase = phase === "running" ? runningPhase : phase;
    eventQueue = eventQueue.then(() =>
      safePostEvent(baseUrl, token, agentId, id, {
        phase: nextPhase,
        stream,
        message: redact(line),
      }),
    );
  };
  let executionRepo = repo;
  let cleanupExecutionRepo = () => undefined;
  try {
    if (!noSync) {
      const execution = syncRepo({
        repo,
        jobId: id,
        onLine: pushLine("sync"),
      });
      executionRepo = execution.repo;
      cleanupExecutionRepo = execution.cleanup;
    }
    const result = await runCommand({
      action,
      repo: executionRepo,
      dryRun,
      abortStatus: () => jobAbortStatus(baseUrl, token, agentId, id),
      onLine: pushLine("running"),
    });
    await eventQueue;
    const durationMs = Date.now() - started;
    const ok = result.code === 0;
    await complete(baseUrl, token, agentId, id, {
      status: result.aborted || (ok ? "succeeded" : "failed"),
      error: result.aborted
        ? `Release job was already ${result.aborted}; the runner stopped the command.`
        : ok
          ? ""
          : `Command exited with status ${result.code}.`,
      result: {
        action,
        command: `npm ${command.args.join(" ")}`,
        durationMs,
        exitCode: result.code,
        stdoutTail: result.tail.slice(-80).map(redact).join("\n"),
      },
    });
    return ok;
  } catch (error) {
    await eventQueue;
    const durationMs = Date.now() - started;
    const message = error?.message || String(error);
    await safePostEvent(baseUrl, token, agentId, id, {
      phase: "failed",
      stream: "stderr",
      message: redact(message),
    });
    await complete(baseUrl, token, agentId, id, {
      status: "failed",
      error: redact(message),
      result: {
        action,
        command: `npm ${command.args.join(" ")}`,
        durationMs,
        exitCode: 1,
        stdoutTail: redact(message),
      },
    });
    return false;
  } finally {
    cleanupExecutionRepo();
  }
}

export function createRunnerController({ baseUrl, token, agentId, repo, dryRun, noSync, claimImpl = claim, runJobImpl = runJob }) {
  let currentJobId = "";
  let currentAction = "";
  // `currentJobId` can only be set once the claim resolves, so the poll loop
  // and a wake request could both pass the busy check and hand this one runner
  // two jobs to deploy at the same time. Claims therefore queue behind each
  // other and reserve the runner before the next one is allowed to start.
  let claimGate = Promise.resolve();

  const claimExclusive = (preferredJobId = "") => {
    const claimed = claimGate.then(async () => {
      if (currentJobId) return null;
      const job = await claimImpl(baseUrl, token, agentId, preferredJobId);
      if (job) currentJobId = String(job.id || "");
      return job;
    });
    claimGate = claimed.then(
      () => undefined,
      () => undefined,
    );
    return claimed;
  };

  const runClaimedJob = (job) => {
    currentJobId = String(job.id || "");
    currentAction = String(job.action || "");
    return runJobImpl({
      baseUrl,
      token,
      agentId,
      repo,
      dryRun,
      noSync,
      job,
    }).finally(() => {
      currentJobId = "";
      currentAction = "";
    });
  };

  const startPreferredJob = async ({ action, jobId }) => {
    if (currentJobId) {
      return {
        error: `Runner is busy with ${currentJobId}.`,
        ok: false,
        status: 409,
      };
    }
    const job = await claimExclusive(jobId);
    if (!job) {
      // A poll-loop claim that was already in flight when this request arrived
      // wins the gate; report that as busy rather than "job not found".
      if (currentJobId) {
        return {
          error: `Runner is busy with ${currentJobId}.`,
          ok: false,
          status: 409,
        };
      }
      return {
        error: "Queued release job was not found or is not claimable by this runner.",
        ok: false,
        status: 404,
      };
    }
    if (String(job.action || "") !== action) {
      // The reservation taken by claimExclusive has to be handed back, or the
      // runner stays "busy" with a job it is never going to run.
      currentJobId = "";
      return {
        error: "Claimed release job action does not match the wake request.",
        ok: false,
        status: 409,
      };
    }
    void runClaimedJob(job).catch((error) => {
      console.error(`[release-agent] wake job failed: ${error?.stack || error}`);
    });
    return { jobId: String(job.id || ""), ok: true, status: 202 };
  };

  const drainNextJob = async () => {
    if (currentJobId) return false;
    const job = await claimExclusive();
    if (!job) return false;
    console.log(`[release-agent] claimed ${job.id} action=${job.action}`);
    await runClaimedJob(job);
    return true;
  };

  const snapshot = () => ({
    agentId,
    busy: Boolean(currentJobId),
    currentAction,
    currentJobId,
    ok: true,
  });

  return { drainNextJob, snapshot, startPreferredJob };
}

function startWakeServer({ controller, port, wakeToken }) {
  if (!port) {
    console.log("[release-agent] wake server disabled: RELEASE_AGENT_HTTP_PORT is not set");
    return null;
  }
  if (!wakeToken) {
    console.log("[release-agent] wake server disabled: RELEASE_AGENT_WAKE_TOKEN is not set");
    return null;
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/health") {
      jsonResponse(res, 200, wakeHealthPayload(controller.snapshot(), req.headers.authorization, wakeToken));
      return;
    }
    if (req.method !== "POST" || url.pathname !== "/wake") {
      jsonResponse(res, 404, { error: "Not found", ok: false });
      return;
    }
    if (!isWakeAuthorized(req.headers.authorization, wakeToken)) {
      jsonResponse(res, 401, { error: "Unauthorized", ok: false });
      return;
    }
    let payload;
    try {
      payload = await readJsonBody(req);
    } catch (error) {
      jsonResponse(res, 400, { error: error?.message || String(error), ok: false });
      return;
    }
    const normalized = normalizeWakePayload(payload);
    if (!normalized.ok) {
      jsonResponse(res, normalized.status, { error: normalized.error, ok: false });
      return;
    }
    try {
      const result = await controller.startPreferredJob(normalized);
      jsonResponse(res, result.status, result);
    } catch (error) {
      jsonResponse(res, 502, { error: error?.message || String(error), ok: false });
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`[release-agent] wake server listening on 127.0.0.1:${port}`);
  });
  return server;
}

async function main() {
  loadProjectEnv({ cwd: ROOT, override: false, files: [".env.local", ".env"] });
  const args = parseArgs();
  const baseUrl = normalizeBaseUrl(
    readEnv("RELEASE_AGENT_BASE_URL") || "https://staging.jinkunchen.com",
  );
  const token = requiredEnv("SITE_ADMIN_RELEASE_AGENT_TOKEN");
  const agentId = readEnv("RELEASE_AGENT_ID") || `${hostname()}:${process.pid}`;
  const controller = createRunnerController({
    baseUrl,
    token,
    agentId,
    repo: args.repo,
    dryRun: args.dryRun,
    noSync: args.noSync,
  });
  console.log(`[release-agent] base=${baseUrl} repo=${args.repo} agent=${agentId} pollMs=${args.pollMs}`);
  if (args.serve) {
    startWakeServer({
      controller,
      port: args.httpPort,
      wakeToken: readEnv("RELEASE_AGENT_WAKE_TOKEN"),
    });
  }

  do {
    const drained = await controller.drainNextJob();
    if (!drained && args.once) {
      console.log("[release-agent] no queued job");
    } else if (!drained) {
      await delay(args.pollMs);
    }
  } while (!args.once);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error?.stack || String(error));
    process.exit(1);
  });
}
