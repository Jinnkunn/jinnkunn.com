import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createReleaseWorkspacePlan,
  prepareImmutableReleaseSnapshot,
  removeImmutableReleaseSnapshot,
} from "../../scripts/_lib/release-workspace.mjs";

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stderr}`);
  return String(result.stdout || "").trim();
}

test("release workspace: full staging and production releases are immutable", () => {
  const staging = createReleaseWorkspacePlan({
    env: "staging",
    contentEnv: "staging",
  });
  const production = createReleaseWorkspacePlan({
    env: "production",
    contentEnv: "production",
  });

  assert.equal(staging.useImmutableSnapshot, true);
  assert.equal(staging.hydrateContentFromD1, true);
  assert.equal(staging.contentSourceMode, "staging-d1-snapshot");
  assert.equal(production.useImmutableSnapshot, true);
  assert.equal(production.hydrateContentFromD1, false);
  assert.equal(production.contentSourceMode, "git");
});

test("release workspace: skip-build requires cached artifacts inside a snapshot", () => {
  const plan = createReleaseWorkspacePlan({
    env: "production",
    skipBuild: true,
  });
  assert.equal(plan.mode, "immutable-snapshot-cached-artifacts");
  assert.equal(plan.useImmutableSnapshot, true);
  assert.equal(plan.requiresCachedBuild, true);
  assert.equal(plan.requiresExpectedContentSha, true);
});

test("release workspace: production promotion requires the staging artifact", () => {
  const plan = createReleaseWorkspacePlan({
    env: "production",
    reuseStagingBuild: true,
  });
  assert.equal(plan.mode, "immutable-snapshot-promoted-artifact");
  assert.equal(plan.requiresCachedBuild, true);
  assert.equal(plan.requiresExpectedContentSha, true);
  assert.equal(plan.contentSourceMode, "staging-immutable-build-cache");
});

test("release workspace: snapshot contains committed source and excludes dirty work", (t) => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "release-workspace-"));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));

  fs.mkdirSync(path.join(repoRoot, "apps", "workspace", "node_modules"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(repoRoot, "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "tracked.txt"), "committed\n");
  fs.writeFileSync(path.join(repoRoot, "apps", "workspace", "package.json"), "{}\n");

  run("git", ["init"], repoRoot);
  run("git", ["add", "tracked.txt", "apps/workspace/package.json"], repoRoot);
  run(
    "git",
    [
      "-c",
      "user.name=Release Test",
      "-c",
      "user.email=release@example.com",
      "commit",
      "-m",
      "fixture",
    ],
    repoRoot,
  );
  const sha = run("git", ["rev-parse", "HEAD"], repoRoot);

  fs.writeFileSync(path.join(repoRoot, "tracked.txt"), "dirty\n");
  fs.writeFileSync(path.join(repoRoot, "untracked.txt"), "not released\n");

  const snapshotRoot = prepareImmutableReleaseSnapshot({
    repoRoot,
    sha,
    environment: "production",
    snapshotId: "test",
    dependencyRoots: ["", "apps/workspace"],
  });

  assert.equal(fs.readFileSync(path.join(snapshotRoot, "tracked.txt"), "utf8"), "committed\n");
  assert.equal(fs.existsSync(path.join(snapshotRoot, "untracked.txt")), false);
  assert.equal(fs.lstatSync(path.join(snapshotRoot, "node_modules")).isSymbolicLink(), true);
  assert.equal(
    fs.lstatSync(path.join(snapshotRoot, "apps", "workspace", "node_modules")).isSymbolicLink(),
    true,
  );

  removeImmutableReleaseSnapshot({ repoRoot, snapshotRoot });
  assert.equal(fs.existsSync(snapshotRoot), false);
});

test("release workspace: snapshot cleanup refuses paths outside its cache", () => {
  assert.throws(
    () =>
      removeImmutableReleaseSnapshot({
        repoRoot: "/tmp/release-workspace-test",
        snapshotRoot: "/tmp/not-a-release-snapshot",
      }),
    /outside release snapshots/,
  );
});
