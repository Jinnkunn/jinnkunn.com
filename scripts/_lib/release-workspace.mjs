import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const RELEASE_ENVIRONMENTS = new Set(["staging", "production"]);
const STALE_SNAPSHOT_MAX_AGE_MS = 48 * 60 * 60 * 1000;

function normalizePathSegment(value, fallback) {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.stdio || "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${options.label || [command, ...args].join(" ")} failed`);
  }
}

function pruneStaleSnapshots(snapshotsRoot, now = Date.now()) {
  if (!fs.existsSync(snapshotsRoot)) return;
  for (const entry of fs.readdirSync(snapshotsRoot, { withFileTypes: true })) {
    const target = path.join(snapshotsRoot, entry.name);
    let modifiedAt = 0;
    try {
      modifiedAt = fs.statSync(target).mtimeMs;
    } catch {
      continue;
    }
    if (now - modifiedAt <= STALE_SNAPSHOT_MAX_AGE_MS) continue;
    fs.rmSync(target, { recursive: entry.isDirectory(), force: true });
  }
}

function linkSnapshotDependencies(root, snapshotRoot, relative) {
  const installed = path.join(root, relative, "node_modules");
  const target = path.join(snapshotRoot, relative, "node_modules");
  if (!fs.existsSync(installed) || !fs.existsSync(path.dirname(target)) || fs.existsSync(target)) return;
  fs.mkdirSync(target);
  for (const name of fs.readdirSync(installed)) {
    if (name !== "@jinnkunn") {
      fs.symlinkSync(path.join(installed, name), path.join(target, name));
      continue;
    }
    // npm's file: workspace links otherwise resolve back to the dirty checkout.
    const scope = path.join(target, name);
    fs.mkdirSync(scope);
    for (const local of fs.readdirSync(path.join(installed, name))) {
      const archived = path.join(snapshotRoot, "packages", local);
      if (fs.existsSync(path.join(archived, "package.json"))) fs.symlinkSync(archived, path.join(scope, local), "dir");
    }
  }
}

export function createReleaseWorkspacePlan({
  env,
  contentEnv = "staging",
}) {
  if (!RELEASE_ENVIRONMENTS.has(env)) {
    throw new Error(`Unsupported release environment: ${env}`);
  }
  if (!RELEASE_ENVIRONMENTS.has(contentEnv)) {
    throw new Error(`Unsupported content environment: ${contentEnv}`);
  }

  return Object.freeze({
    mode: "immutable-snapshot-build",
    useImmutableSnapshot: true,
    publicationEnvironment: env,
    contentSourceMode: `${env}-published-baseline`,
  });
}

export function prepareImmutableReleaseSnapshot({
  repoRoot,
  sha,
  environment,
  dependencyRoots = [""],
  snapshotId = `${process.pid}`,
  runCommand = runChecked,
}) {
  const rawRoot = String(repoRoot || "").trim();
  const sourceSha = String(sha || "").trim();
  if (!rawRoot || !sourceSha) {
    throw new Error("release snapshot requires repoRoot and sha");
  }
  const root = path.resolve(rawRoot);

  const namespace = normalizePathSegment(environment, "release");
  const runId = normalizePathSegment(snapshotId, `${process.pid}`);
  const shortSha = sourceSha.slice(0, 12);
  const snapshotsRoot = path.join(root, ".cache", "release", "snapshots");
  const snapshotRoot = path.join(
    snapshotsRoot,
    `${namespace}-${shortSha}-${runId}`,
  );
  const archivePath = `${snapshotRoot}.tar`;

  fs.mkdirSync(snapshotsRoot, { recursive: true });
  pruneStaleSnapshots(snapshotsRoot);
  fs.rmSync(snapshotRoot, { recursive: true, force: true });
  fs.rmSync(archivePath, { force: true });
  fs.mkdirSync(snapshotRoot, { recursive: true });

  try {
    runCommand("git", ["archive", "--format=tar", "-o", archivePath, sourceSha], {
      label: "git archive release source",
      cwd: root,
    });
    runCommand("tar", ["-xf", archivePath, "-C", snapshotRoot], {
      label: "tar extract release source",
      cwd: root,
    });
  } finally {
    fs.rmSync(archivePath, { force: true });
  }

  for (const relativeRoot of dependencyRoots) {
    linkSnapshotDependencies(root, snapshotRoot, String(relativeRoot || "").trim());
  }

  return snapshotRoot;
}

export function removeImmutableReleaseSnapshot({ repoRoot, snapshotRoot }) {
  const rawRoot = String(repoRoot || "").trim();
  const rawSnapshot = String(snapshotRoot || "").trim();
  if (!rawRoot || !rawSnapshot) {
    throw new Error("release snapshot cleanup requires repoRoot and snapshotRoot");
  }
  const snapshotsRoot = path.resolve(rawRoot, ".cache", "release", "snapshots");
  const target = path.resolve(rawSnapshot);
  if (!target.startsWith(`${snapshotsRoot}${path.sep}`)) {
    throw new Error(`refusing to remove path outside release snapshots: ${target}`);
  }
  fs.rmSync(target, { recursive: true, force: true });
}
