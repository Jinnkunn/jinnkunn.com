#!/usr/bin/env node

import fs from "node:fs";
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
  const githubPrivateKeyFile = process.env.GITHUB_APP_PRIVATE_KEY_FILE
    ? path.resolve(ROOT, process.env.GITHUB_APP_PRIVATE_KEY_FILE)
    : "";
  return {
    ...process.env,
    CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || "",
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || "",
    ...(githubPrivateKeyFile ? { GITHUB_APP_PRIVATE_KEY_FILE: githubPrivateKeyFile } : {}),
    ...extra,
  };
}

function materializeNodeModules(worktree) {
  const rootNodeModules = path.join(ROOT, "node_modules");
  const worktreeNodeModules = path.join(worktree, "node_modules");
  if (!fs.existsSync(rootNodeModules) || fs.existsSync(worktreeNodeModules)) return;

  console.log("[content-overlay] materializing node_modules for overlay build");
  if (process.platform === "darwin") {
    const clone = spawnSync("cp", ["-cR", rootNodeModules, worktreeNodeModules], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (clone.status === 0 && fs.existsSync(worktreeNodeModules)) {
      if (!fs.lstatSync(worktreeNodeModules).isSymbolicLink()) return;
      fs.rmSync(worktreeNodeModules, { recursive: true, force: true });
    }
    const output = `${clone.stdout || ""}${clone.stderr || ""}`.trim();
    if (output) console.warn(`[content-overlay] APFS clone copy failed, falling back to fs.cpSync\n${output}`);
  }

  fs.cpSync(rootNodeModules, worktreeNodeModules, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
  });
  if (fs.lstatSync(worktreeNodeModules).isSymbolicLink()) {
    throw new Error("Content overlay node_modules must be a real directory, not a symlink.");
  }
}

function assertMaterializedOpenNextOutput(worktree) {
  const outputNodeModules = path.join(worktree, ".open-next", "server-functions", "default", "node_modules");
  if (!fs.existsSync(outputNodeModules)) return;
  if (fs.lstatSync(outputNodeModules).isSymbolicLink()) {
    throw new Error(
      "OpenNext emitted a symlinked server node_modules directory. Refusing to upload an overlay build that can fail dynamic require resolution on Cloudflare.",
    );
  }
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

function assertProductionOverlayAllowed({ env, dryRun, codeSha }) {
  if (env !== "production" || dryRun) return;
  if (String(process.env.CONFIRM_PRODUCTION_DEPLOY || "").trim() !== "1") {
    throw new Error("CONFIRM_PRODUCTION_DEPLOY=1 is required for production content-overlay builds.");
  }
  const confirmedSha = String(process.env.CONFIRM_PRODUCTION_SHA || "").trim();
  if (!confirmedSha) {
    throw new Error(`CONFIRM_PRODUCTION_SHA=${codeSha} is required for production content-overlay builds.`);
  }
  if (confirmedSha !== codeSha) {
    throw new Error(`CONFIRM_PRODUCTION_SHA does not match code ref ${codeSha}.`);
  }
}

async function main() {
  loadProjectEnv({ cwd: ROOT, override: true });
  const args = parseArgs();

  const relPaths = readOverlayPaths();
  for (const relPath of relPaths) assertSafeOverlayPath(relPath);

  const codeSha = git(["rev-parse", args.codeRef], { capture: true });
  const codeBranchRaw = git(["rev-parse", "--abbrev-ref", args.codeRef], { capture: true });
  const codeBranch = codeBranchRaw === "HEAD" ? args.codeRef : codeBranchRaw;
  const contentSha = git(["rev-parse", args.contentRef], { capture: true });
  const contentBranch = args.contentRef;
  assertProductionOverlayAllowed({ env: args.env, dryRun: args.dryRun, codeSha });

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

  const worktreeBaseDir = process.env.CONTENT_OVERLAY_WORKTREE_DIR
    ? path.resolve(ROOT, process.env.CONTENT_OVERLAY_WORKTREE_DIR)
    : path.dirname(ROOT);
  fs.mkdirSync(worktreeBaseDir, { recursive: true });
  const worktree = fs.mkdtempSync(path.join(worktreeBaseDir, ".jinnkunn-cf-overlay-"));
  fs.rmSync(worktree, { recursive: true, force: true });
  let worktreeAdded = false;
  try {
    git(["worktree", "add", "--detach", worktree, codeSha]);
    worktreeAdded = true;
    materializeNodeModules(worktree);

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
      assertMaterializedOpenNextOutput(worktree);
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
