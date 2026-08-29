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

export function createReleaseWorkspacePlan({
  env,
  contentEnv = "staging",
  skipBuild = false,
  syncContentToGit = false,
  reuseStagingBuild = false,
}) {
  if (!RELEASE_ENVIRONMENTS.has(env)) {
    throw new Error(`Unsupported release environment: ${env}`);
  }
  if (!RELEASE_ENVIRONMENTS.has(contentEnv)) {
    throw new Error(`Unsupported content environment: ${contentEnv}`);
  }

  const hydrateContentFromD1 =
    env === "staging" && !skipBuild && !syncContentToGit;

  const requiresCachedBuild = skipBuild || reuseStagingBuild;

  return Object.freeze({
    mode: skipBuild
      ? "immutable-snapshot-cached-artifacts"
      : reuseStagingBuild
        ? "immutable-snapshot-promoted-artifact"
        : "immutable-snapshot-build",
    useImmutableSnapshot: true,
    hydrateContentFromD1,
    requiresCachedBuild,
    requiresExpectedContentSha: requiresCachedBuild,
    contentSourceMode: reuseStagingBuild
      ? "staging-immutable-build-cache"
      : hydrateContentFromD1
        ? `${contentEnv}-d1-snapshot`
        : syncContentToGit
          ? `${contentEnv}-d1-git-sync`
          : "git",
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
    const relative = String(relativeRoot || "").trim();
    const source = path.join(root, relative, "node_modules");
    const target = path.join(snapshotRoot, relative, "node_modules");
    if (
      fs.existsSync(source) &&
      fs.existsSync(path.dirname(target)) &&
      !fs.existsSync(target)
    ) {
      fs.symlinkSync(source, target, "dir");
    }
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
