import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  createWorkspaceMcpServer,
  decideWorkspaceMcpConfirmation,
  listWorkspaceMcpConfirmations,
  workspaceMcpToolCount,
} from "../../scripts/workspace/workspace-mcp-server.mjs";

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
  const previousConfirmationsPath = process.env.WORKSPACE_MCP_CONFIRMATIONS_PATH;
  const previousContentRoot = process.env.WORKSPACE_MCP_CONTENT_ROOT;
  const previousSuggestionPath = process.env.WORKSPACE_MCP_CONTENT_SUGGESTION_PATH;
  const settingsPath = path.join(dir, "mcp-settings.json");
  const confirmationsPath = path.join(dir, "mcp-confirmations.json");
  const contentRoot = path.join(dir, "content");
  process.env.WORKSPACE_MCP_SETTINGS_PATH = path.join(dir, "mcp-settings.json");
  process.env.WORKSPACE_MCP_AUDIT_PATH = path.join(dir, "mcp-audit.jsonl");
  process.env.WORKSPACE_MCP_CONFIRMATIONS_PATH = confirmationsPath;
  process.env.WORKSPACE_MCP_CONTENT_ROOT = contentRoot;
  process.env.WORKSPACE_MCP_CONTENT_SUGGESTION_PATH = path.join(
    dir,
    "site-admin-content-publish-suggestion.json",
  );
  const server = createWorkspaceMcpServer({ dbPath });
  try {
    await fs.writeFile(
      settingsPath,
      JSON.stringify({
        enabled: true,
        writeMode: "local-write",
        requireConfirmationForWrites: false,
        allowNotesWrite: true,
        allowTodosWrite: true,
        allowProjectsWrite: true,
        allowContactsWrite: true,
        allowSiteAdminWrite: true,
        allowReleaseWrite: false,
        allowCalendarWrite: false,
      }),
    );
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
    if (previousConfirmationsPath === undefined) {
      delete process.env.WORKSPACE_MCP_CONFIRMATIONS_PATH;
    } else {
      process.env.WORKSPACE_MCP_CONFIRMATIONS_PATH = previousConfirmationsPath;
    }
    if (previousContentRoot === undefined) {
      delete process.env.WORKSPACE_MCP_CONTENT_ROOT;
    } else {
      process.env.WORKSPACE_MCP_CONTENT_ROOT = previousContentRoot;
    }
    if (previousSuggestionPath === undefined) {
      delete process.env.WORKSPACE_MCP_CONTENT_SUGGESTION_PATH;
    } else {
      process.env.WORKSPACE_MCP_CONTENT_SUGGESTION_PATH = previousSuggestionPath;
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function withMockSiteAdminServer(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-mcp-http-"));
  const logPath = path.join(dir, "requests.jsonl");
  const scriptPath = path.join(dir, "server.mjs");
  await fs.writeFile(
    scriptPath,
    `
import fs from "node:fs";
import http from "node:http";

const LOG_PATH = ${JSON.stringify(logPath)};

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function ok(data, status = 200) {
  return { status, body: { ok: true, data } };
}

function notFound(method, pathname) {
  return { status: 404, body: { ok: false, code: "NOT_FOUND", error: method + " " + pathname } };
}

function route(req) {
  const url = new URL(req.url, "http://mock.local");
  const body = req.body || {};
  if (req.method === "GET" && url.pathname === "/api/site-admin/posts") return ok({ posts: [{ slug: "hello", title: "Hello", version: "p1" }] });
  if (req.method === "GET" && url.pathname === "/api/site-admin/posts/hello") return ok({ slug: "hello", title: "Hello", source: "---\\\\ntitle: Hello\\\\n---", version: "p1" });
  if (req.method === "POST" && url.pathname === "/api/site-admin/posts") {
    if (body.slug !== "new-post") return { status: 400, body: { ok: false, code: "BAD_BODY", error: "unexpected post slug" } };
    return ok({ slug: "new-post", version: "p2" }, 201);
  }
  if (req.method === "PATCH" && url.pathname === "/api/site-admin/posts/new-post") {
    if (body.version !== "p2") return { status: 409, body: { ok: false, code: "BAD_VERSION", error: "expected p2" } };
    return ok({ slug: "new-post", version: "p3" });
  }
  if (req.method === "DELETE" && url.pathname === "/api/site-admin/posts/new-post") {
    if (body.version !== "p3") return { status: 409, body: { ok: false, code: "BAD_VERSION", error: "expected p3" } };
    return ok({ deleted: true });
  }
  if (req.method === "POST" && url.pathname === "/api/site-admin/posts/move") return ok({ moved: true, fromSlug: body.fromSlug, toSlug: body.toSlug });
  if (req.method === "GET" && url.pathname === "/api/site-admin/components") return ok({ components: [{ name: "Callout" }], usage: {}, summaries: [] });
  if (req.method === "GET" && url.pathname === "/api/site-admin/components/Callout") return ok({ name: "Callout", source: "export default {}", version: "c1" });
  if (req.method === "PATCH" && url.pathname === "/api/site-admin/components/Callout") {
    if (body.version !== "c1") return { status: 409, body: { ok: false, code: "BAD_VERSION", error: "expected c1" } };
    return ok({ name: "Callout", version: "c2" });
  }
  if (req.method === "GET" && url.pathname === "/api/site-admin/assets") return ok({ assets: [{ key: "a.png", version: "a1" }] });
  if (req.method === "POST" && url.pathname === "/api/site-admin/assets") {
    if (body.base64 !== "YXNzZXQ=") return { status: 400, body: { ok: false, code: "BAD_BODY", error: "unexpected asset base64" } };
    return ok({ key: "asset.txt", version: "a2" }, 201);
  }
  if (req.method === "DELETE" && url.pathname === "/api/site-admin/assets") {
    if (body.key !== "asset.txt") return { status: 400, body: { ok: false, code: "BAD_BODY", error: "unexpected asset key" } };
    return ok({ deleted: true });
  }
  if (req.method === "GET" && url.pathname === "/api/site-admin/config") return ok({ sourceVersion: { siteConfigSha: "cfg1" }, settings: [] });
  if (req.method === "POST" && url.pathname === "/api/site-admin/config") return ok({ sourceVersion: { siteConfigSha: "cfg2" }, command: body.kind });
  if (req.method === "GET" && url.pathname === "/api/site-admin/routes") return ok({ sourceVersion: { siteConfigSha: "cfg1", protectedRoutesSha: "prot1" }, routes: [] });
  if (req.method === "POST" && url.pathname === "/api/site-admin/routes") return ok({ updated: true, command: body.kind });
  if (req.method === "GET" && url.pathname === "/api/site-admin/release-jobs") return ok({ jobs: [{ id: "job1" }], runners: [], actions: [] });
  if (req.method === "GET" && url.pathname === "/api/site-admin/release-jobs/job1") return ok({ job: { id: "job1" }, events: [] });
  if (req.method === "POST" && url.pathname === "/api/site-admin/release-jobs/smart") return ok({ job: { id: "job-smart", action: "smart-release" }, wake: { ok: true } }, 202);
  if (req.method === "GET" && url.pathname === "/api/site-admin/calendar-observations") return ok({ health: { status: "ok" } });
  if (req.method === "POST" && url.pathname === "/api/site-admin/calendar-observations/publish-live") return ok({ rowsWritten: 2, tables: ["calendar_sync_sources"] });
  if (req.method === "GET" && url.pathname === "/api/public/calendar") return { status: 200, body: { generatedAt: "2026-05-19T00:00:00Z", events: [{ id: "event1" }] } };
  return notFound(req.method, url.pathname);
}

const server = http.createServer(async (request, res) => {
  try {
    const body = await readBody(request);
    const entry = { method: request.method, url: request.url, headers: request.headers, body };
    fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\\n");
    sendJson(res, ...(Object.values(route(entry))));
  } catch (error) {
    sendJson(res, 500, { ok: false, code: "MOCK_ERROR", error: error?.message || String(error) });
  }
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  process.send?.({ baseUrl: "http://127.0.0.1:" + address.port });
});

process.on("message", (message) => {
  if (message?.type === "close") server.close(() => process.exit(0));
});
`,
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
  const requests = {
    async all() {
      try {
        const raw = await fs.readFile(logPath, "utf8");
        return raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
      } catch (error) {
        if (error?.code === "ENOENT") return [];
        throw error;
      }
    },
    async count() {
      return (await this.all()).length;
    },
  };
  try {
    await fn(baseUrl, requests);
  } finally {
    child.send?.({ type: "close" });
    await new Promise((resolve) => child.once("exit", resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("workspace MCP: lists tools and exposes context resource", async () => {
  await withServer(async (server) => {
    const tools = server.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    assert.equal(tools.result.tools.length, workspaceMcpToolCount());
    assert.equal(tools.result.tools.length, 77);
    assert.deepEqual(
      tools.result.tools.map((tool) => tool.name).slice(0, 4),
      ["workspace.get_context", "workspace.search", "notes.list_pages", "notes.get_page"],
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
        requireConfirmationForWrites: false,
        allowNotesWrite: true,
        allowTodosWrite: true,
        allowProjectsWrite: true,
        allowContactsWrite: true,
        allowSiteAdminWrite: true,
        allowReleaseWrite: false,
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

test("workspace MCP: write confirmations gate mutations until approved", async () => {
  await withServer(async (server) => {
    await fs.writeFile(
      process.env.WORKSPACE_MCP_SETTINGS_PATH,
      JSON.stringify({
        enabled: true,
        writeMode: "local-write",
        requireConfirmationForWrites: true,
        allowNotesWrite: true,
        allowTodosWrite: true,
        allowProjectsWrite: true,
        allowContactsWrite: true,
        allowSiteAdminWrite: true,
        allowReleaseWrite: false,
        allowCalendarWrite: false,
      }),
    );

    const pending = call(server, "notes.create_page", {
      title: "Needs Approval",
      bodyMdx: "queued",
    });
    assert.equal(pending.confirmationRequired, true);
    assert.equal(pending.status, "pending");
    assert.equal(call(server, "workspace.get_context", { includeRecent: false }).counts.notes, 0);

    assert.equal(listWorkspaceMcpConfirmations("pending").length, 1);
    const approved = decideWorkspaceMcpConfirmation(pending.confirmationId, "approve");
    assert.equal(approved.status, "approved");

    const created = call(server, "notes.create_page", {
      title: "Needs Approval",
      bodyMdx: "queued",
      confirmationId: pending.confirmationId,
    });
    assert.equal(created.note.title, "Needs Approval");

    const consumed = JSON.parse(await fs.readFile(process.env.WORKSPACE_MCP_CONFIRMATIONS_PATH, "utf8"));
    assert.equal(consumed[0].status, "consumed");
    assert.equal(call(server, "workspace.get_context", { includeRecent: false }).counts.notes, 1);
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

    const listed = call(server, "notes.list_pages", { rootOnly: true });
    assert.equal(listed.notes[0].id, created.note.id);
    assert.equal(call(server, "notes.get_page", { id: created.note.id }).note.title, "MCP Test");

    const appended = call(server, "notes.append_blocks", {
      pageId: created.note.id,
      blocks: ["## Next", "More text"],
    });
    assert.match(appended.note.bodyMdx, /## Next/);

    const updated = call(server, "notes.update_page", {
      id: created.note.id,
      title: "MCP Test Updated",
    }).note;
    assert.equal(updated.title, "MCP Test Updated");

    const child = call(server, "notes.create_page", {
      title: "Child",
      parentId: created.note.id,
    }).note;
    assert.equal(call(server, "notes.list_pages", { parentId: created.note.id }).notes[0].id, child.id);

    const moved = call(server, "notes.move_page", {
      id: child.id,
      parentId: null,
      beforeId: created.note.id,
    }).note;
    assert.equal(moved.parentId, null);
    assert.equal(call(server, "notes.list_pages", { rootOnly: true }).notes.length, 2);

    const archived = call(server, "notes.archive_page", { id: child.id });
    assert.deepEqual(archived.archived, [child.id]);
    assert.equal(call(server, "notes.get_page", { id: child.id }).note, null);

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
    assert.equal(call(server, "todos.get", { id: todo.id }).todo.title, "Write docs");
    assert.equal(call(server, "todos.list", { projectId: project.id }).todos[0].id, todo.id);

    const completed = call(server, "todos.complete", { id: todo.id }).todo;
    assert.ok(completed.completedAt);

    const updatedProject = call(server, "projects.update", {
      id: project.id,
      patch: { status: "paused", pinned: true },
    }).project;
    assert.equal(updatedProject.status, "paused");
    assert.ok(updatedProject.pinnedAt);
    assert.equal(call(server, "projects.list", { status: "paused" }).projects[0].id, project.id);

    const link = call(server, "projects.add_link", {
      projectId: project.id,
      targetType: "url",
      url: "https://example.com",
      label: "Reference",
    });
    assert.equal(link.project.links[0].label, "Reference");

    const removedLink = call(server, "projects.remove_link", {
      projectId: project.id,
      linkId: link.project.links[0].id,
    });
    assert.equal(removedLink.removed, true);
    assert.equal(removedLink.project.links.length, 0);

    const archivedTodo = call(server, "todos.archive", { id: todo.id });
    assert.equal(archivedTodo.archived, true);
    assert.equal(call(server, "todos.list", { status: "all" }).todos.length, 0);

    const archivedProject = call(server, "projects.archive", { id: project.id });
    assert.equal(archivedProject.archived, true);
    assert.equal(call(server, "projects.list").projects.length, 0);

    const restoredProject = call(server, "projects.unarchive", { id: project.id });
    assert.equal(restoredProject.archived, false);
    assert.equal(call(server, "projects.list", { includeArchived: true }).projects.length, 1);
  });
});

test("workspace MCP: manages local contacts", async () => {
  await withServer(async (server) => {
    const contact = call(server, "contacts.create", {
      displayName: "Ada Lovelace",
      company: "Analytical Engines",
      role: "Researcher",
      emails: ["ada@example.com"],
      tags: ["research"],
      notes: "Follow up about notes.",
    }).contact;
    assert.equal(contact.displayName, "Ada Lovelace");
    assert.deepEqual(contact.emails, ["ada@example.com"]);

    const listed = call(server, "contacts.list", { query: "Analytical" });
    assert.equal(listed.contacts[0].id, contact.id);
    assert.equal(call(server, "contacts.get", { id: contact.id }).contact.tags[0], "research");

    const updated = call(server, "contacts.update", {
      id: contact.id,
      patch: { role: "Collaborator", pinned: true, tags: ["research", "mcp"] },
    }).contact;
    assert.equal(updated.role, "Collaborator");
    assert.ok(updated.pinnedAt);
    assert.deepEqual(updated.tags, ["research", "mcp"]);

    const archived = call(server, "contacts.archive", { id: contact.id });
    assert.equal(archived.archived, true);
    assert.equal(call(server, "contacts.list").contacts.length, 0);
    assert.equal(call(server, "contacts.list", { includeArchived: true }).contacts[0].id, contact.id);
  });
});

test("workspace MCP: manages local calendars and events", async () => {
  await withServer(async (server) => {
    await fs.writeFile(
      process.env.WORKSPACE_MCP_SETTINGS_PATH,
      JSON.stringify({
        enabled: true,
        writeMode: "local-write",
        requireConfirmationForWrites: false,
        allowNotesWrite: true,
        allowTodosWrite: true,
        allowProjectsWrite: true,
        allowContactsWrite: true,
        allowSiteAdminWrite: true,
        allowReleaseWrite: false,
        allowCalendarWrite: true,
      }),
    );

    const dryRun = call(server, "calendar.create_calendar", {
      title: "MCP Calendar",
      colorHex: "#ff8800",
      dryRun: true,
    });
    assert.equal(dryRun.dryRun, true);
    assert.equal(call(server, "workspace.get_context", { includeRecent: false }).counts.localCalendars, 0);

    const calendar = call(server, "calendar.create_calendar", {
      title: "MCP Calendar",
      colorHex: "#ff8800",
    }).calendar;
    assert.equal(calendar.title, "MCP Calendar");
    assert.equal(calendar.colorHex, "#FF8800");

    const calendars = call(server, "calendar.list_calendars");
    assert.equal(calendars.source.id, "workspace-local");
    assert.equal(calendars.calendars[0].id, calendar.id);

    const event = call(server, "calendar.create_event", {
      calendarId: calendar.id,
      title: "Design MCP Calendar",
      startsAt: "2026-05-10T09:00:00-03:00",
      endsAt: "2026-05-10T09:30:00-03:00",
      notes: "Initial notes",
      location: "Desk",
    }).event;
    assert.equal(event.calendarId, calendar.id);
    assert.equal(event.title, "Design MCP Calendar");
    assert.equal(event.isRecurring, false);
    assert.equal(call(server, "calendar.get_event", { id: event.eventIdentifier }).event.title, "Design MCP Calendar");

    const events = call(server, "calendar.list_events", {
      start: "2026-05-10T00:00:00-03:00",
      end: "2026-05-11T00:00:00-03:00",
    }).events;
    assert.equal(events[0].eventIdentifier, event.eventIdentifier);

    const updatedEvent = call(server, "calendar.update_event", {
      id: event.eventIdentifier,
      title: "Ship MCP Calendar",
      start: "2026-05-10T10:00:00-03:00",
      end: "2026-05-10T10:45:00-03:00",
      notes: null,
      url: "https://example.com/calendar",
    }).event;
    assert.equal(updatedEvent.title, "Ship MCP Calendar");
    assert.equal(updatedEvent.notes, null);
    assert.match(updatedEvent.startsAt, /^2026-05-10T13:00:00/);

    const search = call(server, "workspace.search", {
      query: "Ship MCP Calendar",
      types: ["event"],
    });
    assert.equal(search.results[0].id, event.eventIdentifier);

    const updatedCalendar = call(server, "calendar.update_calendar", {
      id: calendar.id,
      title: "AI Calendar",
      colorHex: "#112233",
    }).calendar;
    assert.equal(updatedCalendar.title, "AI Calendar");
    assert.equal(updatedCalendar.colorHex, "#112233");

    const deletedEvent = call(server, "calendar.delete_event", { id: event.eventIdentifier });
    assert.equal(deletedEvent.deleted, true);
    assert.equal(call(server, "calendar.list_events", {
      start: "2026-05-10T00:00:00-03:00",
      end: "2026-05-11T00:00:00-03:00",
    }).events.length, 0);

    const secondEvent = call(server, "calendar.create_event", {
      calendarId: calendar.id,
      title: "Cascade Delete",
      start: "2026-05-10T11:00:00-03:00",
      end: "2026-05-10T11:30:00-03:00",
    }).event;
    assert.equal(secondEvent.calendarId, calendar.id);

    const deletedCalendar = call(server, "calendar.delete_calendar", { id: calendar.id });
    assert.equal(deletedCalendar.deleted, true);
    assert.equal(deletedCalendar.archivedEventCount, 1);
    assert.equal(call(server, "calendar.list_calendars").calendars.length, 0);
    assert.equal(call(server, "workspace.get_context", { includeRecent: false }).counts.localEvents, 0);
  });
});

test("workspace MCP: gets and updates Site Admin home content", async () => {
  await withServer(async (server) => {
    const initial = call(server, "siteAdmin.get_home", { backend: "local" });
    assert.equal(initial.backend, "local");
    assert.equal(initial.data.title, "Hi there!");
    assert.equal(initial.sourceVersion.fileSha, "");

    const dryRun = call(server, "siteAdmin.update_home", {
      backend: "local",
      title: "Home",
      bodyMdx: "Draft home body.",
      dryRun: true,
    });
    assert.equal(dryRun.dryRun, true);

    const updated = call(server, "siteAdmin.update_home", {
      backend: "local",
      title: "Home",
      bodyMdx: "Updated home body.",
    });
    assert.equal(updated.data.title, "Home");
    assert.equal(updated.data.bodyMdx, "Updated home body.");
    assert.ok(updated.sourceVersion.fileSha);

    const source = JSON.parse(
      await fs.readFile(path.join(process.env.WORKSPACE_MCP_CONTENT_ROOT, "home.json"), "utf8"),
    );
    assert.equal(source.bodyMdx, "Updated home body.");

    const suggestion = JSON.parse(
      await fs.readFile(process.env.WORKSPACE_MCP_CONTENT_SUGGESTION_PATH, "utf8"),
    );
    assert.equal(suggestion.source, "mcp");
    assert.equal(suggestion.path, "/api/site-admin/home");
  });
});

test("workspace MCP: manages Site Admin Now content locally", async () => {
  await withServer(async (server) => {
    const initial = call(server, "siteAdmin.get_now", { backend: "local" });
    assert.equal(initial.backend, "local");
    assert.equal(initial.sourceVersion.fileSha, "");

    const dryRun = call(server, "siteAdmin.update_now", {
      backend: "local",
      text: "Testing MCP Now",
      context: "Parity pass",
      date: "2026-05-19",
      dryRun: true,
    });
    assert.equal(dryRun.dryRun, true);

    const updated = call(server, "siteAdmin.update_now", {
      backend: "local",
      text: "Testing MCP Now",
      context: "Parity pass",
      date: "2026-05-19",
    });
    assert.equal(updated.data.current.text, "Testing MCP Now");
    assert.equal(updated.data.current.context, "Parity pass");
    assert.equal(updated.data.updates.length, 1);

    const historyId = updated.data.updates[0].id;
    const edited = call(server, "siteAdmin.update_now_history", {
      backend: "local",
      id: historyId,
      text: "Testing MCP Now history",
      date: "2026-05-18",
    });
    assert.equal(edited.data.updates[0].text, "Testing MCP Now history");

    const deleted = call(server, "siteAdmin.delete_now_history", {
      backend: "local",
      id: historyId,
    });
    assert.equal(deleted.data.updates.length, 0);
    assert.equal(deleted.data.current.text, "Testing MCP Now");

    const source = JSON.parse(
      await fs.readFile(path.join(process.env.WORKSPACE_MCP_CONTENT_ROOT, "now.json"), "utf8"),
    );
    assert.equal(source.current.text, "Testing MCP Now");

    const suggestion = JSON.parse(
      await fs.readFile(process.env.WORKSPACE_MCP_CONTENT_SUGGESTION_PATH, "utf8"),
    );
    assert.equal(suggestion.source, "mcp");
    assert.equal(suggestion.path, "/api/site-admin/now");
  });
});

test("workspace MCP: creates site-admin pages in local content", async () => {
  await withServer(async (server) => {
    const page = call(server, "siteAdmin.create_page", {
      slug: "yilin",
      title: "Yiling",
      description: "A hometown page.",
      bodyMdx: "Yichang, Yiling, and the Three Gorges Dam.",
      position: "start",
    }).page;
    assert.equal(page.slug, "yilin");
    assert.equal(page.href, "/yilin");

    const source = await fs.readFile(
      path.join(process.env.WORKSPACE_MCP_CONTENT_ROOT, "pages", "yilin.mdx"),
      "utf8",
    );
    assert.match(source, /title: "Yiling"/);
    assert.match(source, /Three Gorges Dam/);

    const tree = JSON.parse(
      await fs.readFile(path.join(process.env.WORKSPACE_MCP_CONTENT_ROOT, "page-tree.json"), "utf8"),
    );
    assert.deepEqual(tree.slugs, ["yilin"]);

    const suggestion = JSON.parse(
      await fs.readFile(process.env.WORKSPACE_MCP_CONTENT_SUGGESTION_PATH, "utf8"),
    );
    assert.equal(suggestion.source, "mcp");
    assert.equal(suggestion.path, "/api/site-admin/pages");
  });
});

test("workspace MCP: explicit Site Admin API target requires credentials", async () => {
  await withServer(async (server) => {
    const response = server.handle({
      jsonrpc: "2.0",
      id: 17,
      method: "tools/call",
      params: {
        name: "siteAdmin.list_pages",
        arguments: { backend: "api" },
      },
    });
    assert.match(response.error.message, /MISSING_SITE_ADMIN_CREDENTIALS/);
  });
});

test("workspace MCP: Site Admin v2 tools require API credentials and expose schemas", async () => {
  await withServer(async (server) => {
    const tools = server.handle({ jsonrpc: "2.0", id: 18, method: "tools/list" });
    const names = new Set(tools.result.tools.map((tool) => tool.name));
    for (const name of [
      "siteAdmin.list_posts",
      "siteAdmin.update_component",
      "siteAdmin.upload_asset",
      "siteAdmin.get_config",
      "siteAdmin.list_release_jobs",
      "siteAdmin.get_calendar_sync_health",
    ]) {
      assert.equal(names.has(name), true, `${name} should be registered`);
    }

    const response = server.handle({
      jsonrpc: "2.0",
      id: 19,
      method: "tools/call",
      params: {
        name: "siteAdmin.list_posts",
        arguments: {},
      },
    });
    assert.match(response.error.message, /MISSING_SITE_ADMIN_CREDENTIALS/);
  });
});

test("workspace MCP: Site Admin v2 API tools call the configured API", async () => {
  await withServer(async (server, dbPath) => {
    await withMockSiteAdminServer(async (baseUrl) => {
      const auth = { baseUrl, authToken: "token" };
      assert.equal(call(server, "siteAdmin.list_posts", auth).posts[0].slug, "hello");
      assert.equal(call(server, "siteAdmin.get_post", { ...auth, slug: "hello" }).post.version, "p1");
      assert.equal(call(server, "siteAdmin.create_post", { ...auth, slug: "new-post", source: "---\ntitle: New\n---" }).post.version, "p2");
      assert.equal(call(server, "siteAdmin.update_post", { ...auth, slug: "new-post", source: "updated", version: "p2" }).post.version, "p3");
      assert.equal(call(server, "siteAdmin.delete_post", { ...auth, slug: "new-post", version: "p3" }).deleted, true);
      assert.equal(call(server, "siteAdmin.move_post", { ...auth, fromSlug: "old", toSlug: "new", version: "p4" }).result.moved, true);

      assert.equal(call(server, "siteAdmin.list_components", auth).components[0].name, "Callout");
      assert.equal(call(server, "siteAdmin.get_component", { ...auth, name: "Callout" }).component.version, "c1");
      assert.equal(call(server, "siteAdmin.update_component", { ...auth, name: "Callout", source: "source", version: "c1" }).component.version, "c2");

      assert.equal(call(server, "siteAdmin.list_assets", auth).assets[0].key, "a.png");
      const sourcePath = path.join(path.dirname(dbPath), "asset.txt");
      await fs.writeFile(sourcePath, "asset");
      assert.equal(call(server, "siteAdmin.upload_asset", { ...auth, sourcePath, contentType: "text/plain" }).asset.key, "asset.txt");
      assert.equal(call(server, "siteAdmin.delete_asset", { ...auth, key: "asset.txt", version: "a2" }).deleted, true);

      assert.equal(call(server, "siteAdmin.get_config", auth).config.sourceVersion.siteConfigSha, "cfg1");
      assert.equal(call(server, "siteAdmin.update_settings", { ...auth, rowId: "settings", patch: { title: "Site" }, expectedSiteConfigSha: "cfg1" }).config.command, "settings");
      assert.equal(call(server, "siteAdmin.create_nav_item", { ...auth, label: "Now", href: "/now", group: "main", expectedSiteConfigSha: "cfg2" }).config.command, "nav-create");
      assert.equal(call(server, "siteAdmin.update_nav_item", { ...auth, rowId: "nav1", patch: { enabled: false }, expectedSiteConfigSha: "cfg3" }).config.command, "nav-update");

      assert.equal(call(server, "siteAdmin.get_routes", auth).routes.sourceVersion.protectedRoutesSha, "prot1");
      assert.equal(call(server, "siteAdmin.set_route_override", { ...auth, pageId: "page1", routePath: "/custom", expectedSiteConfigSha: "cfg4" }).routes.command, "override");
      assert.equal(call(server, "siteAdmin.set_protected_route", { ...auth, pageId: "page1", path: "/custom", auth: "password", password: "secret", expectedProtectedRoutesSha: "prot1" }).routes.command, "protected");

      assert.equal(call(server, "siteAdmin.list_release_jobs", auth).jobs[0].id, "job1");
      assert.equal(call(server, "siteAdmin.get_release_job", { ...auth, id: "job1" }).job.id, "job1");
      assert.equal(call(server, "siteAdmin.get_calendar_sync_health", auth).health.status, "ok");
      assert.equal(call(server, "siteAdmin.publish_calendar_observations_live", auth).rowsWritten, 2);
      assert.equal(call(server, "siteAdmin.get_public_calendar_live", { baseUrl }).calendar.events[0].id, "event1");

      const db = new DatabaseSync(dbPath);
      try {
        db.prepare(
          "INSERT INTO secure_values (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        ).run(`token::${baseUrl}`, "stored-token", Date.now());
      } finally {
        db.close();
      }
      assert.equal(call(server, "siteAdmin.list_posts", { baseUrl }).posts[0].slug, "hello");
    });
  });
});

test("workspace MCP: release writes require release capability and explicit confirmation", async () => {
  await withServer(async (server) => {
    await withMockSiteAdminServer(async (baseUrl, requests) => {
      const blocked = server.handle({
        jsonrpc: "2.0",
        id: 20,
        method: "tools/call",
        params: { name: "siteAdmin.smart_release", arguments: { baseUrl, authToken: "token" } },
      });
      assert.match(blocked.error.message, /allowReleaseWrite/);

      await fs.writeFile(
        process.env.WORKSPACE_MCP_SETTINGS_PATH,
        JSON.stringify({
          enabled: true,
          writeMode: "local-write",
          requireConfirmationForWrites: false,
          allowNotesWrite: true,
          allowTodosWrite: true,
          allowProjectsWrite: true,
          allowContactsWrite: true,
          allowSiteAdminWrite: true,
          allowReleaseWrite: true,
          allowCalendarWrite: false,
        }),
      );

      const pending = call(server, "siteAdmin.smart_release", {
        baseUrl,
        authToken: "token",
        request: { reason: "test" },
      });
      assert.equal(pending.confirmationRequired, true);
      assert.equal(await requests.count(), 0);

      decideWorkspaceMcpConfirmation(pending.confirmationId, "approve");
      const created = call(server, "siteAdmin.smart_release", {
        baseUrl,
        authToken: "token",
        request: { reason: "test" },
        confirmationId: pending.confirmationId,
      });
      assert.equal(created.job.id, "job-smart");
      assert.equal(await requests.count(), 1);
    });
  });
});

test("workspace MCP: lists, gets, updates, reorders, and deletes site-admin pages", async () => {
  await withServer(async (server) => {
    call(server, "siteAdmin.create_page", {
      slug: "home",
      title: "Home",
      bodyMdx: "Root page",
    });
    call(server, "siteAdmin.create_page", {
      slug: "child",
      parentSlug: "home",
      title: "Child",
      bodyMdx: "Child body",
    });

    const listed = call(server, "siteAdmin.list_pages");
    assert.deepEqual(listed.pages.map((page) => page.slug), ["home", "home/child"]);

    const child = call(server, "siteAdmin.get_page", { slug: "home/child" }).page;
    assert.equal(child.title, "Child");
    assert.match(child.source, /Child body/);

    const updated = call(server, "siteAdmin.update_page", {
      slug: "home/child",
      title: "Updated Child",
      bodyMdx: "Updated body",
      position: "start",
    }).page;
    assert.equal(updated.title, "Updated Child");
    assert.notEqual(updated.sourceSha, child.sourceSha);
    assert.match(
      await fs.readFile(
        path.join(process.env.WORKSPACE_MCP_CONTENT_ROOT, "pages", "home", "child.mdx"),
        "utf8",
      ),
      /Updated body/,
    );

    const deleteDryRun = call(server, "siteAdmin.delete_page", {
      slug: "home/child",
      dryRun: true,
    });
    assert.equal(deleteDryRun.dryRun, true);
    assert.match(deleteDryRun.wouldChange.diffPreview, /home\/child.mdx/);

    const blocked = server.handle({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "siteAdmin.delete_page", arguments: { slug: "home" } },
    });
    assert.match(blocked.error.message, /PAGE_HAS_CHILDREN/);

    const deleted = call(server, "siteAdmin.delete_page", {
      slug: "home",
      cascade: true,
    });
    assert.deepEqual(deleted.deleted, ["home", "home/child"]);
    assert.equal(call(server, "siteAdmin.list_pages").count, 0);
  });
});
