#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_APP_ID = "com.jinnkunn.workspace";
const SERVER_NAME = "jinnkunn-workspace-mcp";
const SERVER_VERSION = "0.1.0";
const PROTOCOL_VERSION = "2024-11-05";

function nowMs() {
  return Date.now();
}

function randId(prefix) {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function cleanText(value, max = 10_000) {
  return asString(value).trim().slice(0, max);
}

function nullableText(value, max = 2_000) {
  const text = cleanText(value, max);
  return text ? text : null;
}

function asInt(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function asBool(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function limitValue(value, fallback = 12, max = 50) {
  const number = asInt(value, fallback);
  return Math.max(1, Math.min(max, number || fallback));
}

function isoToMs(value, label) {
  const number = typeof value === "number" ? value : Date.parse(asString(value));
  if (!Number.isFinite(number)) {
    throw new Error(`${label} must be an ISO date/time string or unix milliseconds.`);
  }
  return Math.trunc(number);
}

function msToIso(value) {
  return value === null || value === undefined ? null : new Date(Number(value)).toISOString();
}

function defaultWorkspaceDbPath() {
  const explicit = process.env.WORKSPACE_DB_PATH || process.env.JINNKUNN_WORKSPACE_DB_PATH;
  if (explicit) return path.resolve(explicit);
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", DEFAULT_APP_ID, "workspace.db");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || home, DEFAULT_APP_ID, "workspace.db");
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(home, ".local", "share"), DEFAULT_APP_ID, "workspace.db");
}

export function resolveWorkspaceDbPath() {
  return defaultWorkspaceDbPath();
}

function openWorkspaceDb(dbPath = resolveWorkspaceDbPath()) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  ensureWorkspaceSchema(db);
  return db;
}

function ensureWorkspaceSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      parent_id TEXT REFERENCES notes(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      body_mdx TEXT NOT NULL DEFAULT '',
      icon TEXT,
      sort_order INTEGER NOT NULL,
      archived_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notes_parent_order ON notes (parent_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes (updated_at DESC);

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      color TEXT,
      icon TEXT,
      due_at INTEGER,
      pinned_at INTEGER,
      sort_order INTEGER NOT NULL,
      archived_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_projects_status_order
      ON projects (archived_at, status, pinned_at DESC, sort_order);

    CREATE TABLE IF NOT EXISTS project_links (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      label TEXT NOT NULL,
      url TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(project_id, target_type, target_id)
    );
    CREATE INDEX IF NOT EXISTS idx_project_links_project
      ON project_links (project_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      due_at INTEGER,
      scheduled_start_at INTEGER,
      scheduled_end_at INTEGER,
      estimated_minutes INTEGER,
      sort_order INTEGER NOT NULL,
      completed_at INTEGER,
      archived_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_todos_status_due_order
      ON todos (archived_at, completed_at, due_at, sort_order);

    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      given_name TEXT,
      family_name TEXT,
      company TEXT,
      role TEXT,
      birthday_month INTEGER,
      birthday_day INTEGER,
      birthday_year INTEGER,
      emails_json TEXT NOT NULL DEFAULT '[]',
      phones_json TEXT NOT NULL DEFAULT '[]',
      tags_json TEXT NOT NULL DEFAULT '[]',
      notes TEXT NOT NULL DEFAULT '',
      next_follow_up_at INTEGER,
      cadence_days INTEGER,
      pinned_at INTEGER,
      archived_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_contacts_updated_at
      ON contacts (archived_at, updated_at DESC);

    CREATE TABLE IF NOT EXISTS local_calendars (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      color_hex TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      archived_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_local_calendars_sort
      ON local_calendars (archived_at, sort_order);

    CREATE TABLE IF NOT EXISTS local_calendar_events (
      id TEXT PRIMARY KEY,
      calendar_id TEXT NOT NULL REFERENCES local_calendars(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      notes TEXT,
      location TEXT,
      url TEXT,
      starts_at_ms INTEGER NOT NULL,
      ends_at_ms INTEGER NOT NULL,
      is_all_day INTEGER NOT NULL DEFAULT 0,
      archived_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_local_calendar_events_window
      ON local_calendar_events (archived_at, starts_at_ms, ends_at_ms);
  `);
}

function rowToCamel(row) {
  const out = {};
  for (const [key, value] of Object.entries(row || {})) {
    out[key.replace(/_([a-z])/g, (_, char) => char.toUpperCase())] = value;
  }
  return out;
}

function rowsToCamel(rows) {
  return rows.map(rowToCamel);
}

function getCount(db, sql, params = []) {
  return Number(db.prepare(sql).get(...params)?.count || 0);
}

function existsById(db, table, id) {
  return Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND archived_at IS NULL`).get(id));
}

function maxSortOrder(db, table, where = "archived_at IS NULL", params = []) {
  return Number(db.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS value FROM ${table} WHERE ${where}`).get(...params)?.value ?? -1);
}

function likePattern(query) {
  return `%${String(query || "").replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function auditPath() {
  const explicit = process.env.WORKSPACE_MCP_AUDIT_PATH;
  if (explicit) return path.resolve(explicit);
  return path.join(ROOT, ".cache", "workspace-mcp", "audit.jsonl");
}

function writeAudit(entry) {
  const file = auditPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`, "utf8");
}

function assertWritesAllowed() {
  if (process.env.WORKSPACE_MCP_READONLY === "1") {
    throw new Error("Workspace MCP is running in read-only mode.");
  }
}

function dryRunResult(tool, preview) {
  return { dryRun: true, tool, wouldChange: preview };
}

function noteRow(db, id) {
  const row = db.prepare(`
    SELECT id, parent_id, title, body_mdx, icon, sort_order, archived_at, created_at, updated_at
      FROM notes
     WHERE id = ? AND archived_at IS NULL
  `).get(id);
  return row ? rowToCamel(row) : null;
}

function todoRow(db, id) {
  const row = db.prepare(`
    SELECT id, title, notes, project_id, due_at, scheduled_start_at, scheduled_end_at,
           estimated_minutes, sort_order, completed_at, archived_at, created_at, updated_at
      FROM todos
     WHERE id = ? AND archived_at IS NULL
  `).get(id);
  return row ? rowToCamel(row) : null;
}

function projectSelectSql(where = "") {
  return `
    SELECT p.id, p.title, p.description, p.status, p.color, p.icon, p.due_at,
           p.pinned_at, p.sort_order, p.archived_at, p.created_at, p.updated_at,
           (SELECT COUNT(*) FROM todos t
             WHERE t.project_id = p.id AND t.archived_at IS NULL AND t.completed_at IS NULL) AS open_todo_count,
           (SELECT COUNT(*) FROM todos t
             WHERE t.project_id = p.id AND t.archived_at IS NULL) AS total_todo_count
      FROM projects p
      ${where}
  `;
}

function projectRow(db, id) {
  const row = db.prepare(projectSelectSql("WHERE p.id = ?")).get(id);
  return row ? rowToCamel(row) : null;
}

function localEventRow(row) {
  const camel = rowToCamel(row);
  return {
    ...camel,
    eventIdentifier: camel.id,
    startsAt: msToIso(camel.startsAtMs),
    endsAt: msToIso(camel.endsAtMs),
    isAllDay: Boolean(camel.isAllDay),
  };
}

function getWorkspaceContext(db, args = {}) {
  const limit = limitValue(args.recentLimit, 8, 25);
  const includeRecent = args.includeRecent !== false;
  const counts = {
    notes: getCount(db, "SELECT COUNT(*) AS count FROM notes WHERE archived_at IS NULL"),
    archivedNotes: getCount(db, "SELECT COUNT(*) AS count FROM notes WHERE archived_at IS NOT NULL"),
    openTodos: getCount(db, "SELECT COUNT(*) AS count FROM todos WHERE archived_at IS NULL AND completed_at IS NULL"),
    completedTodos: getCount(db, "SELECT COUNT(*) AS count FROM todos WHERE archived_at IS NULL AND completed_at IS NOT NULL"),
    activeProjects: getCount(db, "SELECT COUNT(*) AS count FROM projects WHERE archived_at IS NULL AND status = 'active'"),
    pausedProjects: getCount(db, "SELECT COUNT(*) AS count FROM projects WHERE archived_at IS NULL AND status = 'paused'"),
    completedProjects: getCount(db, "SELECT COUNT(*) AS count FROM projects WHERE archived_at IS NULL AND status = 'completed'"),
    contacts: getCount(db, "SELECT COUNT(*) AS count FROM contacts WHERE archived_at IS NULL"),
    localCalendars: getCount(db, "SELECT COUNT(*) AS count FROM local_calendars WHERE archived_at IS NULL"),
    localEvents: getCount(db, "SELECT COUNT(*) AS count FROM local_calendar_events WHERE archived_at IS NULL"),
  };
  const recent = includeRecent ? [
    ...db.prepare("SELECT 'note' AS type, id, title, updated_at FROM notes WHERE archived_at IS NULL ORDER BY updated_at DESC LIMIT ?").all(limit),
    ...db.prepare("SELECT 'todo' AS type, id, title, updated_at FROM todos WHERE archived_at IS NULL ORDER BY updated_at DESC LIMIT ?").all(limit),
    ...db.prepare("SELECT 'project' AS type, id, title, updated_at FROM projects WHERE archived_at IS NULL ORDER BY updated_at DESC LIMIT ?").all(limit),
    ...db.prepare("SELECT 'contact' AS type, id, display_name AS title, updated_at FROM contacts WHERE archived_at IS NULL ORDER BY updated_at DESC LIMIT ?").all(limit),
  ]
    .sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0))
    .slice(0, limit)
    .map(rowToCamel) : [];
  return {
    app: "Jinnkunn Workspace",
    dbPath: resolveWorkspaceDbPath(),
    counts,
    recent,
    writeMode: process.env.WORKSPACE_MCP_READONLY === "1" ? "read-only" : "local-write",
  };
}

function searchWorkspace(db, args = {}) {
  const query = cleanText(args.query, 200);
  if (!query) throw new Error("query is required.");
  const limit = limitValue(args.limit, 8, 40);
  const types = new Set(Array.isArray(args.types) && args.types.length ? args.types : ["note", "todo", "project", "contact", "event"]);
  const pattern = likePattern(query);
  const results = [];
  if (types.has("note")) {
    results.push(...db.prepare(`
      SELECT 'note' AS type, id, title, substr(body_mdx, 1, 280) AS excerpt, updated_at
        FROM notes
       WHERE archived_at IS NULL AND (title LIKE ? ESCAPE '\\' OR body_mdx LIKE ? ESCAPE '\\')
       ORDER BY updated_at DESC LIMIT ?
    `).all(pattern, pattern, limit).map(rowToCamel));
  }
  if (types.has("todo")) {
    results.push(...db.prepare(`
      SELECT 'todo' AS type, id, title, substr(notes, 1, 280) AS excerpt, updated_at
        FROM todos
       WHERE archived_at IS NULL AND (title LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\')
       ORDER BY completed_at IS NOT NULL, updated_at DESC LIMIT ?
    `).all(pattern, pattern, limit).map(rowToCamel));
  }
  if (types.has("project")) {
    results.push(...db.prepare(`
      SELECT 'project' AS type, id, title, substr(description, 1, 280) AS excerpt, updated_at
        FROM projects
       WHERE archived_at IS NULL AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')
       ORDER BY updated_at DESC LIMIT ?
    `).all(pattern, pattern, limit).map(rowToCamel));
  }
  if (types.has("contact")) {
    results.push(...db.prepare(`
      SELECT 'contact' AS type, id, display_name AS title,
             trim(COALESCE(company, '') || ' ' || COALESCE(role, '') || ' ' || substr(notes, 1, 220)) AS excerpt,
             updated_at
        FROM contacts
       WHERE archived_at IS NULL
         AND (display_name LIKE ? ESCAPE '\\' OR company LIKE ? ESCAPE '\\' OR role LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\')
       ORDER BY updated_at DESC LIMIT ?
    `).all(pattern, pattern, pattern, pattern, limit).map(rowToCamel));
  }
  if (types.has("event")) {
    results.push(...db.prepare(`
      SELECT 'event' AS type, id, title,
             trim(COALESCE(location, '') || ' ' || COALESCE(notes, '')) AS excerpt,
             updated_at
        FROM local_calendar_events
       WHERE archived_at IS NULL
         AND (title LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\' OR location LIKE ? ESCAPE '\\')
       ORDER BY starts_at_ms DESC LIMIT ?
    `).all(pattern, pattern, pattern, limit).map(rowToCamel));
  }
  return {
    query,
    results: results
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      .slice(0, limit),
  };
}

function createNote(db, args = {}) {
  const title = cleanText(args.title || "Untitled", 220) || "Untitled";
  const parentId = nullableText(args.parentId, 96);
  if (parentId && !existsById(db, "notes", parentId)) {
    throw new Error("MISSING_PARENT: parentId did not match an active note.");
  }
  const bodyMdx = cleanText(args.bodyMdx || "", 100_000);
  const icon = nullableText(args.icon, 80);
  const now = nowMs();
  const id = randId("note");
  const sortOrder = maxSortOrder(
    db,
    "notes",
    parentId ? "archived_at IS NULL AND parent_id = ?" : "archived_at IS NULL AND parent_id IS NULL",
    parentId ? [parentId] : [],
  ) + 1;
  const preview = { id, parentId, title, bodyMdx, icon, sortOrder };
  if (args.dryRun) return dryRunResult("notes.create_page", preview);
  assertWritesAllowed();
  db.prepare(`
    INSERT INTO notes (id, parent_id, title, body_mdx, icon, sort_order, archived_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `).run(id, parentId, title, bodyMdx, icon, sortOrder, now, now);
  const note = noteRow(db, id);
  writeAudit({ tool: "notes.create_page", id, title });
  return { note };
}

function appendBlocks(db, args = {}) {
  const pageId = cleanText(args.pageId || args.id, 96);
  if (!pageId) throw new Error("pageId is required.");
  const note = noteRow(db, pageId);
  if (!note) throw new Error("note was not found.");
  const blockText = Array.isArray(args.blocks)
    ? args.blocks.map((block) => cleanText(block, 20_000)).filter(Boolean).join("\n\n")
    : cleanText(args.bodyMdx, 100_000);
  if (!blockText) throw new Error("blocks or bodyMdx is required.");
  const nextBody = [note.bodyMdx, blockText].filter((part) => String(part || "").trim()).join("\n\n");
  const preview = { pageId, previousLength: note.bodyMdx.length, appendedLength: blockText.length, nextLength: nextBody.length };
  if (args.dryRun) return dryRunResult("notes.append_blocks", preview);
  assertWritesAllowed();
  const updatedAt = nowMs();
  db.prepare("UPDATE notes SET body_mdx = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL")
    .run(nextBody, updatedAt, pageId);
  writeAudit({ tool: "notes.append_blocks", id: pageId, appendedLength: blockText.length });
  return { note: noteRow(db, pageId) };
}

function createTodo(db, args = {}) {
  const title = cleanText(args.title || "Untitled", 220) || "Untitled";
  const projectId = nullableText(args.projectId, 96);
  if (projectId && !existsById(db, "projects", projectId)) {
    throw new Error("MISSING_PROJECT: projectId did not match an active project.");
  }
  const notes = cleanText(args.notes, 10_000);
  const dueAt = asInt(args.dueAt, null);
  const scheduledStartAt = asInt(args.scheduledStartAt, null);
  const estimatedMinutes = asInt(args.estimatedMinutes, null);
  let scheduledEndAt = asInt(args.scheduledEndAt, null);
  if (scheduledStartAt && !scheduledEndAt && estimatedMinutes) {
    scheduledEndAt = scheduledStartAt + estimatedMinutes * 60_000;
  }
  const id = randId("todo");
  const now = nowMs();
  const sortOrder = maxSortOrder(db, "todos") + 1;
  const preview = { id, title, notes, projectId, dueAt, scheduledStartAt, scheduledEndAt, estimatedMinutes, sortOrder };
  if (args.dryRun) return dryRunResult("todos.create", preview);
  assertWritesAllowed();
  db.prepare(`
    INSERT INTO todos
      (id, title, notes, project_id, due_at, scheduled_start_at, scheduled_end_at, estimated_minutes,
       sort_order, completed_at, archived_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
  `).run(id, title, notes, projectId, dueAt, scheduledStartAt, scheduledEndAt, estimatedMinutes, sortOrder, now, now);
  writeAudit({ tool: "todos.create", id, title });
  return { todo: todoRow(db, id) };
}

function updateTodo(db, args = {}) {
  const id = cleanText(args.id, 96);
  const patch = asObject(args.patch);
  if (!id) throw new Error("id is required.");
  const existing = todoRow(db, id);
  if (!existing) throw new Error("todo was not found.");
  const next = {
    title: patch.title === undefined ? existing.title : cleanText(patch.title || "Untitled", 220),
    notes: patch.notes === undefined ? existing.notes : cleanText(patch.notes, 10_000),
    projectId: patch.projectId === undefined ? existing.projectId : nullableText(patch.projectId, 96),
    dueAt: patch.dueAt === undefined ? existing.dueAt : asInt(patch.dueAt, null),
    scheduledStartAt: patch.scheduledStartAt === undefined ? existing.scheduledStartAt : asInt(patch.scheduledStartAt, null),
    scheduledEndAt: patch.scheduledEndAt === undefined ? existing.scheduledEndAt : asInt(patch.scheduledEndAt, null),
    estimatedMinutes: patch.estimatedMinutes === undefined ? existing.estimatedMinutes : asInt(patch.estimatedMinutes, null),
    completedAt: patch.completed === true ? (existing.completedAt || nowMs()) : patch.completed === false ? null : existing.completedAt,
  };
  if (next.projectId && !existsById(db, "projects", next.projectId)) {
    throw new Error("MISSING_PROJECT: projectId did not match an active project.");
  }
  if (args.dryRun) return dryRunResult("todos.update", { id, patch, next });
  assertWritesAllowed();
  const updatedAt = nowMs();
  db.prepare(`
    UPDATE todos
       SET title = ?, notes = ?, project_id = ?, due_at = ?, scheduled_start_at = ?,
           scheduled_end_at = ?, estimated_minutes = ?, completed_at = ?, updated_at = ?
     WHERE id = ? AND archived_at IS NULL
  `).run(
    next.title,
    next.notes,
    next.projectId,
    next.dueAt,
    next.scheduledStartAt,
    next.scheduledEndAt,
    next.estimatedMinutes,
    next.completedAt,
    updatedAt,
    id,
  );
  writeAudit({ tool: "todos.update", id, patch });
  return { todo: todoRow(db, id) };
}

function completeTodo(db, args = {}) {
  return updateTodo(db, { id: args.id, patch: { completed: true }, dryRun: args.dryRun });
}

function createProject(db, args = {}) {
  const title = cleanText(args.title || "Untitled Project", 180) || "Untitled Project";
  const description = cleanText(args.description, 5_000);
  const status = ["active", "paused", "completed"].includes(args.status) ? args.status : "active";
  const color = nullableText(args.color, 40) || "#f97316";
  const icon = nullableText(args.icon, 80) || "i:project";
  const dueAt = asInt(args.dueAt, null);
  const id = randId("proj");
  const now = nowMs();
  const sortOrder = maxSortOrder(db, "projects") + 1;
  const preview = { id, title, description, status, color, icon, dueAt, sortOrder };
  if (args.dryRun) return dryRunResult("projects.create", preview);
  assertWritesAllowed();
  db.prepare(`
    INSERT INTO projects
      (id, title, description, status, color, icon, due_at, pinned_at, sort_order, archived_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)
  `).run(id, title, description, status, color, icon, dueAt, sortOrder, now, now);
  writeAudit({ tool: "projects.create", id, title });
  return { project: projectRow(db, id) };
}

function getProject(db, args = {}) {
  const id = cleanText(args.id, 96);
  if (!id) throw new Error("id is required.");
  const project = projectRow(db, id);
  if (!project) return { project: null, links: [] };
  const links = rowsToCamel(db.prepare(`
    SELECT id, project_id, target_type, target_id, label, url, created_at
      FROM project_links
     WHERE project_id = ?
     ORDER BY created_at DESC
  `).all(id));
  const todos = rowsToCamel(db.prepare(`
    SELECT id, title, notes, project_id, due_at, scheduled_start_at, scheduled_end_at,
           estimated_minutes, sort_order, completed_at, archived_at, created_at, updated_at
      FROM todos
     WHERE project_id = ? AND archived_at IS NULL
     ORDER BY completed_at IS NOT NULL, COALESCE(scheduled_start_at, due_at, 9223372036854775807), sort_order
  `).all(id));
  return { project, links, todos };
}

function addProjectLink(db, args = {}) {
  const projectId = cleanText(args.projectId, 96);
  const targetType = cleanText(args.targetType, 40);
  if (!projectId) throw new Error("projectId is required.");
  if (!["note", "contact", "calendarEvent", "url"].includes(targetType)) {
    throw new Error("targetType must be note, contact, calendarEvent, or url.");
  }
  if (!existsById(db, "projects", projectId)) {
    throw new Error("MISSING_PROJECT: projectId did not match an active project.");
  }
  const targetId = targetType === "url"
    ? cleanText(args.url || args.targetId, 2_000)
    : cleanText(args.targetId, 160);
  if (!targetId) throw new Error("targetId or url is required.");
  const label = cleanText(args.label || targetId, 220);
  const url = nullableText(args.url, 2_000);
  const id = randId("plink");
  const now = nowMs();
  const preview = { id, projectId, targetType, targetId, label, url };
  if (args.dryRun) return dryRunResult("projects.add_link", preview);
  assertWritesAllowed();
  db.prepare(`
    INSERT INTO project_links (id, project_id, target_type, target_id, label, url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, target_type, target_id)
    DO UPDATE SET label = excluded.label, url = excluded.url
  `).run(id, projectId, targetType, targetId, label, url, now);
  writeAudit({ tool: "projects.add_link", projectId, targetType, targetId });
  return { project: getProject(db, { id: projectId }) };
}

function contactRow(db, id) {
  const row = db.prepare(`
    SELECT id, display_name, given_name, family_name, company, role,
           birthday_month, birthday_day, birthday_year, emails_json, phones_json, tags_json,
           notes, next_follow_up_at, cadence_days, pinned_at, archived_at, created_at, updated_at
      FROM contacts
     WHERE id = ? AND archived_at IS NULL
  `).get(id);
  if (!row) return null;
  return {
    ...rowToCamel(row),
    emails: JSON.parse(row.emails_json || "[]"),
    phones: JSON.parse(row.phones_json || "[]"),
    tags: JSON.parse(row.tags_json || "[]"),
  };
}

function listCalendarEvents(db, args = {}) {
  const start = isoToMs(args.start, "start");
  const end = isoToMs(args.end, "end");
  if (end <= start) throw new Error("end must be after start.");
  const calendarIds = Array.isArray(args.calendarIds) ? args.calendarIds.map((id) => cleanText(id, 96)).filter(Boolean) : [];
  let sql = `
    SELECT id, calendar_id, title, notes, location, url, starts_at_ms, ends_at_ms,
           is_all_day, archived_at, created_at, updated_at
      FROM local_calendar_events
     WHERE archived_at IS NULL AND starts_at_ms < ? AND ends_at_ms > ?
  `;
  const params = [end, start];
  if (calendarIds.length) {
    sql += ` AND calendar_id IN (${calendarIds.map(() => "?").join(",")})`;
    params.push(...calendarIds);
  }
  sql += " ORDER BY starts_at_ms, created_at";
  return {
    events: db.prepare(sql).all(...params).map(localEventRow),
  };
}

function createCalendarEvent(db, args = {}) {
  const calendarId = cleanText(args.calendarId, 96);
  if (!calendarId) throw new Error("calendarId is required.");
  if (!existsById(db, "local_calendars", calendarId)) {
    throw new Error("MISSING_CALENDAR: calendarId did not match an active local calendar.");
  }
  const title = cleanText(args.title || "Untitled", 220) || "Untitled";
  const startsAtMs = isoToMs(args.start, "start");
  const endsAtMs = isoToMs(args.end, "end");
  if (endsAtMs <= startsAtMs) throw new Error("end must be after start.");
  const id = randId("levt");
  const now = nowMs();
  const preview = {
    id,
    calendarId,
    title,
    startsAt: msToIso(startsAtMs),
    endsAt: msToIso(endsAtMs),
    isAllDay: asBool(args.isAllDay, false),
    notes: nullableText(args.notes, 10_000),
    location: nullableText(args.location, 500),
    url: nullableText(args.url, 2_000),
  };
  if (args.dryRun) return dryRunResult("calendar.create_event", preview);
  assertWritesAllowed();
  db.prepare(`
    INSERT INTO local_calendar_events
      (id, calendar_id, title, notes, location, url, starts_at_ms, ends_at_ms,
       is_all_day, archived_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `).run(
    id,
    calendarId,
    title,
    preview.notes,
    preview.location,
    preview.url,
    startsAtMs,
    endsAtMs,
    preview.isAllDay ? 1 : 0,
    now,
    now,
  );
  writeAudit({ tool: "calendar.create_event", id, title, calendarId });
  return { event: localEventRow(db.prepare("SELECT * FROM local_calendar_events WHERE id = ?").get(id)) };
}

function siteAdminReleaseStatus() {
  const result = spawnSync("npm", ["run", "release:status", "--", "--skip-routes"], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status,
    ok: result.status === 0,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function textResult(value) {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

const toolSchemas = [
  {
    name: "workspace.get_context",
    description: "Read local workspace counts and recent items from workspace.db.",
    inputSchema: {
      type: "object",
      properties: {
        includeRecent: { type: "boolean" },
        recentLimit: { type: "number" },
      },
    },
  },
  {
    name: "workspace.search",
    description: "Search notes, todos, projects, contacts, and local calendar events.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" },
        types: { type: "array", items: { enum: ["note", "todo", "project", "contact", "event"] } },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "notes.get_page",
    description: "Read one local Notes page by id.",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
  },
  {
    name: "notes.create_page",
    description: "Create a local Notes page. Use dryRun first when asking for user confirmation.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string" },
        parentId: { type: "string" },
        bodyMdx: { type: "string" },
        icon: { type: "string" },
        dryRun: { type: "boolean" },
      },
    },
  },
  {
    name: "notes.append_blocks",
    description: "Append Markdown/MDX blocks to an existing Notes page.",
    inputSchema: {
      type: "object",
      required: ["pageId"],
      properties: {
        pageId: { type: "string" },
        bodyMdx: { type: "string" },
        blocks: { type: "array", items: { type: "string" } },
        dryRun: { type: "boolean" },
      },
    },
  },
  {
    name: "todos.create",
    description: "Create a local todo.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string" },
        notes: { type: "string" },
        projectId: { type: "string" },
        dueAt: { type: "number" },
        scheduledStartAt: { type: "number" },
        scheduledEndAt: { type: "number" },
        estimatedMinutes: { type: "number" },
        dryRun: { type: "boolean" },
      },
    },
  },
  {
    name: "todos.update",
    description: "Patch a local todo.",
    inputSchema: {
      type: "object",
      required: ["id", "patch"],
      properties: {
        id: { type: "string" },
        patch: { type: "object" },
        dryRun: { type: "boolean" },
      },
    },
  },
  {
    name: "todos.complete",
    description: "Mark a local todo complete.",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" }, dryRun: { type: "boolean" } } },
  },
  {
    name: "projects.get",
    description: "Read a project, its links, and its todos.",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
  },
  {
    name: "projects.create",
    description: "Create a local project.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        status: { enum: ["active", "paused", "completed"] },
        color: { type: "string" },
        icon: { type: "string" },
        dueAt: { type: "number" },
        dryRun: { type: "boolean" },
      },
    },
  },
  {
    name: "projects.add_link",
    description: "Link a note, contact, calendar event, or URL to a project.",
    inputSchema: {
      type: "object",
      required: ["projectId", "targetType"],
      properties: {
        projectId: { type: "string" },
        targetType: { enum: ["note", "contact", "calendarEvent", "url"] },
        targetId: { type: "string" },
        label: { type: "string" },
        url: { type: "string" },
        dryRun: { type: "boolean" },
      },
    },
  },
  {
    name: "contacts.get",
    description: "Read one local contact by id.",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
  },
  {
    name: "calendar.list_events",
    description: "List local Workspace calendar events. macOS EventKit calendars are intentionally not exposed in MCP v1.",
    inputSchema: {
      type: "object",
      required: ["start", "end"],
      properties: {
        start: { type: ["string", "number"] },
        end: { type: ["string", "number"] },
        calendarIds: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "calendar.create_event",
    description: "Create a local Workspace calendar event. Use dryRun first when asking for user confirmation.",
    inputSchema: {
      type: "object",
      required: ["calendarId", "title", "start", "end"],
      properties: {
        calendarId: { type: "string" },
        title: { type: "string" },
        start: { type: ["string", "number"] },
        end: { type: ["string", "number"] },
        isAllDay: { type: "boolean" },
        notes: { type: "string" },
        location: { type: "string" },
        url: { type: "string" },
        dryRun: { type: "boolean" },
      },
    },
  },
  {
    name: "siteAdmin.release_status",
    description: "Read release status. This tool never deploys or promotes production.",
    inputSchema: { type: "object", properties: {} },
  },
];

function callTool(db, name, args = {}) {
  switch (name) {
    case "workspace.get_context":
      return getWorkspaceContext(db, args);
    case "workspace.search":
      return searchWorkspace(db, args);
    case "notes.get_page":
      return { note: noteRow(db, cleanText(args.id, 96)) };
    case "notes.create_page":
      return createNote(db, args);
    case "notes.append_blocks":
      return appendBlocks(db, args);
    case "todos.create":
      return createTodo(db, args);
    case "todos.update":
      return updateTodo(db, args);
    case "todos.complete":
      return completeTodo(db, args);
    case "projects.get":
      return getProject(db, args);
    case "projects.create":
      return createProject(db, args);
    case "projects.add_link":
      return addProjectLink(db, args);
    case "contacts.get":
      return { contact: contactRow(db, cleanText(args.id, 96)) };
    case "calendar.list_events":
      return listCalendarEvents(db, args);
    case "calendar.create_event":
      return createCalendarEvent(db, args);
    case "siteAdmin.release_status":
      return siteAdminReleaseStatus();
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function resourcesList() {
  return [
    {
      uri: "workspace://schema",
      name: "Workspace MCP Schema",
      mimeType: "application/json",
      description: "Entities and tools exposed by the local Workspace MCP server.",
    },
    {
      uri: "workspace://context",
      name: "Workspace Context",
      mimeType: "application/json",
      description: "Counts, recent items, db path, and current MCP write mode.",
    },
    {
      uri: "workspace://recent",
      name: "Recent Workspace Items",
      mimeType: "application/json",
      description: "Most recently updated local notes, todos, projects, and contacts.",
    },
  ];
}

function readResource(db, uri) {
  if (uri === "workspace://schema") {
    return { server: SERVER_NAME, version: SERVER_VERSION, tools: toolSchemas };
  }
  if (uri === "workspace://context") {
    return getWorkspaceContext(db, { includeRecent: true, recentLimit: 12 });
  }
  if (uri === "workspace://recent") {
    return { recent: getWorkspaceContext(db, { includeRecent: true, recentLimit: 20 }).recent };
  }
  throw new Error(`Unknown resource: ${uri}`);
}

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id, code, message, data) {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } };
}

function handleRequest(db, message) {
  const method = message.method;
  const params = asObject(message.params);
  if (method === "initialize") {
    return jsonRpcResult(message.id, {
      protocolVersion: PROTOCOL_VERSION,
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      capabilities: { tools: {}, resources: {} },
    });
  }
  if (method === "ping") return jsonRpcResult(message.id, {});
  if (method === "tools/list") return jsonRpcResult(message.id, { tools: toolSchemas });
  if (method === "tools/call") {
    const name = asString(params.name);
    const args = asObject(params.arguments);
    return jsonRpcResult(message.id, textResult(callTool(db, name, args)));
  }
  if (method === "resources/list") return jsonRpcResult(message.id, { resources: resourcesList() });
  if (method === "resources/read") {
    const uri = asString(params.uri);
    const payload = readResource(db, uri);
    return jsonRpcResult(message.id, {
      contents: [{ uri, mimeType: "application/json", text: JSON.stringify(payload, null, 2) }],
    });
  }
  if (method?.startsWith("notifications/")) return null;
  return jsonRpcError(message.id, -32601, `Method not found: ${method}`);
}

function writeMessage(message) {
  if (!message) return;
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

export function createWorkspaceMcpServer({ dbPath = resolveWorkspaceDbPath() } = {}) {
  const db = openWorkspaceDb(dbPath);
  return {
    db,
    handle(message) {
      try {
        return handleRequest(db, message);
      } catch (error) {
        return jsonRpcError(message.id, -32000, error?.message || String(error));
      }
    },
    close() {
      db.close();
    },
  };
}

async function runStdioServer() {
  const server = createWorkspaceMcpServer();
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch (error) {
      writeMessage(jsonRpcError(null, -32700, `Parse error: ${error?.message || error}`));
      continue;
    }
    writeMessage(server.handle(message));
  }
  server.close();
}

function runSelfTest() {
  const dbPath = resolveWorkspaceDbPath();
  const server = createWorkspaceMcpServer({ dbPath });
  const result = server.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const context = server.handle({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "workspace.get_context", arguments: { includeRecent: false } },
  });
  server.close();
  console.log(JSON.stringify({ ok: true, dbPath, toolCount: result.result.tools.length, context: context.result }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
  } else {
    runStdioServer().catch((error) => {
      console.error(error?.stack || String(error));
      process.exit(1);
    });
  }
}
