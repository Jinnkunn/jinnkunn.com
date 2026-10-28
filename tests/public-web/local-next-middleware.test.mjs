import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { findAvailablePort, maskMiddlewareManifestForLocalNext, startNextServer, waitForHttp } from "../../scripts/_lib/local-next.mjs";

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

test("local Next QA bounds server cleanup even when graceful shutdown is ignored", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-next-stop-"));
  let server, stopped = false;
  try {
    const bin = path.join(root, "node_modules/next/dist/bin");
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, "next"), `const http = require("node:http");
process.on("SIGTERM", () => {});
const port = Number(process.argv[process.argv.indexOf("-p") + 1]);
http.createServer((_req, res) => res.end("fixture")).listen(port, "127.0.0.1");`);
    const port = await findAvailablePort();
    server = startNextServer({ root, port });
    const url = `http://127.0.0.1:${port}`;
    await waitForHttp(url);
    await server.stop(); stopped = true;
    await assert.rejects(fetch(url, { signal: AbortSignal.timeout(1000) }));
  } finally {
    if (server && !stopped) await server.stop();
    await rm(root, { recursive: true, force: true });
  }
});

