#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadProjectEnv } from "../_lib/load-project-env.mjs";
import { readPublicationSnapshot } from "../_lib/publication-snapshot-files.mjs";
import { assertPublicationReady } from "../../lib/shared/publication-validation.ts";

const value = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const env = value("env");
if (env && !["staging", "production"].includes(env)) throw new Error("Unknown publication environment.");
if (env && value("root")) throw new Error("Choose a local root or a remote environment, not both.");
let temporary;
try {
  const root = env ? (temporary = fs.mkdtempSync(path.join(os.tmpdir(), "publication-preflight-"))) : path.resolve(value("root") || ".");
  if (env) {
    loadProjectEnv({ override: true, files: [".env"] });
    const dump = spawnSync("node", ["scripts/content/dump-content-from-db.mjs", "--remote", `--env=${env}`, "--quiet", `--target=${path.join(root, "content")}`], { stdio: "inherit", env: process.env });
    if (dump.status !== 0) throw new Error("Could not read the publication snapshot.");
  }
  const snapshot = readPublicationSnapshot(root);
  const validation = assertPublicationReady(snapshot);
  console.log(JSON.stringify({ ok: true, snapshotSha: snapshot.sha, warnings: validation.warnings.length, writes: 0 }));
} finally {
  if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
}
