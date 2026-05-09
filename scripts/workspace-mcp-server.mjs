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
  return defaultAppDataPath("workspace.db");
}

function defaultAppDataDir() {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", DEFAULT_APP_ID);
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || home, DEFAULT_APP_ID);
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(home, ".local", "share"), DEFAULT_APP_ID);
}

function defaultAppDataPath(filename) {
  return path.join(defaultAppDataDir(), filename);
}

export function resolveWorkspaceDbPath() {
  return defaultWorkspaceDbPath();
}

export function resolveWorkspaceMcpSettingsPath() {
  const explicit = process.env.WORKSPACE_MCP_SETTINGS_PATH;
  return explicit ? path.resolve(explicit) : defaultAppDataPath("mcp-settings.json");
}

export function resolveWorkspaceMcpAuditPath() {
  const explicit = process.env.WORKSPACE_MCP_AUDIT_PATH;
  return explicit ? path.resolve(explicit) : defaultAppDataPath("mcp-audit.jsonl");
}

export function resolveWorkspaceMcpConfirmationsPath() {
  const explicit = process.env.WORKSPACE_MCP_CONFIRMATIONS_PATH;
  return explicit ? path.resolve(explicit) : defaultAppDataPath("mcp-confirmations.json");
}

export function resolveWorkspaceMcpContentSuggestionPath() {
  const explicit = process.env.WORKSPACE_MCP_CONTENT_SUGGESTION_PATH;
  return explicit
    ? path.resolve(explicit)
    : defaultAppDataPath("site-admin-content-publish-suggestion.json");
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

const DEFAULT_MCP_SETTINGS = Object.freeze({
  enabled: true,
  writeMode: "local-write",
  requireConfirmationForWrites: true,
  allowNotesWrite: true,
  allowTodosWrite: true,
  allowProjectsWrite: true,
  allowSiteAdminWrite: true,
  allowCalendarWrite: false,
});

function normalizeMcpSettings(raw = {}) {
  const input = asObject(raw);
  const writeMode = input.writeMode === "read-only" ? "read-only" : "local-write";
  return {
    enabled: input.enabled !== false,
    writeMode,
    requireConfirmationForWrites: input.requireConfirmationForWrites !== false,
    allowNotesWrite: input.allowNotesWrite !== false,
    allowTodosWrite: input.allowTodosWrite !== false,
    allowProjectsWrite: input.allowProjectsWrite !== false,
    allowSiteAdminWrite: input.allowSiteAdminWrite !== false,
    allowCalendarWrite: input.allowCalendarWrite === true,
  };
}

function readMcpSettings() {
  const file = resolveWorkspaceMcpSettingsPath();
  try {
    if (!fs.existsSync(file)) return { ...DEFAULT_MCP_SETTINGS };
    return normalizeMcpSettings(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return { ...DEFAULT_MCP_SETTINGS, writeMode: "read-only" };
  }
}

function effectiveWriteMode(settings = readMcpSettings()) {
  return process.env.WORKSPACE_MCP_READONLY === "1" ? "read-only" : settings.writeMode;
}

function auditPath() {
  return resolveWorkspaceMcpAuditPath();
}

function writeAudit(entry) {
  const file = auditPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`, "utf8");
}

function assertServerEnabled(settings = readMcpSettings()) {
  if (!settings.enabled) {
    throw new Error("Workspace MCP is disabled in Workspace Settings.");
  }
}

function assertWritesAllowed(capability) {
  const settings = readMcpSettings();
  assertServerEnabled(settings);
  if (effectiveWriteMode(settings) === "read-only") {
    throw new Error("Workspace MCP is running in read-only mode.");
  }
  if (capability && settings[capability] === false) {
    throw new Error(`Workspace MCP capability is disabled: ${capability}.`);
  }
}

function dryRunResult(tool, preview) {
  return { dryRun: true, tool, wouldChange: preview };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha1Hex(input) {
  return crypto.createHash("sha1").update(String(input), "utf8").digest("hex");
}

function writeArgsForHash(args = {}) {
  const clean = { ...asObject(args) };
  delete clean.confirmationId;
  delete clean.dryRun;
  return clean;
}

function confirmationHash(tool, args = {}) {
  return crypto
    .createHash("sha256")
    .update(stableJson({ tool, args: writeArgsForHash(args) }))
    .digest("hex");
}

function readConfirmations() {
  const file = resolveWorkspaceMcpConfirmationsPath();
  try {
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry === "object") : [];
  } catch {
    return [];
  }
}

function writeConfirmations(entries) {
  const file = resolveWorkspaceMcpConfirmationsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(entries.slice(-120), null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

export function listWorkspaceMcpConfirmations(status = "pending") {
  const wanted = cleanText(status, 40) || "pending";
  return readConfirmations().filter((entry) => wanted === "all" || entry.status === wanted);
}

export function decideWorkspaceMcpConfirmation(id, decision) {
  const nextStatus = decision === "approve" || decision === "approved"
    ? "approved"
    : decision === "reject" || decision === "rejected"
      ? "rejected"
      : "";
  if (!nextStatus) throw new Error("decision must be approve or reject.");
  const confirmationId = cleanText(id, 96);
  if (!confirmationId) throw new Error("confirmation id is required.");
  const entries = readConfirmations();
  const index = entries.findIndex((entry) => entry.id === confirmationId);
  if (index < 0) throw new Error(`confirmation was not found: ${confirmationId}`);
  if (entries[index].status !== "pending") {
    throw new Error(`confirmation is already ${entries[index].status}.`);
  }
  entries[index] = {
    ...entries[index],
    status: nextStatus,
    decidedAt: new Date().toISOString(),
  };
  writeConfirmations(entries);
  return entries[index];
}

function summarizeConfirmation(tool, preview = {}) {
  const p = asObject(preview);
  switch (tool) {
    case "notes.create_page":
      return `Create note: ${p.title || "Untitled"}`;
    case "notes.append_blocks":
      return `Append ${p.appendedLength || 0} chars to note`;
    case "todos.create":
      return `Create todo: ${p.title || "Untitled"}`;
    case "todos.update":
      return `Update todo: ${p.id || "unknown"}`;
    case "todos.complete":
      return `Complete todo: ${p.id || "unknown"}`;
    case "projects.create":
      return `Create project: ${p.title || "Untitled Project"}`;
    case "projects.add_link":
      return `Link ${p.targetType || "item"} to project`;
    case "calendar.create_event":
      return `Create calendar event: ${p.title || "Untitled"}`;
    case "siteAdmin.update_page":
      return `Update site page: /${p.slug || "unknown"}`;
    case "siteAdmin.delete_page":
      return `Delete site page: /${p.slug || "unknown"}`;
    case "siteAdmin.create_page":
      return `Create site page: /${p.slug || "untitled"}`;
    default:
      return tool;
  }
}

function pendingConfirmationResult(tool, entry) {
  return {
    confirmationRequired: true,
    status: entry.status,
    tool,
    confirmationId: entry.id,
    summary: entry.summary,
    message: "Approve this request in Workspace Settings > AI Access, then retry the same tool call with confirmationId.",
    wouldChange: entry.preview,
  };
}

function createOrReusePendingConfirmation(tool, args, preview) {
  const hash = confirmationHash(tool, args);
  const entries = readConfirmations();
  const existing = entries
    .slice()
    .reverse()
    .find((entry) => entry.status === "pending" && entry.tool === tool && entry.argsHash === hash);
  if (existing) return pendingConfirmationResult(tool, existing);
  const entry = {
    id: randId("mcpconf"),
    status: "pending",
    tool,
    summary: summarizeConfirmation(tool, preview),
    args: writeArgsForHash(args),
    argsHash: hash,
    preview,
    requestedAt: new Date().toISOString(),
    decidedAt: null,
    consumedAt: null,
  };
  entries.push(entry);
  writeConfirmations(entries);
  return pendingConfirmationResult(tool, entry);
}

function consumeApprovedConfirmation(tool, args = {}) {
  const confirmationId = cleanText(args.confirmationId, 96);
  const entries = readConfirmations();
  const index = entries.findIndex((entry) => entry.id === confirmationId);
  if (index < 0) throw new Error("CONFIRMATION_REQUIRED: approve this write in Workspace Settings > AI Access first.");
  const entry = entries[index];
  if (entry.tool !== tool) throw new Error("CONFIRMATION_MISMATCH: confirmation was created for a different tool.");
  if (entry.argsHash !== confirmationHash(tool, args)) {
    throw new Error("CONFIRMATION_MISMATCH: tool arguments changed after approval.");
  }
  if (entry.status === "rejected") {
    throw new Error("CONFIRMATION_REJECTED: this write was rejected in Workspace Settings.");
  }
  if (entry.status !== "approved") {
    return pendingConfirmationResult(tool, entry);
  }
  return null;
}

function markConfirmationConsumed(confirmationId) {
  const id = cleanText(confirmationId, 96);
  if (!id) return;
  const entries = readConfirmations();
  const index = entries.findIndex((entry) => entry.id === id);
  if (index < 0 || entries[index].status !== "approved") return;
  entries[index] = {
    ...entries[index],
    status: "consumed",
    consumedAt: new Date().toISOString(),
  };
  writeConfirmations(entries);
}

function prepareWrite(tool, capability, args, preview) {
  if (args.dryRun) return dryRunResult(tool, preview);
  assertWritesAllowed(capability);
  const settings = readMcpSettings();
  if (!settings.requireConfirmationForWrites) return null;
  if (!args.confirmationId) return createOrReusePendingConfirmation(tool, args, preview);
  return consumeApprovedConfirmation(tool, args);
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
  const settings = readMcpSettings();
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
    mcp: {
      enabled: settings.enabled,
      settingsPath: resolveWorkspaceMcpSettingsPath(),
      auditPath: resolveWorkspaceMcpAuditPath(),
      confirmationsPath: resolveWorkspaceMcpConfirmationsPath(),
      pendingConfirmations: readConfirmations().filter((entry) => entry.status === "pending").length,
      requireConfirmationForWrites: settings.requireConfirmationForWrites,
      allowNotesWrite: settings.allowNotesWrite,
      allowTodosWrite: settings.allowTodosWrite,
      allowProjectsWrite: settings.allowProjectsWrite,
      allowSiteAdminWrite: settings.allowSiteAdminWrite,
      allowCalendarWrite: settings.allowCalendarWrite,
    },
    counts,
    recent,
    writeMode: effectiveWriteMode(settings),
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
  const confirmation = prepareWrite("notes.create_page", "allowNotesWrite", args, preview);
  if (confirmation) return confirmation;
  db.prepare(`
    INSERT INTO notes (id, parent_id, title, body_mdx, icon, sort_order, archived_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `).run(id, parentId, title, bodyMdx, icon, sortOrder, now, now);
  const note = noteRow(db, id);
  markConfirmationConsumed(args.confirmationId);
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
  const confirmation = prepareWrite("notes.append_blocks", "allowNotesWrite", args, preview);
  if (confirmation) return confirmation;
  const updatedAt = nowMs();
  db.prepare("UPDATE notes SET body_mdx = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL")
    .run(nextBody, updatedAt, pageId);
  markConfirmationConsumed(args.confirmationId);
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
  const confirmation = prepareWrite("todos.create", "allowTodosWrite", args, preview);
  if (confirmation) return confirmation;
  db.prepare(`
    INSERT INTO todos
      (id, title, notes, project_id, due_at, scheduled_start_at, scheduled_end_at, estimated_minutes,
       sort_order, completed_at, archived_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
  `).run(id, title, notes, projectId, dueAt, scheduledStartAt, scheduledEndAt, estimatedMinutes, sortOrder, now, now);
  markConfirmationConsumed(args.confirmationId);
  writeAudit({ tool: "todos.create", id, title });
  return { todo: todoRow(db, id) };
}

function updateTodo(db, args = {}, tool = "todos.update") {
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
  const confirmation = prepareWrite(tool, "allowTodosWrite", args, { id, patch, next });
  if (confirmation) return confirmation;
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
  markConfirmationConsumed(args.confirmationId);
  writeAudit({ tool, id, patch });
  return { todo: todoRow(db, id) };
}

function completeTodo(db, args = {}) {
  return updateTodo(db, {
    id: args.id,
    patch: { completed: true },
    dryRun: args.dryRun,
    confirmationId: args.confirmationId,
  }, "todos.complete");
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
  const confirmation = prepareWrite("projects.create", "allowProjectsWrite", args, preview);
  if (confirmation) return confirmation;
  db.prepare(`
    INSERT INTO projects
      (id, title, description, status, color, icon, due_at, pinned_at, sort_order, archived_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)
  `).run(id, title, description, status, color, icon, dueAt, sortOrder, now, now);
  markConfirmationConsumed(args.confirmationId);
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
  const confirmation = prepareWrite("projects.add_link", "allowProjectsWrite", args, preview);
  if (confirmation) return confirmation;
  db.prepare(`
    INSERT INTO project_links (id, project_id, target_type, target_id, label, url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, target_type, target_id)
    DO UPDATE SET label = excluded.label, url = excluded.url
  `).run(id, projectId, targetType, targetId, label, url, now);
  markConfirmationConsumed(args.confirmationId);
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
  const confirmation = prepareWrite("calendar.create_event", "allowCalendarWrite", args, preview);
  if (confirmation) return confirmation;
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
  markConfirmationConsumed(args.confirmationId);
  writeAudit({ tool: "calendar.create_event", id, title, calendarId });
  return { event: localEventRow(db.prepare("SELECT * FROM local_calendar_events WHERE id = ?").get(id)) };
}

const PAGE_SLUG_SEGMENT_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
const PAGE_TREE_FILENAME = "page-tree.json";

function resolveSiteContentRoot() {
  const explicit = process.env.WORKSPACE_MCP_CONTENT_ROOT;
  return explicit ? path.resolve(explicit) : path.join(ROOT, "content");
}

function normalizePageSlug(slug) {
  const cleaned = cleanText(slug, 260).replace(/^\/+|\/+$/g, "");
  const parts = cleaned.split("/");
  if (
    !cleaned ||
    cleaned.includes("//") ||
    parts.length > 4 ||
    !parts.every((part) => PAGE_SLUG_SEGMENT_RE.test(part))
  ) {
    throw new Error(
      "invalid page slug: use lowercase letters, digits, and dashes; max 4 slash-separated levels.",
    );
  }
  return cleaned;
}

function pageSlugParent(slug) {
  const idx = slug.lastIndexOf("/");
  return idx > 0 ? slug.slice(0, idx) : null;
}

function normalizeOptionalPageSlug(value) {
  const text = cleanText(value, 260);
  return text ? normalizePageSlug(text) : null;
}

function resolveCreatePageSlug(args = {}) {
  const slug = normalizePageSlug(args.slug);
  const parentSlug = normalizeOptionalPageSlug(args.parentSlug);
  if (parentSlug && !slug.includes("/")) return `${parentSlug}/${slug}`;
  return slug;
}

function mdxFrontmatterString(value) {
  return JSON.stringify(cleanText(value, 600));
}

function parsePageSource(source = "") {
  const text = asString(source);
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  const data = {};
  let body = text;
  if (match) {
    body = text.slice(match[0].length);
    for (const line of match[1].split("\n")) {
      const idx = line.indexOf(":");
      if (idx <= 0) continue;
      const key = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key) data[key] = value;
    }
  }
  return {
    body,
    title: cleanText(data.title, 200),
    description: cleanText(data.description, 300),
    updated: cleanText(data.updated, 40),
    draft: data.draft === "true",
  };
}

function composePageSource({ title, description, updated, draft, body }) {
  const frontmatter = [
    "---",
    `title: ${mdxFrontmatterString(title)}`,
    description ? `description: ${mdxFrontmatterString(description)}` : null,
    updated ? `updated: ${updated}` : null,
    `draft: ${draft ? "true" : "false"}`,
    "---",
  ].filter(Boolean).join("\n");
  return `${frontmatter}\n\n${body ? `${body}\n` : ""}`;
}

function createPageSource(args, slug, existingSource = "") {
  const explicitSource = asString(args.source);
  if (explicitSource.trim()) return explicitSource.endsWith("\n") ? explicitSource : `${explicitSource}\n`;
  const existing = parsePageSource(existingSource);
  const title = args.title === undefined
    ? existing.title || slug.split("/").pop() || "Untitled"
    : cleanText(args.title, 200) || "Untitled";
  const description = args.description === undefined
    ? existing.description
    : cleanText(args.description, 300);
  const updated = args.updated === undefined
    ? existing.updated
    : cleanText(args.updated, 40);
  const draft = args.draft === undefined ? existing.draft : asBool(args.draft, false);
  const body = args.bodyMdx === undefined ? existing.body.trimEnd() : cleanText(args.bodyMdx, 80_000);
  return composePageSource({ title, description, updated, draft, body });
}

function extractPageTitle(source, slug) {
  return parsePageSource(source).title || slug;
}

function ensurePageSourceValid(source) {
  const match = source.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match || !/^title:\s*.+$/m.test(match[1])) {
    throw new Error("site page source must include frontmatter with title.");
  }
}

function siteContentFilePath(contentRoot, relPath) {
  const full = path.resolve(contentRoot, ...relPath.split("/"));
  const root = path.resolve(contentRoot);
  if (full !== root && !full.startsWith(`${root}${path.sep}`)) {
    throw new Error(`content path escaped root: ${relPath}`);
  }
  return full;
}

function sitePageRelPath(slug) {
  return path.posix.join("pages", `${slug}.mdx`);
}

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeTextFileAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

function readPageTree(contentRoot) {
  const file = path.join(contentRoot, PAGE_TREE_FILENAME);
  const parsed = readJsonFile(file, { schemaVersion: 1, slugs: [] });
  const seen = new Set();
  const slugs = [];
  const raw = Array.isArray(parsed.slugs) ? parsed.slugs : [];
  for (const item of raw) {
    try {
      const slug = normalizePageSlug(item);
      if (!seen.has(slug)) {
        seen.add(slug);
        slugs.push(slug);
      }
    } catch {
      // Drop malformed legacy entries instead of breaking the entire MCP surface.
    }
  }
  return { schemaVersion: 1, slugs };
}

function writePageTree(contentRoot, slugs) {
  const seen = new Set();
  const normalized = [];
  for (const item of slugs) {
    const slug = normalizePageSlug(item);
    if (!seen.has(slug)) {
      seen.add(slug);
      normalized.push(slug);
    }
  }
  writeTextFileAtomic(
    path.join(contentRoot, PAGE_TREE_FILENAME),
    `${JSON.stringify({ schemaVersion: 1, slugs: normalized }, null, 2)}\n`,
  );
  return normalized;
}

function listSitePageSlugs(contentRoot) {
  const pagesRoot = path.join(contentRoot, "pages");
  const out = [];
  function walk(dir, prefix = "") {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, rel);
        continue;
      }
      if (!entry.isFile() || !/\.mdx?$/.test(entry.name)) continue;
      const slug = rel.replace(/\.mdx?$/, "");
      try {
        out.push(normalizePageSlug(slug));
      } catch {
        // Ignore files that the public route layer would reject anyway.
      }
    }
  }
  walk(pagesRoot);
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function readSitePage(contentRoot, slug) {
  const relPath = sitePageRelPath(slug);
  const filePath = siteContentFilePath(contentRoot, relPath);
  try {
    const source = fs.readFileSync(filePath, "utf8");
    const parsed = parsePageSource(source);
    return {
      slug,
      href: `/${slug}`,
      title: parsed.title || slug,
      description: parsed.description || "",
      updated: parsed.updated || "",
      draft: parsed.draft,
      relPath,
      filePath,
      source,
      sourceSha: sha1Hex(source),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function orderedSitePageSlugs(contentRoot) {
  const existing = listSitePageSlugs(contentRoot);
  const existingSet = new Set(existing);
  const tree = readPageTree(contentRoot).slugs.filter((slug) => existingSet.has(slug));
  const treeSet = new Set(tree);
  return [...tree, ...existing.filter((slug) => !treeSet.has(slug))];
}

function applyPageTreeInsert(slugs, slug, args = {}) {
  const next = slugs.filter((item) => item !== slug);
  const beforeSlug = normalizeOptionalPageSlug(args.beforeSlug);
  if (beforeSlug) {
    const idx = next.indexOf(beforeSlug);
    if (idx >= 0) {
      next.splice(idx, 0, slug);
      return next;
    }
  }
  const afterSlug = normalizeOptionalPageSlug(args.afterSlug);
  if (afterSlug) {
    const idx = next.indexOf(afterSlug);
    if (idx >= 0) {
      next.splice(idx + 1, 0, slug);
      return next;
    }
  }
  const parentSlug = normalizeOptionalPageSlug(args.parentSlug);
  const parent = parentSlug || pageSlugParent(slug);
  const siblingIndexes = next
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => pageSlugParent(item) === parent)
    .map(({ index }) => index);
  const position = args.position === "start" ? "start" : "end";
  if (siblingIndexes.length) {
    const index = position === "start"
      ? siblingIndexes[0]
      : siblingIndexes[siblingIndexes.length - 1] + 1;
    next.splice(index, 0, slug);
    return next;
  }
  if (parent) {
    const parentIndex = next.indexOf(parent);
    if (parentIndex >= 0) {
      next.splice(parentIndex + 1, 0, slug);
      return next;
    }
  }
  if (position === "start") next.unshift(slug);
  else next.push(slug);
  return next;
}

function textPreview(source, max = 1_600) {
  const text = asString(source).trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}\n...`;
}

function diffPreview(before, after) {
  if (before === after) return "No source changes.";
  const beforeLines = asString(before).split("\n");
  const afterLines = asString(after).split("\n");
  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix + prefix < beforeLines.length &&
    suffix + prefix < afterLines.length &&
    beforeLines[beforeLines.length - suffix - 1] === afterLines[afterLines.length - suffix - 1]
  ) {
    suffix += 1;
  }
  const removed = beforeLines.slice(prefix, beforeLines.length - suffix).slice(0, 12);
  const added = afterLines.slice(prefix, afterLines.length - suffix).slice(0, 12);
  return textPreview([
    `@@ line ${prefix + 1} @@`,
    ...removed.map((line) => `- ${line}`),
    ...added.map((line) => `+ ${line}`),
  ].join("\n"), 1_800);
}

function writeContentPublishSuggestion(method, p) {
  const file = resolveWorkspaceMcpContentSuggestionPath();
  const payload = {
    atMs: Date.now(),
    method,
    path: p,
    source: "mcp",
  };
  writeTextFileAtomic(file, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

function siteAdminPageList(args = {}) {
  const contentRoot = resolveSiteContentRoot();
  const orderedSlugs = orderedSitePageSlugs(contentRoot);
  const limit = limitValue(args.limit, 100, 500);
  const pages = orderedSlugs.slice(0, limit).map((slug, index) => {
    const detail = readSitePage(contentRoot, slug);
    return detail ? {
      slug: detail.slug,
      href: detail.href,
      title: detail.title,
      description: detail.description,
      draft: detail.draft,
      relPath: detail.relPath,
      sourceSha: detail.sourceSha,
      navIndex: index,
    } : null;
  }).filter(Boolean);
  return { count: pages.length, pages };
}

function siteAdminPageGet(args = {}) {
  const slug = normalizePageSlug(args.slug);
  const contentRoot = resolveSiteContentRoot();
  const page = readSitePage(contentRoot, slug);
  if (!page) return { page: null };
  const tree = readPageTree(contentRoot).slugs;
  return {
    page: {
      ...page,
      inNavigation: tree.includes(slug),
      navIndex: tree.indexOf(slug),
    },
  };
}

function createSiteAdminPage(args = {}) {
  const slug = resolveCreatePageSlug(args);
  const source = createPageSource(args, slug);
  ensurePageSourceValid(source);
  const contentRoot = resolveSiteContentRoot();
  const relPath = sitePageRelPath(slug);
  const fullPath = siteContentFilePath(contentRoot, relPath);
  const addToNavigation = args.addToNavigation !== false;
  const preview = {
    slug,
    href: `/${slug}`,
    title: extractPageTitle(source, slug),
    relPath,
    filePath: fullPath,
    addToNavigation,
    sourcePreview: textPreview(source),
  };
  const confirmation = prepareWrite("siteAdmin.create_page", "allowSiteAdminWrite", args, preview);
  if (confirmation) return confirmation;
  if (fs.existsSync(fullPath)) {
    throw new Error(`PAGE_EXISTS: content/${relPath} already exists.`);
  }
  writeTextFileAtomic(fullPath, source);
  let treeUpdated = false;
  if (addToNavigation) {
    const slugs = readPageTree(contentRoot).slugs;
    if (!slugs.includes(slug)) {
      writePageTree(contentRoot, applyPageTreeInsert(slugs, slug, args));
      treeUpdated = true;
    }
  }
  markConfirmationConsumed(args.confirmationId);
  const sha = sha1Hex(source);
  writeContentPublishSuggestion("POST", "/api/site-admin/pages");
  writeAudit({ tool: "siteAdmin.create_page", slug, title: preview.title, relPath });
  return { page: { ...preview, sourceSha: sha, treeUpdated } };
}

function updateSiteAdminPage(args = {}) {
  const slug = normalizePageSlug(args.slug);
  const contentRoot = resolveSiteContentRoot();
  const existing = readSitePage(contentRoot, slug);
  if (!existing) throw new Error(`PAGE_NOT_FOUND: content/${sitePageRelPath(slug)} was not found.`);
  const expectedSha = cleanText(args.expectedSha || args.sourceSha, 80);
  if (expectedSha && expectedSha !== existing.sourceSha) {
    throw new Error(`SOURCE_CONFLICT: expected ${expectedSha}, current ${existing.sourceSha}.`);
  }
  const source = createPageSource(args, slug, existing.source);
  ensurePageSourceValid(source);
  const addToNavigation = args.addToNavigation;
  const nextTree = (() => {
    if (addToNavigation === undefined && !args.beforeSlug && !args.afterSlug && !args.position) {
      return null;
    }
    const current = readPageTree(contentRoot).slugs.filter((item) => item !== slug);
    if (addToNavigation === false) return current;
    return applyPageTreeInsert(current, slug, args);
  })();
  const preview = {
    slug,
    href: `/${slug}`,
    title: extractPageTitle(source, slug),
    relPath: existing.relPath,
    filePath: existing.filePath,
    previousSha: existing.sourceSha,
    nextSha: sha1Hex(source),
    treeWillUpdate: Boolean(nextTree),
    diffPreview: diffPreview(existing.source, source),
  };
  const confirmation = prepareWrite("siteAdmin.update_page", "allowSiteAdminWrite", args, preview);
  if (confirmation) return confirmation;
  writeTextFileAtomic(existing.filePath, source);
  let treeUpdated = false;
  if (nextTree) {
    writePageTree(contentRoot, nextTree);
    treeUpdated = true;
  }
  markConfirmationConsumed(args.confirmationId);
  writeContentPublishSuggestion("PUT", `/api/site-admin/pages/${slug}`);
  writeAudit({ tool: "siteAdmin.update_page", slug, title: preview.title, relPath: existing.relPath });
  return { page: { ...readSitePage(contentRoot, slug), treeUpdated } };
}

function deleteSiteAdminPage(args = {}) {
  const slug = normalizePageSlug(args.slug);
  const contentRoot = resolveSiteContentRoot();
  const existingSlugs = listSitePageSlugs(contentRoot);
  const targets = existingSlugs.filter((item) => item === slug || item.startsWith(`${slug}/`));
  if (!targets.length) throw new Error(`PAGE_NOT_FOUND: content/${sitePageRelPath(slug)} was not found.`);
  if (targets.length > 1 && !asBool(args.cascade, false)) {
    throw new Error("PAGE_HAS_CHILDREN: pass cascade=true to delete child pages too.");
  }
  const details = targets.map((target) => readSitePage(contentRoot, target)).filter(Boolean);
  const expectedSha = cleanText(args.expectedSha || args.sourceSha, 80);
  if (expectedSha && details[0]?.sourceSha !== expectedSha) {
    throw new Error(`SOURCE_CONFLICT: expected ${expectedSha}, current ${details[0]?.sourceSha}.`);
  }
  const preview = {
    slug,
    deletedSlugs: targets,
    relPath: sitePageRelPath(slug),
    diffPreview: details.map((page) => `--- ${page.relPath}\n${textPreview(page.source, 800)}`).join("\n\n"),
  };
  const confirmation = prepareWrite("siteAdmin.delete_page", "allowSiteAdminWrite", args, preview);
  if (confirmation) return confirmation;
  for (const page of details) {
    fs.rmSync(page.filePath, { force: true });
  }
  const nextTree = readPageTree(contentRoot).slugs.filter((item) => !targets.includes(item));
  writePageTree(contentRoot, nextTree);
  markConfirmationConsumed(args.confirmationId);
  writeContentPublishSuggestion("DELETE", `/api/site-admin/pages/${slug}`);
  writeAudit({ tool: "siteAdmin.delete_page", slug, deletedCount: targets.length });
  return { deleted: targets };
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
        confirmationId: { type: "string" },
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
        confirmationId: { type: "string" },
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
        confirmationId: { type: "string" },
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
        confirmationId: { type: "string" },
      },
    },
  },
  {
    name: "todos.complete",
    description: "Mark a local todo complete.",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" }, dryRun: { type: "boolean" }, confirmationId: { type: "string" } } },
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
        confirmationId: { type: "string" },
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
        confirmationId: { type: "string" },
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
        confirmationId: { type: "string" },
      },
    },
  },
  {
    name: "siteAdmin.release_status",
    description: "Read release status. This tool never deploys or promotes production.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "siteAdmin.list_pages",
    description: "List local public website MDX pages in navigation order.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" },
      },
    },
  },
  {
    name: "siteAdmin.get_page",
    description: "Read one local public website MDX page by slug.",
    inputSchema: {
      type: "object",
      required: ["slug"],
      properties: {
        slug: { type: "string" },
      },
    },
  },
  {
    name: "siteAdmin.create_page",
    description: "Create a local public website MDX page under content/pages. This never deploys by itself.",
    inputSchema: {
      type: "object",
      required: ["slug"],
      properties: {
        slug: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        updated: { type: "string" },
        bodyMdx: { type: "string" },
        source: { type: "string" },
        draft: { type: "boolean" },
        addToNavigation: { type: "boolean" },
        parentSlug: { type: "string" },
        beforeSlug: { type: "string" },
        afterSlug: { type: "string" },
        position: { enum: ["start", "end"] },
        expectedSha: { type: "string" },
        dryRun: { type: "boolean" },
        confirmationId: { type: "string" },
      },
    },
  },
  {
    name: "siteAdmin.update_page",
    description: "Update an existing local public website MDX page and optionally reorder navigation.",
    inputSchema: {
      type: "object",
      required: ["slug"],
      properties: {
        slug: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        updated: { type: "string" },
        bodyMdx: { type: "string" },
        source: { type: "string" },
        draft: { type: "boolean" },
        addToNavigation: { type: "boolean" },
        parentSlug: { type: "string" },
        beforeSlug: { type: "string" },
        afterSlug: { type: "string" },
        position: { enum: ["start", "end"] },
        expectedSha: { type: "string" },
        sourceSha: { type: "string" },
        dryRun: { type: "boolean" },
        confirmationId: { type: "string" },
      },
    },
  },
  {
    name: "siteAdmin.delete_page",
    description: "Delete a local public website MDX page and remove it from navigation.",
    inputSchema: {
      type: "object",
      required: ["slug"],
      properties: {
        slug: { type: "string" },
        cascade: { type: "boolean" },
        expectedSha: { type: "string" },
        sourceSha: { type: "string" },
        dryRun: { type: "boolean" },
        confirmationId: { type: "string" },
      },
    },
  },
];

export function workspaceMcpToolCount() {
  return toolSchemas.length;
}

function callTool(db, name, args = {}) {
  assertServerEnabled();
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
    case "siteAdmin.list_pages":
      return siteAdminPageList(args);
    case "siteAdmin.get_page":
      return siteAdminPageGet(args);
    case "siteAdmin.create_page":
      return createSiteAdminPage(args);
    case "siteAdmin.update_page":
      return updateSiteAdminPage(args);
    case "siteAdmin.delete_page":
      return deleteSiteAdminPage(args);
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

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return "";
  return process.argv[index + 1] || "";
}

function runConfirmationsCli(status = "pending") {
  console.log(JSON.stringify({
    ok: true,
    confirmationsPath: resolveWorkspaceMcpConfirmationsPath(),
    confirmations: listWorkspaceMcpConfirmations(status),
  }, null, 2));
}

function runConfirmationDecisionCli(decision, id) {
  const confirmation = decideWorkspaceMcpConfirmation(id, decision);
  console.log(JSON.stringify({
    ok: true,
    confirmationsPath: resolveWorkspaceMcpConfirmationsPath(),
    confirmation,
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  if (process.argv.includes("--tool-count")) {
    console.log(String(workspaceMcpToolCount()));
  } else if (process.argv.includes("--confirmations")) {
    runConfirmationsCli(argValue("--status") || "pending");
  } else if (process.argv.includes("--approve")) {
    runConfirmationDecisionCli("approve", argValue("--approve"));
  } else if (process.argv.includes("--reject")) {
    runConfirmationDecisionCli("reject", argValue("--reject"));
  } else if (process.argv.includes("--self-test")) {
    runSelfTest();
  } else {
    runStdioServer().catch((error) => {
      console.error(error?.stack || String(error));
      process.exit(1);
    });
  }
}
