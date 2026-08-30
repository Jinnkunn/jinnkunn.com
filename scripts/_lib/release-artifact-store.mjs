/**
 * R2-backed store for verified staging build artifacts.
 *
 * Production promotion refuses to rebuild: it must reuse the exact bytes that
 * were verified on staging. Before this store, those bytes lived only in one
 * machine's `.cache/release/build/<sha>/` — stage on the Mac mini and every
 * other machine (or a rebuilt Mac mini) was locked out of promotion until a
 * fresh staging release. After a green staging release the artifact is tarred
 * and uploaded to the existing R2 bucket keyed by code+content SHA; promotion
 * falls back to downloading that tarball when the local cache misses.
 *
 * Upload is best-effort — a deploy token without R2 write, or an oversized
 * tarball, logs a warning and the release continues exactly as before.
 * Download failures fall back to the existing "deploy staging on this runner"
 * error. Disable both directions with RELEASE_ARTIFACT_STORE=0.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { writeMarker } from "./release-cache.mjs";

const ARTIFACT_PREFIX = "release-artifacts";
const METADATA_FILE = "release-artifact.json";
// `wrangler r2 object put` uploads in one shot through the Cloudflare API,
// which caps bodies around 300 MiB. Gzipped worker builds sit far below this;
// skip (with a warning) rather than fail if one ever grows past it.
const MAX_UPLOAD_BYTES = 290 * 1024 * 1024;

function readEnv(name) {
  return String(process.env[name] || "").trim();
}

export function artifactStoreDisabled() {
  return readEnv("RELEASE_ARTIFACT_STORE") === "0";
}

export function artifactBucketName({ root, wranglerToml }) {
  const raw =
    typeof wranglerToml === "string"
      ? wranglerToml
      : fs.readFileSync(path.join(root, "wrangler.toml"), "utf8");
  const start = raw.indexOf("[[r2_buckets]]");
  if (start >= 0) {
    const rest = raw.slice(start);
    const nextBlock = rest.slice("[[r2_buckets]]".length).search(/\n\[/);
    const block =
      nextBlock >= 0 ? rest.slice(0, nextBlock + "[[r2_buckets]]".length) : rest;
    const match = /^\s*bucket_name\s*=\s*"([^"]+)"/m.exec(block);
    if (match) return match[1];
  }
  return "jinnkunn";
}

export function artifactObjectKey({ codeSha, contentSha }) {
  const code = String(codeSha || "").trim().toLowerCase();
  const content = String(contentSha || "").trim().toLowerCase();
  if (!/^[a-f0-9]{7,40}$/.test(code) || !/^[a-f0-9]{7,40}$/.test(content)) {
    return "";
  }
  return `${ARTIFACT_PREFIX}/${code}-${content}.tar.gz`;
}

function runWranglerR2(root, args) {
  const result = spawnSync("npx", ["wrangler", "r2", "object", ...args, "--remote"], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ok: result.status === 0,
    output: `${result.stdout || ""}${result.stderr || ""}`.trim(),
  };
}

function tmpArtifactPath(root, key) {
  const dir = path.join(root, ".cache", "release", "artifact-tmp");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${path.basename(key)}.${process.pid}`);
}

/**
 * Tar + upload the packed build cache dir for one code+content SHA pair.
 * Never throws; returns `{ ok, reason?, objectKey?, bytes? }`.
 */
export function uploadBuildArtifact({ root, codeSha, contentSha, cacheDir, markerPayload, logger = console }) {
  const objectKey = artifactObjectKey({ codeSha, contentSha });
  if (!objectKey) return { ok: false, reason: "invalid code/content SHA" };
  if (!fs.existsSync(cacheDir)) return { ok: false, reason: `missing cache dir ${cacheDir}` };
  const tarPath = tmpArtifactPath(root, objectKey);
  try {
    const metadataPath = path.join(cacheDir, METADATA_FILE);
    fs.writeFileSync(
      metadataPath,
      `${JSON.stringify({ ...markerPayload, codeSha, contentSnapshotSha: contentSha, uploadedAt: new Date().toISOString() }, null, 2)}\n`,
      "utf8",
    );
    // `.next/cache` is Next's incremental build cache — pure build-time state
    // that promotion never reads. Excluding it keeps the tarball small.
    const tar = spawnSync(
      "tar",
      ["-czf", tarPath, "--exclude", "./.next/cache", "-C", cacheDir, "."],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    fs.rmSync(metadataPath, { force: true });
    if (tar.status !== 0) {
      return { ok: false, reason: `tar failed: ${(tar.stderr || "").trim().slice(0, 240)}` };
    }
    const bytes = fs.statSync(tarPath).size;
    if (bytes > MAX_UPLOAD_BYTES) {
      logger.warn(
        `[release-artifact] skipping R2 upload: ${objectKey} is ${(bytes / 1024 / 1024).toFixed(0)}MB (> ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)}MB single-shot limit)`,
      );
      return { ok: false, reason: "artifact exceeds upload size limit", bytes };
    }
    const bucket = artifactBucketName({ root });
    const put = runWranglerR2(root, ["put", `${bucket}/${objectKey}`, "--file", tarPath]);
    if (!put.ok) {
      logger.warn(
        `[release-artifact] R2 upload failed (promotion from other machines will need a local staging build): ${put.output.slice(0, 240)}`,
      );
      return { ok: false, reason: "wrangler r2 object put failed" };
    }
    logger.log(
      `[release-artifact] uploaded verified staging artifact to r2://${bucket}/${objectKey} (${(bytes / 1024 / 1024).toFixed(1)}MB)`,
    );
    return { ok: true, objectKey, bytes };
  } catch (error) {
    logger.warn(`[release-artifact] upload skipped: ${error?.message || error}`);
    return { ok: false, reason: String(error?.message || error) };
  } finally {
    fs.rmSync(tarPath, { force: true });
  }
}

/**
 * Fetch the artifact for one code+content SHA pair from R2 and extract it
 * into the local build cache (`.cache/release/build/<codeSha>/`), rewriting
 * the per-SHA marker so the normal restore path can use it. Never throws;
 * returns `{ objectKey, contentSnapshotSha }` on success, `null` on any miss
 * or failure.
 */
export function downloadBuildArtifact({ root, codeSha, contentSha, logger = console }) {
  const objectKey = artifactObjectKey({ codeSha, contentSha });
  if (!objectKey) return null;
  const tarPath = tmpArtifactPath(root, objectKey);
  const cacheDir = path.join(root, ".cache", "release", "build", String(codeSha).toLowerCase());
  try {
    const bucket = artifactBucketName({ root });
    logger.log(`[release-artifact] local build cache miss — trying r2://${bucket}/${objectKey}`);
    const get = runWranglerR2(root, ["get", `${bucket}/${objectKey}`, "--file", tarPath]);
    if (!get.ok || !fs.existsSync(tarPath) || fs.statSync(tarPath).size === 0) {
      logger.warn(
        `[release-artifact] no usable R2 artifact for ${objectKey}: ${get.output.slice(0, 240)}`,
      );
      return null;
    }
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.mkdirSync(cacheDir, { recursive: true });
    const untar = spawnSync("tar", ["-xzf", tarPath, "-C", cacheDir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (untar.status !== 0) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
      logger.warn(
        `[release-artifact] failed to extract R2 artifact: ${(untar.stderr || "").trim().slice(0, 240)}`,
      );
      return null;
    }
    let metadata = {};
    const metadataPath = path.join(cacheDir, METADATA_FILE);
    try {
      metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    } catch {
      metadata = {};
    }
    fs.rmSync(metadataPath, { force: true });
    writeMarker({
      repoRoot: root,
      bucket: "build",
      sha: codeSha,
      payload: {
        paths: Array.isArray(metadata.paths) ? metadata.paths : [".open-next", ".next"],
        branch: String(metadata.branch || ""),
        contentSnapshotSha: String(metadata.contentSnapshotSha || contentSha),
        env: String(metadata.env || "staging"),
        restoredFromR2: true,
      },
    });
    return {
      objectKey,
      contentSnapshotSha: String(metadata.contentSnapshotSha || contentSha),
    };
  } catch (error) {
    logger.warn(`[release-artifact] download failed: ${error?.message || error}`);
    return null;
  } finally {
    fs.rmSync(tarPath, { force: true });
  }
}
