import test from "node:test";
import assert from "node:assert/strict";

import { wakeReleaseRunnerForJob } from "../../lib/server/release-runner-wake.ts";
import {
  isWakeAuthorized,
  normalizeWakePayload,
  releasePhaseForOutput,
  syncRepo,
  wakeHealthPayload,
} from "../../scripts/release/release-agent.mjs";

test("release agent progress: maps content publish checkpoints to stable phases", () => {
  const action = "publish-content-production";
  assert.equal(
    releasePhaseForOutput(action, "[publish-content] dumping production D1 content"),
    "prepare-content",
  );
  assert.equal(
    releasePhaseForOutput(action, "[publish-content] running Next build with live build id abc"),
    "build",
  );
  assert.equal(
    releasePhaseForOutput(action, "[publish-content] exporting static shell assets"),
    "export",
  );
  assert.equal(
    releasePhaseForOutput(action, "[publish-content] uploading 12 changed overlay files"),
    "upload",
  );
  assert.equal(
    releasePhaseForOutput(action, "[publish-content] verifying production overlay on public routes"),
    "verify",
  );
  assert.equal(releasePhaseForOutput(action, "ordinary build output"), "");
  assert.equal(
    releasePhaseForOutput("status", "[publish-content] running Next build"),
    "",
  );
});

const job = {
  action: "publish-content-staging",
  actor: "jinkun",
  agentId: "",
  claimedAt: null,
  createdAt: 1,
  error: "",
  finishedAt: null,
  id: "job-123",
  phase: "queued",
  request: {},
  result: {},
  script: "publish:content:staging",
  startedAt: null,
  status: "queued",
  target: "staging",
  updatedAt: 1,
};

test("release runner wake: skips when wake URL is not configured", async () => {
  const out = await wakeReleaseRunnerForJob(job, { env: {}, fetchImpl: async () => {
    throw new Error("should not fetch");
  } });
  assert.equal(out.configured, false);
  assert.equal(out.ok, false);
});

test("release runner wake: posts job id/action with bearer and Cloudflare Access headers", async () => {
  const calls = [];
  const out = await wakeReleaseRunnerForJob(job, {
    env: {
      RELEASE_RUNNER_CF_ACCESS_CLIENT_ID: "access-id",
      RELEASE_RUNNER_CF_ACCESS_CLIENT_SECRET: "access-secret",
      RELEASE_RUNNER_WAKE_TOKEN: "wake-token",
      RELEASE_RUNNER_WAKE_URL: "https://release-runner.example.com/",
    },
    fetchImpl: async (url, init) => {
      calls.push({ init, url });
      return Response.json({ ok: true }, { status: 202 });
    },
  });
  assert.equal(out.configured, true);
  assert.equal(out.ok, true);
  assert.equal(out.status, 202);
  assert.equal(calls[0].url, "https://release-runner.example.com/wake");
  assert.equal(calls[0].init.headers.Authorization, "Bearer wake-token");
  assert.equal(calls[0].init.headers["CF-Access-Client-Id"], "access-id");
  assert.equal(calls[0].init.headers["CF-Access-Client-Secret"], "access-secret");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    action: "publish-content-staging",
    jobId: "job-123",
  });
});

test("release agent wake: validates token and allowlisted payloads", () => {
  assert.equal(isWakeAuthorized("", "secret-token"), false);
  assert.equal(isWakeAuthorized("Bearer wrong", "secret-token"), false);
  assert.equal(isWakeAuthorized("Bearer secret-token", "secret-token"), true);
  assert.deepEqual(normalizeWakePayload({ action: "rm -rf", jobId: "job-123" }), {
    error: "Unsupported release action.",
    ok: false,
    status: 400,
  });
  assert.deepEqual(normalizeWakePayload({ action: "status", jobId: "job-123" }), {
    action: "status",
    jobId: "job-123",
    ok: true,
  });
});

test("release agent health: hides runner details without wake token", () => {
  const snapshot = {
    agentId: "mac-mini:123",
    busy: true,
    currentAction: "status",
    currentJobId: "job-123",
    ok: true,
  };
  assert.deepEqual(wakeHealthPayload(snapshot, "", "secret-token"), { ok: true });
  assert.deepEqual(wakeHealthPayload(snapshot, "Bearer wrong", "secret-token"), { ok: true });
  assert.deepEqual(wakeHealthPayload(snapshot, "Bearer secret-token", "secret-token"), snapshot);
});

test("release agent sync: executes canonical main from an isolated clone", () => {
  const calls = [];
  const fileCalls = [];
  const lines = [];
  const execution = syncRepo({
    fsImpl: {
      existsSync(file) {
        return file === "/runner/repo/node_modules";
      },
      mkdirSync(file, options) {
        fileCalls.push(["mkdir", file, options]);
      },
      rmSync(file, options) {
        fileCalls.push(["rm", file, options]);
      },
      symlinkSync(target, file, type) {
        fileCalls.push(["symlink", target, file, type]);
      },
    },
    jobId: "job-123",
    onLine: (_stream, line) => lines.push(line),
    repo: "/runner/repo",
    spawnSyncImpl: (command, args, options) => {
      calls.push({ args, command, cwd: options.cwd });
      const key = args.join(" ");
      const stdout =
        key === "rev-parse origin/main"
          ? "abc1234567890\n"
          : key === "remote get-url origin"
            ? "https://github.com/example/site.git\n"
            : "";
      return { status: 0, stderr: "", stdout };
    },
  });
  assert.deepEqual(
    calls.map((call) => call.args),
    [
      ["fetch", "--prune", "origin", "main"],
      ["rev-parse", "origin/main"],
      ["remote", "get-url", "origin"],
      [
        "clone",
        "--shared",
        "--no-checkout",
        "/runner/repo",
        "/runner/repo/.cache/release/agent-execution/job-123",
      ],
      ["switch", "-C", "main", "abc1234567890"],
      ["remote", "set-url", "origin", "https://github.com/example/site.git"],
    ],
  );
  assert.equal(calls.every((call) => call.command === "git"), true);
  assert.equal(calls.slice(0, 4).every((call) => call.cwd === "/runner/repo"), true);
  assert.equal(
    calls.slice(4).every(
      (call) => call.cwd === "/runner/repo/.cache/release/agent-execution/job-123",
    ),
    true,
  );
  assert.equal(
    lines.at(-1),
    "Release runner source: main abc123456789 (isolated)",
  );
  assert.equal(execution.repo, "/runner/repo/.cache/release/agent-execution/job-123");
  assert.deepEqual(fileCalls.at(-1), [
    "symlink",
    "/runner/repo/node_modules",
    "/runner/repo/.cache/release/agent-execution/job-123/node_modules",
    "dir",
  ]);
  execution.cleanup();
  assert.deepEqual(fileCalls.at(-1), [
    "rm",
    "/runner/repo/.cache/release/agent-execution/job-123",
    { force: true, recursive: true },
  ]);
});

test("release agent sync: never inspects or rewrites the persistent worktree", () => {
  const calls = [];
  const execution = syncRepo({
    fsImpl: {
      existsSync: () => true,
      mkdirSync: () => undefined,
      rmSync: () => undefined,
      symlinkSync: () => undefined,
    },
    jobId: "dirty-safe",
    onLine: () => undefined,
    repo: "/runner/repo",
    spawnSyncImpl: (_command, args) => {
      calls.push(args);
      if (args.join(" ") === "rev-parse origin/main") {
        return { status: 0, stderr: "", stdout: "abc1234\n" };
      }
      if (args.join(" ") === "remote get-url origin") {
        return { status: 0, stderr: "", stdout: "https://example.com/site.git\n" };
      }
      return { status: 0, stderr: "", stdout: "" };
    },
  });
  assert.equal(calls.some((args) => args[0] === "status"), false);
  assert.equal(calls.some((args) => args[0] === "reset" || args[0] === "restore"), false);
  execution.cleanup();
});
