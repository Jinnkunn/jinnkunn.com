// P0-5: a post deleted in Site Admin used to come back on the next publish,
// because the dump only ever wrote files and the publish path fed it a git
// checkout that still carried the .mdx.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  findOrphanContentFiles,
  pruneOrphanContentFiles,
} from "../../scripts/content/dump-content-from-db.mjs";

async function makeTargetTree(files) {
  const target = await mkdtemp(path.join(tmpdir(), "dump-prune-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(target, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, body);
  }
  return target;
}

async function listTree(target, relDir = "") {
  const out = [];
  for (const entry of await readdir(path.join(target, relDir), { withFileTypes: true })) {
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listTree(target, rel)));
    else out.push(rel);
  }
  return out.sort();
}

test("dump prune: detects content files D1 no longer has", async () => {
  const target = await makeTargetTree({
    "posts/kept.mdx": "kept",
    "posts/deleted-in-admin.mdx": "stale",
    "pages/about.mdx": "about",
  });
  const orphans = await findOrphanContentFiles({
    seenInDb: new Set(["posts/kept.mdx", "pages/about.mdx"]),
    target,
  });
  assert.deepEqual(orphans, ["posts/deleted-in-admin.mdx"]);
});

test("dump prune: exempts generated/, local/ and dot-entries", async () => {
  const target = await makeTargetTree({
    "generated/notion.json": "{}",
    "local/site-config.json": "{}",
    "posts/.DS_Store": "junk",
    "posts/kept.mdx": "kept",
  });
  const orphans = await findOrphanContentFiles({
    seenInDb: new Set(["posts/kept.mdx"]),
    target,
  });
  assert.deepEqual(orphans, []);
});

test("dump prune: deletes orphans and leaves live files alone", async () => {
  const target = await makeTargetTree({
    "posts/kept.mdx": "kept",
    "posts/gone.mdx": "stale",
    "generated/notion.json": "{}",
  });
  const pruned = await pruneOrphanContentFiles({
    seenInDb: new Set(["posts/kept.mdx"]),
    target,
  });
  assert.deepEqual(pruned, ["posts/gone.mdx"]);
  assert.deepEqual(await listTree(target), ["generated/notion.json", "posts/kept.mdx"]);
  assert.equal(await readFile(path.join(target, "posts/kept.mdx"), "utf8"), "kept");
});

test("dump prune: dry run reports orphans without deleting", async () => {
  const target = await makeTargetTree({
    "posts/kept.mdx": "kept",
    "posts/gone.mdx": "stale",
  });
  const pruned = await pruneOrphanContentFiles({
    dryRun: true,
    seenInDb: new Set(["posts/kept.mdx"]),
    target,
  });
  assert.deepEqual(pruned, ["posts/gone.mdx"]);
  assert.deepEqual(await listTree(target), ["posts/gone.mdx", "posts/kept.mdx"]);
});

test("dump prune: refuses to empty content/ when D1 returned nothing", async () => {
  const target = await makeTargetTree({ "posts/kept.mdx": "kept" });
  await assert.rejects(
    () => pruneOrphanContentFiles({ seenInDb: new Set(), target }),
    /no content_files rows/,
  );
  assert.deepEqual(await listTree(target), ["posts/kept.mdx"]);
});

// The candidate list unions the filesystem walk with `git ls-files`. Run it
// against the repo's own content/ so the git branch is actually exercised: if
// the NUL-delimited output were parsed as newline-delimited, the whole listing
// would collapse into one bogus path and show up as an orphan.
test("dump prune: git-listed candidates match the paths D1 stores", async () => {
  const target = path.join(process.cwd(), "content");
  const onDisk = (await listTree(target)).filter((rel) => {
    const parts = rel.split("/");
    if (parts.some((part) => part.startsWith("."))) return false;
    return parts[0] !== "generated" && parts[0] !== "local";
  });
  const orphans = await findOrphanContentFiles({ seenInDb: new Set(onDisk), target });
  assert.deepEqual(orphans, []);
});

test("dump prune: the publish path asks for it", async () => {
  const script = await readFile(
    path.join(process.cwd(), "scripts/content/publish-content.mjs"),
    "utf8",
  );
  const sync = script.slice(
    script.indexOf("function syncD1ToContent"),
    script.indexOf("function buildStaticShells"),
  );
  assert.match(sync, /"--prune"/);
});
