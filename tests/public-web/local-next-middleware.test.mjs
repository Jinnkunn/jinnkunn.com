import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { maskMiddlewareManifestForLocalNext } from "../../scripts/_lib/local-next.mjs";

test("local Next QA can temporarily mask middleware manifest and restore it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-next-middleware-"));
  try {
    const manifestDir = path.join(root, ".next", "server");
    const manifestPath = path.join(manifestDir, "middleware-manifest.json");
    const original = JSON.stringify({
      version: 3,
      middleware: { "/": { name: "middleware" } },
      functions: {},
      sortedMiddleware: ["/"],
    });

    await mkdir(manifestDir, { recursive: true });
    await writeFile(manifestPath, original);

    const restore = maskMiddlewareManifestForLocalNext(root);
    const masked = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.deepEqual(masked, {
      version: 3,
      middleware: {},
      functions: {},
      sortedMiddleware: [],
    });

    restore();
    assert.equal(await readFile(manifestPath, "utf8"), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

