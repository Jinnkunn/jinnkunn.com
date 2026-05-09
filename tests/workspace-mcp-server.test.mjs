import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createWorkspaceMcpServer } from "../scripts/workspace-mcp-server.mjs";

function call(server, name, args = {}) {
  const response = server.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  assert.equal(response.error, undefined);
  const text = response.result.content[0].text;
  return JSON.parse(text);
}

async function withServer(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-mcp-"));
  const dbPath = path.join(dir, "workspace.db");
  const previousSettingsPath = process.env.WORKSPACE_MCP_SETTINGS_PATH;
  const previousAuditPath = process.env.WORKSPACE_MCP_AUDIT_PATH;
  process.env.WORKSPACE_MCP_SETTINGS_PATH = path.join(dir, "mcp-settings.json");
  process.env.WORKSPACE_MCP_AUDIT_PATH = path.join(dir, "mcp-audit.jsonl");
  const server = createWorkspaceMcpServer({ dbPath });
  try {
    await fn(server, dbPath);
  } finally {
    server.close();
    if (previousSettingsPath === undefined) {
      delete process.env.WORKSPACE_MCP_SETTINGS_PATH;
    } else {
      process.env.WORKSPACE_MCP_SETTINGS_PATH = previousSettingsPath;
    }
    if (previousAuditPath === undefined) {
      delete process.env.WORKSPACE_MCP_AUDIT_PATH;
    } else {
      process.env.WORKSPACE_MCP_AUDIT_PATH = previousAuditPath;
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("workspace MCP: lists tools and exposes context resource", async () => {
  await withServer(async (server) => {
    const tools = server.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    assert.equal(tools.result.tools.length, 15);
    assert.deepEqual(
      tools.result.tools.map((tool) => tool.name).slice(0, 4),
      ["workspace.get_context", "workspace.search", "notes.get_page", "notes.create_page"],
    );

    const resource = server.handle({
      jsonrpc: "2.0",
      id: 2,
      method: "resources/read",
      params: { uri: "workspace://context" },
    });
    const context = JSON.parse(resource.result.contents[0].text);
    assert.equal(context.app, "Jinnkunn Workspace");
    assert.equal(context.counts.notes, 0);
  });
});

test("workspace MCP: shared settings can disable writes", async () => {
  await withServer(async (server) => {
    await fs.writeFile(
      process.env.WORKSPACE_MCP_SETTINGS_PATH,
      JSON.stringify({
        enabled: true,
        writeMode: "read-only",
        allowNotesWrite: true,
        allowTodosWrite: true,
        allowProjectsWrite: true,
        allowCalendarWrite: false,
      }),
    );
    const response = server.handle({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "notes.create_page", arguments: { title: "Blocked" } },
    });
    assert.match(response.error.message, /read-only/i);

    const context = call(server, "workspace.get_context", { includeRecent: false });
    assert.equal(context.writeMode, "read-only");
  });
});

test("workspace MCP: dry-run and create Notes without touching UI", async () => {
  await withServer(async (server) => {
    const dryRun = call(server, "notes.create_page", {
      title: "MCP Test",
      bodyMdx: "hello",
      dryRun: true,
    });
    assert.equal(dryRun.dryRun, true);
    assert.equal(call(server, "workspace.get_context", { includeRecent: false }).counts.notes, 0);

    const created = call(server, "notes.create_page", {
      title: "MCP Test",
      bodyMdx: "hello",
    });
    assert.equal(created.note.title, "MCP Test");

    const appended = call(server, "notes.append_blocks", {
      pageId: created.note.id,
      blocks: ["## Next", "More text"],
    });
    assert.match(appended.note.bodyMdx, /## Next/);

    const search = call(server, "workspace.search", { query: "More", types: ["note"] });
    assert.equal(search.results[0].id, created.note.id);
  });
});

test("workspace MCP: creates projects, todos, and project links", async () => {
  await withServer(async (server) => {
    const project = call(server, "projects.create", {
      title: "Ship MCP",
      description: "Local-first AI tools",
    }).project;
    assert.equal(project.title, "Ship MCP");

    const todo = call(server, "todos.create", {
      title: "Write docs",
      projectId: project.id,
    }).todo;
    assert.equal(todo.projectId, project.id);

    const completed = call(server, "todos.complete", { id: todo.id }).todo;
    assert.ok(completed.completedAt);

    const link = call(server, "projects.add_link", {
      projectId: project.id,
      targetType: "url",
      url: "https://example.com",
      label: "Reference",
    });
    assert.equal(link.project.links[0].label, "Reference");
  });
});
