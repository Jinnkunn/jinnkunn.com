// siteAdmin.create_page / update_page / delete_page do two API calls: the
// page write, then the nav-tree save. If the second fails the site is left
// half-updated, and the audit log has to say so — otherwise the only record
// of the operation reads as a clean success.
import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createWorkspaceMcpServer } from "../../scripts/workspace/workspace-mcp-server.mjs";

function call(server, name, args = {}) {
  const response = server.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  assert.equal(response.error, undefined);
  return JSON.parse(response.result.content[0].text);
}

// The MCP server issues its HTTP calls through a blocking spawnSync child, so
// the mock endpoint has to live in a separate process or it could never reply.
const MOCK_SERVER_SOURCE = `
import http from "node:http";

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const url = new URL(req.url, "http://mock.local");
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "POST" && url.pathname === "/api/site-admin/pages") {
    return send(201, { ok: true, data: { slug: "docs", version: "v1" } });
  }
  if (req.method === "GET" && url.pathname === "/api/site-admin/pages/tree") {
    return send(200, { ok: true, data: { slugs: [], sourceVersion: { fileSha: "t1" } } });
  }
  if (req.method === "POST" && url.pathname === "/api/site-admin/pages/tree") {
    return send(500, { ok: false, code: "TREE_WRITE_FAILED", error: "nav tree save exploded" });
  }
  return send(404, { ok: false, code: "NOT_FOUND", error: req.method + " " + url.pathname });
});

server.listen(0, "127.0.0.1", () => {
  process.send?.({ baseUrl: "http://127.0.0.1:" + server.address().port });
});
process.on("message", (message) => {
  if (message?.type === "close") server.close(() => process.exit(0));
});
`;

async function withHarness(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-mcp-tree-"));
  const scriptPath = path.join(dir, "mock-site-admin.mjs");
  await fs.writeFile(scriptPath, MOCK_SERVER_SOURCE);
  const auditPath = path.join(dir, "mcp-audit.jsonl");
  const settingsPath = path.join(dir, "mcp-settings.json");
  const saved = {
    settings: process.env.WORKSPACE_MCP_SETTINGS_PATH,
    audit: process.env.WORKSPACE_MCP_AUDIT_PATH,
    confirmations: process.env.WORKSPACE_MCP_CONFIRMATIONS_PATH,
    contentRoot: process.env.WORKSPACE_MCP_CONTENT_ROOT,
    suggestion: process.env.WORKSPACE_MCP_CONTENT_SUGGESTION_PATH,
    secretBackend: process.env.WORKSPACE_SECRET_BACKEND,
  };
  // Keep credential resolution inside this temp workspace.db instead of the
  // developer's real keychain.
  process.env.WORKSPACE_SECRET_BACKEND = "local-db";
  process.env.WORKSPACE_MCP_SETTINGS_PATH = settingsPath;
  process.env.WORKSPACE_MCP_AUDIT_PATH = auditPath;
  process.env.WORKSPACE_MCP_CONFIRMATIONS_PATH = path.join(dir, "mcp-confirmations.json");
  process.env.WORKSPACE_MCP_CONTENT_ROOT = path.join(dir, "content");
  process.env.WORKSPACE_MCP_CONTENT_SUGGESTION_PATH = path.join(dir, "suggestion.json");
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

  const child = fork(scriptPath, { stdio: ["ignore", "pipe", "pipe", "ipc"] });
  const baseUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("mock Site Admin server did not start")), 5000);
    child.once("message", (message) => {
      clearTimeout(timer);
      resolve(message.baseUrl);
    });
    child.once("error", reject);
  });

  const server = createWorkspaceMcpServer({ dbPath: path.join(dir, "workspace.db") });
  try {
    await fn({
      server,
      baseUrl,
      async auditLines() {
        const raw = await fs.readFile(auditPath, "utf8").catch(() => "");
        return raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
      },
    });
  } finally {
    server.close();
    child.send?.({ type: "close" });
    await new Promise((resolve) => child.once("exit", resolve));
    for (const [key, value] of [
      ["WORKSPACE_MCP_SETTINGS_PATH", saved.settings],
      ["WORKSPACE_MCP_AUDIT_PATH", saved.audit],
      ["WORKSPACE_MCP_CONFIRMATIONS_PATH", saved.confirmations],
      ["WORKSPACE_MCP_CONTENT_ROOT", saved.contentRoot],
      ["WORKSPACE_MCP_CONTENT_SUGGESTION_PATH", saved.suggestion],
      ["WORKSPACE_SECRET_BACKEND", saved.secretBackend],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("workspace MCP: a failed nav-tree save is audited as a partial create", async () => {
  await withHarness(async ({ server, baseUrl, auditLines }) => {
    const created = call(server, "siteAdmin.create_page", {
      baseUrl,
      authToken: "test-token",
      slug: "docs",
      title: "Docs",
      bodyMdx: "Docs body",
      addToNavigation: true,
    });

    assert.equal(created.backend, "api");
    assert.equal(created.status, "partial");
    assert.equal(created.page.treeUpdated, false);
    assert.match(created.page.treeError, /TREE_WRITE_FAILED|nav tree save exploded/);

    const audit = await auditLines();
    const entry = audit.find((line) => line.tool === "siteAdmin.create_page");
    assert.ok(entry, "expected a create_page audit entry");
    assert.equal(entry.status, "partial");
    assert.equal(entry.treeUpdated, false);
    assert.match(entry.treeError, /TREE_WRITE_FAILED|nav tree save exploded/);
  });
});
