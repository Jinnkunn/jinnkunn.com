#!/usr/bin/env node

// Read the currently-active production Cloudflare Worker and append a
// row to docs/runbooks/production-version-history.md so a future
// rollback can grab the previous-known-good version ID without poking
// at the Cloudflare UI mid-incident.
//
// Standalone usage:
//   npm run snapshot:prod
//
// Auto usage from release-from-staging.mjs:
//   node scripts/snapshot-prod-version.mjs --auto --note "Released …"
//
// The --auto flag means "called from another script": output is JSON
// instead of human-readable text, and a missing CF API token is a soft
// fail (the script exits 0 with `{ ok: false, reason: ... }`) so the
// caller can decide whether to abort. In standalone mode, missing
// credentials are an error.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadProjectEnv } from "./load-project-env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const HISTORY_FILE = path.join(
  ROOT,
  "docs",
  "runbooks",
  "production-version-history.md",
);

function parseArgs(argv = process.argv.slice(2)) {
  let note = "";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--note=")) {
      note = arg.slice("--note=".length);
    } else if (arg === "--note" && i + 1 < argv.length) {
      note = argv[i + 1];
      i += 1;
    }
  }
  return {
    auto: argv.includes("--auto"),
    // Read-only mode: pull deployment history straight from the
    // Cloudflare API instead of writing to the local markdown file.
    // Useful when the local history file lags (it's per-machine, so a
    // deploy from machine B leaves machine A's file stale) — CF API is
    // the source of truth.
    list: argv.includes("--list"),
    note,
  };
}

function readEnv(name) {
  return String(process.env[name] || "").trim();
}

function readAccountId() {
  return readEnv("CLOUDFLARE_ACCOUNT_ID") || readEnv("CF_ACCOUNT_ID");
}

function readApiToken() {
  return readEnv("CLOUDFLARE_API_TOKEN") || readEnv("CF_API_TOKEN");
}

function readProductionWorkerName() {
  return (
    readEnv("CLOUDFLARE_WORKER_NAME_PRODUCTION") ||
    readEnv("CLOUDFLARE_WORKER_NAME")
  );
}

async function cfRequest({ accountId, apiToken, method, path: apiPath }) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
    accountId,
  )}${apiPath}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Cloudflare API ${method} ${apiPath} returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (!response.ok || !payload || payload.success === false) {
    const errors = payload?.errors?.map((e) => e.message).join("; ") || text || response.statusText;
    throw new Error(`Cloudflare API ${method} ${apiPath} failed (${response.status}): ${errors}`);
  }
  return payload.result ?? payload;
}

// Walk a deploy/version message annotation back into structured fields.
// Mirrors deploy-cloudflare.mjs:parseDeployMetadataMessage; kept local
// so this script doesn't import from that file.
function parseDeployMessage(messageRaw) {
  const message = String(messageRaw || "");
  const token = (name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hit = new RegExp(`\\b${escaped}=([^\\s]+)`, "i").exec(message);
    return hit?.[1] || "";
  };
  return {
    sourceSha: token("source"),
    sourceBranch: token("branch"),
    codeSha: token("code"),
    codeBranch: token("codeBranch"),
    contentSha: token("content"),
    contentBranch: token("contentBranch"),
  };
}

// Cloudflare's list endpoints wrap the array under a type-specific key
// (`{ deployments: [...] }`, `{ items: [...] }`, etc.). Inspect every
// array property and return the first row from whichever one is the
// list — that's resilient to small shape changes between API versions.
function pickFirstItem(result) {
  if (Array.isArray(result)) return result[0] ?? null;
  if (!result || typeof result !== "object") return null;
  for (const value of Object.values(result)) {
    if (Array.isArray(value) && value.length > 0) return value[0];
  }
  return null;
}

async function listProductionHistory({ accountId, apiToken, workerName, limit = 10 }) {
  // CF returns deployments newest-first. Each one points at one or
  // more versions; for our (single-strategy) deployments we just take
  // the highest-percentage version. Annotation message has the source
  // SHA + branch we embedded at upload time, so the result is enough
  // for a rollback decision without a second API call per row.
  const deployments = await cfRequest({
    accountId,
    apiToken,
    method: "GET",
    path: `/workers/scripts/${encodeURIComponent(workerName)}/deployments`,
  });
  const payload =
    deployments && typeof deployments === "object" ? deployments : {};
  const items = Array.isArray(payload.deployments)
    ? payload.deployments
    : Array.isArray(payload.items)
      ? payload.items
      : Array.isArray(deployments)
        ? deployments
        : [];
  const rows = [];
  for (const raw of items.slice(0, limit)) {
    const record = raw && typeof raw === "object" ? raw : {};
    const deploymentId = String(record.id || "");
    const annotations =
      record.annotations && typeof record.annotations === "object"
        ? record.annotations
        : {};
    const annotation = String(annotations["workers/message"] || "");
    const versions = Array.isArray(record.versions) ? [...record.versions] : [];
    versions.sort(
      (a, b) => Number(b.percentage ?? 0) - Number(a.percentage ?? 0),
    );
    const primary = versions[0] || {};
    const versionId = String(primary.version_id || "");
    if (!versionId) continue;
    const meta = parseDeployMessage(annotation);
    rows.push({
      deploymentId,
      versionId,
      createdOn: String(record.created_on || ""),
      codeSha: meta.codeSha || meta.sourceSha || "",
      codeBranch: meta.codeBranch || meta.sourceBranch || "",
      message: annotation,
    });
  }
  return rows;
}

async function readActiveProduction({ accountId, apiToken, workerName }) {
  // The deployments endpoint lists deployments in reverse-chronological
  // order, so the first item is the active rollout. Each deployment
  // points at one or more versions (gradual rollouts can split traffic);
  // we record the highest-percentage version as "the" version.
  const deployments = await cfRequest({
    accountId,
    apiToken,
    method: "GET",
    path: `/workers/scripts/${encodeURIComponent(workerName)}/deployments`,
  });
  const active = pickFirstItem(deployments);
  if (!active) throw new Error("No active production deployment found");

  const versions = Array.isArray(active.versions) ? active.versions : [];
  versions.sort((a, b) => Number(b.percentage ?? 0) - Number(a.percentage ?? 0));
  const primary = versions[0] ?? null;
  if (!primary?.version_id) {
    throw new Error("Active deployment has no version_id");
  }

  // Pull the version's annotation message so we can record the source
  // SHA the deployment was built from. The deployments API doesn't
  // include the version message inline, so a second GET is needed.
  const versionDetail = await cfRequest({
    accountId,
    apiToken,
    method: "GET",
    path: `/workers/scripts/${encodeURIComponent(workerName)}/versions/${encodeURIComponent(primary.version_id)}`,
  });
  const annotations = (versionDetail && versionDetail.annotations) || {};
  const message =
    annotations["workers/message"] || versionDetail?.message || "";
  const meta = parseDeployMessage(message);

  return {
    deploymentId: String(active.id || ""),
    versionId: primary.version_id,
    deployedAt: String(active.created_on || versionDetail?.created_on || ""),
    deployMessage:
      typeof active.annotations === "object"
        ? String(active.annotations?.["workers/message"] || "")
        : "",
    versionMessage: message,
    meta,
  };
}

function ensureHistoryHeader(file) {
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    [
      "# Production Version History",
      "",
      "Append-only log of production Cloudflare Worker versions. Read top-",
      "to-bottom: most-recent first. The version IDs in this file are the",
      "fastest path to a known-good rollback target during an incident.",
      "",
      "Each row is written by `npm run snapshot:prod` (standalone) or by",
      "`scripts/release-from-staging.mjs` after a successful production",
      "release.",
      "",
      "| Snapshot at (UTC) | Version ID | Deployment ID | Code SHA | Branch | Note |",
      "| --- | --- | --- | --- | --- | --- |",
      "",
    ].join("\n"),
    "utf8",
  );
}

function appendHistoryRow(file, row) {
  ensureHistoryHeader(file);
  // Insert the new row directly under the table header so the latest
  // entry is always visible at the top of the table — no need to scroll.
  const existing = fs.readFileSync(file, "utf8");
  const headerLine = "| --- | --- | --- | --- | --- | --- |";
  const idx = existing.indexOf(headerLine);
  if (idx < 0) {
    // Header was hand-edited; append at the end as a defensive fallback.
    fs.appendFileSync(file, `${row}\n`, "utf8");
    return;
  }
  const insertAt = idx + headerLine.length;
  const updated = `${existing.slice(0, insertAt)}\n${row}${existing.slice(insertAt)}`;
  fs.writeFileSync(file, updated, "utf8");
}

function gitShortSha(sha) {
  const trimmed = String(sha || "").trim();
  return /^[a-f0-9]{7,40}$/i.test(trimmed) ? trimmed.slice(0, 12) : "";
}

function escapeMarkdownCell(value) {
  return String(value || "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function formatRow({ snapshotAt, snapshot, note }) {
  const codeSha =
    gitShortSha(snapshot.meta.codeSha) ||
    gitShortSha(snapshot.meta.sourceSha) ||
    "(unknown)";
  const branch = snapshot.meta.codeBranch || snapshot.meta.sourceBranch || "(unknown)";
  return `| ${snapshotAt} | \`${snapshot.versionId}\` | \`${snapshot.deploymentId || "(none)"}\` | \`${codeSha}\` | ${escapeMarkdownCell(branch)} | ${escapeMarkdownCell(note) || "—"} |`;
}

function isoNow() {
  return new Date().toISOString().replace("T", " ").replace(/\..+$/, "");
}

async function main() {
  const args = parseArgs();
  loadProjectEnv({ cwd: ROOT, override: true });

  const accountId = readAccountId();
  const apiToken = readApiToken();
  const workerName = readProductionWorkerName();
  const credentialsMissing = !accountId || !apiToken || !workerName;

  if (credentialsMissing) {
    const reason = !accountId
      ? "Missing CLOUDFLARE_ACCOUNT_ID"
      : !apiToken
        ? "Missing CLOUDFLARE_API_TOKEN"
        : "Missing CLOUDFLARE_WORKER_NAME(_PRODUCTION)";
    if (args.auto) {
      console.log(JSON.stringify({ ok: false, skipped: true, reason }));
      return;
    }
    console.error(`[snapshot-prod] ${reason}`);
    process.exit(1);
  }

  if (args.list) {
    // Read-only path. Bypasses the markdown file entirely so the
    // deployment list is always live — useful when the local
    // production-version-history.md is out of date because someone
    // deployed from a different machine. JSON output is machine-
    // readable; a `--list` invocation in `--auto` mode is the same
    // shape so callers can swap freely.
    let rows;
    try {
      rows = await listProductionHistory({ accountId, apiToken, workerName });
    } catch (error) {
      const errorMsg = String(error?.message || error);
      if (args.auto) {
        console.log(JSON.stringify({ ok: false, error: errorMsg }));
        return;
      }
      console.error(`[snapshot-prod] list failed: ${errorMsg}`);
      process.exit(1);
    }
    const result = { ok: true, workerName, deployments: rows };
    if (args.auto) {
      console.log(JSON.stringify(result));
      return;
    }
    console.log(`[snapshot-prod] last ${rows.length} production deployment(s) for ${workerName}:`);
    console.log("created (UTC)         deployment id                          version id                            code     branch");
    console.log("-".repeat(140));
    for (const row of rows) {
      const created = (row.createdOn || "").replace("T", " ").replace(/\..+$/, "");
      console.log(
        `${created.padEnd(20)}  ${row.deploymentId.padEnd(36)}  ${row.versionId.padEnd(36)}  ${(row.codeSha.slice(0, 7) || "(none)").padEnd(7)}  ${row.codeBranch || "(none)"}`,
      );
    }
    return;
  }

  let snapshot;
  try {
    snapshot = await readActiveProduction({ accountId, apiToken, workerName });
  } catch (error) {
    if (args.auto) {
      console.log(
        JSON.stringify({ ok: false, error: String(error?.message || error) }),
      );
      return;
    }
    throw error;
  }

  const snapshotAt = isoNow();
  const row = formatRow({ snapshotAt, snapshot, note: args.note });
  appendHistoryRow(HISTORY_FILE, row);

  const result = {
    ok: true,
    snapshotAt,
    workerName,
    versionId: snapshot.versionId,
    deploymentId: snapshot.deploymentId,
    codeSha: snapshot.meta.codeSha || snapshot.meta.sourceSha || "",
    codeBranch: snapshot.meta.codeBranch || snapshot.meta.sourceBranch || "",
    historyFile: path.relative(ROOT, HISTORY_FILE),
  };

  if (args.auto) {
    console.log(JSON.stringify(result));
    return;
  }

  console.log(`[snapshot-prod] recorded ${snapshot.versionId} at ${snapshotAt}`);
  console.log(`[snapshot-prod] history: ${result.historyFile}`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
