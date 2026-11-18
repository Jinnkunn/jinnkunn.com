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
  assert.equal(staging.publicationEnvironment, "staging");
  assert.equal(staging.contentSourceMode, "staging-published-baseline");
  assert.equal(production.useImmutableSnapshot, true);
  assert.equal(production.publicationEnvironment, "production");
  assert.equal(production.contentSourceMode, "production-published-baseline");
});

test("release workspace: explicit staging draft backup cannot change the production build source", () => {
  const plan = createReleaseWorkspacePlan({
    env: "production",
    contentEnv: "staging",
  });
  assert.equal(plan.mode, "immutable-snapshot-build");
  assert.equal(plan.contentSourceMode, "production-published-baseline");
});

test("release workspace: snapshot contains committed source and excludes dirty work", (t) => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "release-workspace-"));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));

  fs.mkdirSync(path.join(repoRoot, "apps", "workspace", "node_modules"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(repoRoot, "node_modules"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "node_modules", "@jinnkunn"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "packages", "content-core"), { recursive: true });
  // The runner's execution clone starts with links into its dependency cache.
  const cachedNext = path.join(repoRoot, "cached-next");
  fs.mkdirSync(cachedNext);
  fs.writeFileSync(path.join(cachedNext, "server.js"), "original\n");
  fs.symlinkSync(cachedNext, path.join(repoRoot, "node_modules", "next"), "dir");
  fs.mkdirSync(path.join(repoRoot, "node_modules", ".bin"));
  fs.symlinkSync("../next/server.js", path.join(repoRoot, "node_modules", ".bin", "next"));
  fs.writeFileSync(path.join(repoRoot, "packages", "content-core", "package.json"), "{}\n");
  fs.symlinkSync(path.join(repoRoot, "packages", "content-core"), path.join(repoRoot, "node_modules", "@jinnkunn", "content-core"));
  fs.writeFileSync(path.join(repoRoot, "tracked.txt"), "committed\n");
  fs.writeFileSync(path.join(repoRoot, "apps", "workspace", "package.json"), "{}\n");

  run("git", ["init"], repoRoot);
  run("git", ["add", "tracked.txt", "apps/workspace/package.json", "packages/content-core/package.json"], repoRoot);
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
  fs.writeFileSync(path.join(repoRoot, "packages", "content-core", "package.json"), '{"dirty":true}\n');
  fs.writeFileSync(path.join(repoRoot, "untracked.txt"), "not released\n");

  const snapshotRoot = prepareImmutableReleaseSnapshot({
    repoRoot,
    sha,
    environment: "production",
    snapshotId: "test",
    dependencyRoots: ["", "apps/workspace"],
    copyRootDependencies: true,
  });

  assert.equal(fs.readFileSync(path.join(snapshotRoot, "tracked.txt"), "utf8"), "committed\n");
  assert.equal(fs.existsSync(path.join(snapshotRoot, "untracked.txt")), false);
  assert.equal(fs.readFileSync(path.join(snapshotRoot, "node_modules", "@jinnkunn", "content-core", "package.json"), "utf8"), "{}\n");
  assert.equal(fs.statSync(path.join(snapshotRoot, "apps", "workspace", "node_modules")).isDirectory(), true);
  const snapshotNextServer = path.join(snapshotRoot, "node_modules", "next", "server.js");
  assert.equal(fs.lstatSync(path.dirname(snapshotNextServer)).isSymbolicLink(), false);
  assert.equal(fs.realpathSync(path.join(snapshotRoot, "node_modules", ".bin", "next")), fs.realpathSync(snapshotNextServer));
  fs.writeFileSync(snapshotNextServer, "patched\n");
  assert.equal(fs.readFileSync(path.join(cachedNext, "server.js"), "utf8"), "original\n");

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
