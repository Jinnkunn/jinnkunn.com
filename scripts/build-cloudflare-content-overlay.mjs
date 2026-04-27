#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadProjectEnv } from "./load-project-env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ENVIRONMENTS = new Set(["staging", "production"]);
const DEFAULT_OVERLAY_PATHS = ["content"];

function parseArgs(argv = process.argv.slice(2)) {
  const envRaw = argv.find((arg) => arg.startsWith("--env="))?.slice("--env=".length) || "staging";
  const env = ENVIRONMENTS.has(envRaw) ? envRaw : "staging";
  return {
    env,
    codeRef: argv.find((arg) => arg.startsWith("--code-ref="))?.slice("--code-ref=".length) || "HEAD",
    contentRef:
      argv.find((arg) => arg.startsWith("--content-ref="))?.slice("--content-ref=".length) ||
      process.env.SITE_ADMIN_REPO_BRANCH_STAGING ||
      process.env.SITE_ADMIN_REPO_BRANCH ||
      "site-admin-staging",
    dryRun: argv.includes("--dry-run"),
    keepWorktree: argv.includes("--keep-worktree"),
    skipBuild: argv.includes("--skip-build"),
    skipUpload: argv.includes("--skip-upload"),
  };
}

function run(command, args, options = {}) {
  const capture = Boolean(options.capture);
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    encoding: "utf8",
    env: { ...process.env, ...(options.env || {}) },
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  if (result.status !== 0) {
    throw new Error(`${options.label || [command, ...args].join(" ")} failed${output ? `\n${output}` : ""}`);
  }
  return output;
}

function git(args, options = {}) {
  return run("git", args, { ...options, label: `git ${args.join(" ")}` }).trim();
}

function readOverlayPaths() {
  const raw = String(process.env.CONTENT_OVERLAY_PATHS || "").trim();
  if (!raw) return DEFAULT_OVERLAY_PATHS;
  return raw
    .split(/[,\n]/)
    .map((item) => item.trim().replace(/^\/+/, "").replace(/\/+$/, ""))
    .filter(Boolean);
}

function assertSafeOverlayPath(relPath) {
  if (!relPath || relPath === "." || relPath.startsWith("..") || path.isAbsolute(relPath)) {
    throw new Error(`Unsafe content overlay path: ${relPath}`);
  }
  const allowed =
    relPath === "content" ||
    relPath.startsWith("content/") ||
    relPath === "public/uploads" ||
    relPath.startsWith("public/uploads/");
  if (!allowed) {
    throw new Error(
      `Refusing to overlay non-content path: ${relPath}. Add only content-owned paths to CONTENT_OVERLAY_PATHS.`,
    );
  }
}

function refHasPath(ref, relPath) {
  const result = spawnSync("git", ["cat-file", "-e", `${ref}:${relPath}`], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "ignore",
  });
  return result.status === 0;
}

function removeOverlayTargets(worktree, relPaths) {
  for (const relPath of relPaths) {
    fs.rmSync(path.join(worktree, relPath), { recursive: true, force: true });
  }
}

function overlayContent({ worktree, contentRef, relPaths }) {
  const existingPaths = relPaths.filter((relPath) => refHasPath(contentRef, relPath));
  if (existingPaths.length === 0) {
    throw new Error(`None of the content overlay paths exist at ${contentRef}: ${relPaths.join(", ")}`);
  }
  const archive = spawnSync("git", ["archive", "--format=tar", contentRef, "--", ...existingPaths], {
    cwd: ROOT,
    encoding: null,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (archive.status !== 0) {
    throw new Error(`git archive failed\n${String(archive.stderr || "")}`);
  }
  const tar = spawnSync("tar", ["-x", "-C", worktree], {
    input: archive.stdout,
    encoding: null,
    stdio: ["pipe", "inherit", "pipe"],
  });
  if (tar.status !== 0) {
    throw new Error(`tar extraction failed\n${String(tar.stderr || "")}`);
  }
  return existingPaths;
}

function parseWorkerVersionId(output) {
  const match = /Worker Version ID:\s*([0-9a-f-]+)/i.exec(output);
  return match ? match[1] : "";
}

function shellEnvForCloudflare(extra = {}) {
  loadProjectEnv({ cwd: ROOT, override: true });
  return {
    ...process.env,
    CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || "",
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || "",
    ...extra,
  };
}

function buildUploadMessage({ env, codeSha, codeBranch, contentSha, contentBranch }) {
  return [
    `Release upload (${env})`,
    `source=${contentSha}`,
    `branch=${contentBranch}`,
    `content=${contentSha}`,
    `contentBranch=${contentBranch}`,
    `code=${codeSha}`,
    `codeBranch=${codeBranch}`,
  ].join(" ");
}

async function main() {
  loadProjectEnv({ cwd: ROOT, override: true });
  const args = parseArgs();
  if (args.env !== "staging") {
    throw new Error("Content-overlay builds are only enabled for staging.");
  }

  const relPaths = readOverlayPaths();
  for (const relPath of relPaths) assertSafeOverlayPath(relPath);

  const codeSha = git(["rev-parse", args.codeRef], { capture: true });
  const codeBranchRaw = git(["rev-parse", "--abbrev-ref", args.codeRef], { capture: true });
  const codeBranch = codeBranchRaw === "HEAD" ? args.codeRef : codeBranchRaw;
  const contentSha = git(["rev-parse", args.contentRef], { capture: true });
  const contentBranch = args.contentRef;

  if (args.dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      env: args.env,
      codeRef: args.codeRef,
      codeSha,
      codeBranch,
      contentRef: args.contentRef,
      contentSha,
      contentBranch,
      overlayPaths: relPaths,
    }, null, 2));
    return;
  }

  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "jinnkunn-cf-overlay-"));
  fs.rmSync(worktree, { recursive: true, force: true });
  let worktreeAdded = false;
  try {
    git(["worktree", "add", "--detach", worktree, codeSha]);
    worktreeAdded = true;

    const rootNodeModules = path.join(ROOT, "node_modules");
    const worktreeNodeModules = path.join(worktree, "node_modules");
    if (fs.existsSync(rootNodeModules) && !fs.existsSync(worktreeNodeModules)) {
      fs.symlinkSync(rootNodeModules, worktreeNodeModules, "dir");
    }

    removeOverlayTargets(worktree, relPaths);
    const overlaidPaths = overlayContent({ worktree, contentRef: contentSha, relPaths });
    const metadataEnv = {
      ACTIVE_DEPLOY_CODE_SHA: codeSha,
      ACTIVE_DEPLOY_SOURCE_SHA: contentSha,
      DEPLOYED_CODE_SHA: codeSha,
      DEPLOYED_SOURCE_SHA: contentSha,
      GITHUB_SHA: codeSha,
      GITHUB_REF_NAME: codeBranch,
    };

    if (!args.skipBuild) {
      run("npm", ["run", "build:cf"], {
        cwd: worktree,
        env: shellEnvForCloudflare(metadataEnv),
        label: "overlay build:cf",
      });
    }

    let uploadedVersionId = null;
    const message = buildUploadMessage({
      env: args.env,
      codeSha,
      codeBranch,
      contentSha,
      contentBranch,
    });
    if (!args.skipUpload) {
      const uploadOutput = run(
        "npx",
        ["wrangler", "versions", "upload", "--env", args.env, "--message", message],
        {
          cwd: worktree,
          capture: true,
          env: shellEnvForCloudflare(metadataEnv),
          label: `overlay wrangler versions upload --env ${args.env}`,
        },
      );
      uploadedVersionId = parseWorkerVersionId(uploadOutput) || null;
    }

    console.log(JSON.stringify({
      ok: true,
      env: args.env,
      codeSha,
      codeBranch,
      contentSha,
      contentBranch,
      overlayPaths: overlaidPaths,
      buildRun: !args.skipBuild,
      uploadedVersionId,
      uploadMessage: message,
    }, null, 2));
  } finally {
    if (!args.keepWorktree) {
      if (worktreeAdded) {
        spawnSync("git", ["worktree", "remove", "--force", worktree], {
          cwd: ROOT,
          stdio: "ignore",
        });
      }
      fs.rmSync(worktree, { recursive: true, force: true });
    } else {
      console.log(`[content-overlay] kept worktree: ${worktree}`);
    }
  }
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
