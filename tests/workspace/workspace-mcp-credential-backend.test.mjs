// Release builds of the desktop app store the Site Admin token in the OS
// keychain (secrets.rs picks LocalDb only under debug_assertions). A server
// that only reads workspace.db therefore finds nothing on a real install and
// silently degrades every siteAdmin.* write into editing files in whatever
// developer checkout happens to be on disk.
import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createWorkspaceMcpServer } from "../../scripts/workspace/workspace-mcp-server.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const KEYRING_SERVICE = "com.jinnkunn.workspace.site-admin";

function call(server, name, args = {}) {
  const response = server.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  assert.equal(response.error, undefined, response.error?.message);
  return JSON.parse(response.result.content[0].text);
}

// Only replies when the bearer token the keychain stub hands out is present,
// so a successful call proves the credential came from the keychain path.
const MOCK_SERVER_SOURCE = `
import http from "node:http";

const server = http.createServer(async (req, res) => {
  for await (const chunk of req) void chunk;
  const url = new URL(req.url, "http://mock.local");
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.headers.authorization !== "Bearer keychain-token") {
    return send(401, { ok: false, code: "UNAUTHORIZED", error: "missing keychain token" });
  }
  if (url.pathname === "/api/site-admin/posts") {
    return send(200, { ok: true, data: { posts: [{ slug: "hello", version: "p1" }] } });
  }
  return send(404, { ok: false, code: "NOT_FOUND", error: url.pathname });
});

server.listen(0, "127.0.0.1", () => {
  process.send?.({ baseUrl: "http://127.0.0.1:" + server.address().port });
});
process.on("message", (message) => {
  if (message?.type === "close") server.close(() => process.exit(0));
});
`;

test("workspace MCP: site-admin credentials resolve from the OS keychain", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-mcp-keychain-"));
  const binDir = path.join(dir, "bin");
  await fs.mkdir(binDir, { recursive: true });
  // Stand-in for /usr/bin/security: argv is
  //   find-generic-password -s <service> -a <account> -w
  await fs.writeFile(
    path.join(binDir, "security"),
    `#!/bin/sh
if [ "$1" != "find-generic-password" ]; then exit 44; fi
if [ "$3" != "${KEYRING_SERVICE}" ]; then exit 44; fi
case "$5" in
  "site-admin:token::"*) echo "keychain-token"; exit 0 ;;
esac
exit 44
`,
    { mode: 0o755 },
  );

  const settingsPath = path.join(dir, "mcp-settings.json");
  await fs.writeFile(
    settingsPath,
    JSON.stringify({
      enabled: true,
      writeMode: "local-write",
      requireConfirmationForWrites: false,
      allowSiteAdminWrite: true,
      siteAdminWriteTarget: "api",
      siteAdminFallbackToLocal: false,
    }),
  );

  const savedEnv = { ...process.env };
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
  delete process.env.WORKSPACE_SECRET_BACKEND;
  delete process.env.WORKSPACE_MCP_SITE_ADMIN_AUTH_TOKEN;
  process.env.WORKSPACE_MCP_SETTINGS_PATH = settingsPath;
  process.env.WORKSPACE_MCP_AUDIT_PATH = path.join(dir, "mcp-audit.jsonl");
  process.env.WORKSPACE_MCP_CONFIRMATIONS_PATH = path.join(dir, "mcp-confirmations.json");
  process.env.WORKSPACE_MCP_CONTENT_ROOT = path.join(dir, "content");
  process.env.WORKSPACE_MCP_CONTENT_SUGGESTION_PATH = path.join(dir, "suggestion.json");

  await fs.writeFile(path.join(dir, "mock.mjs"), MOCK_SERVER_SOURCE);
  const mock = fork(path.join(dir, "mock.mjs"), { stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let server;
  t.after(async () => {
    server?.close();
    mock.send?.({ type: "close" });
    await new Promise((resolve) => mock.once("exit", resolve));
    if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor);
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) delete process.env[key];
    }
    Object.assign(process.env, savedEnv);
    await fs.rm(dir, { recursive: true, force: true });
  });

  const baseUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("mock Site Admin server did not start")), 5000);
    mock.once("message", (message) => {
      clearTimeout(timer);
      resolve(message.baseUrl);
    });
    mock.once("error", reject);
  });

  server = createWorkspaceMcpServer({ dbPath: path.join(dir, "workspace.db") });
  // No secure_values row exists — the token can only come from the keychain.
  const listed = call(server, "siteAdmin.list_posts", { baseUrl });
  assert.equal(listed.backend, "api");
  assert.equal(listed.posts[0].slug, "hello");
});

test("MCP credential status reads through the active secret backend", async () => {
  const mcpRs = await fs.readFile(
    path.join(ROOT, "apps/workspace/src-tauri/src/mcp.rs"),
    "utf8",
  );
  // A direct secure_values probe reports "not signed in" forever on a release
  // build, where the credential lives in the keychain instead.
  assert.doesNotMatch(mcpRs, /SELECT value FROM secure_values/);
  assert.match(mcpRs, /crate::secrets::read_secret\(app, key\)/);
  assert.match(mcpRs, /crate::secrets::active_backend_label\(\)/);

  const serverSource = await fs.readFile(
    path.join(ROOT, "scripts/workspace/workspace-mcp-server.mjs"),
    "utf8",
  );
  assert.match(serverSource, /const WORKSPACE_KEYRING_SERVICE = "com\.jinnkunn\.workspace\.site-admin"/);
  assert.match(serverSource, /find-generic-password/);
});
