// The MCP default settings live in three places that must agree: the Node
// server (authoritative at call time), the Rust `WorkspaceMcpSettings::default`
// (what gets written to mcp-settings.json), and the Settings window (what the
// operator is told). When they drift, a fresh install shows "writes disabled"
// in the panel while the server accepts and executes those same writes.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_MCP_SETTINGS,
  createWorkspaceMcpServer,
} from "../../scripts/workspace/workspace-mcp-server.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RUST_PATH = "apps/workspace/src-tauri/src/mcp.rs";
const TSX_PATH = "apps/workspace/src/shell/SettingsWindow.tsx";

function read(relPath) {
  return fs.readFile(path.join(ROOT, relPath), "utf8");
}

function snakeToCamel(key) {
  return key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function literalValue(raw, resolvers) {
  const value = raw.trim().replace(/,$/, "").trim();
  if (value === "true") return true;
  if (value === "false") return false;
  const quoted = value.match(/^"(.*)"(?:\.to_string\(\))?$/);
  if (quoted) return quoted[1];
  if (Object.hasOwn(resolvers, value)) return resolvers[value];
  throw new Error(`unrecognized default literal: ${value}`);
}

function parseRustDefaults(source) {
  const block = source.match(
    /impl Default for WorkspaceMcpSettings \{[\s\S]*?fn default\(\) -> Self \{\s*Self \{([\s\S]*?)\n {8}\}/,
  );
  assert.ok(block, "could not locate WorkspaceMcpSettings::default in mcp.rs");
  const baseUrlFn = source.match(
    /fn default_site_admin_base_url\(\) -> String \{\s*"([^"]+)"\.to_string\(\)/,
  );
  assert.ok(baseUrlFn, "could not locate default_site_admin_base_url in mcp.rs");
  const resolvers = {
    "WorkspaceMcpWriteMode::LocalWrite": "local-write",
    "WorkspaceMcpWriteMode::ReadOnly": "read-only",
    "WorkspaceMcpSiteAdminWriteTarget::Api": "api",
    "WorkspaceMcpSiteAdminWriteTarget::Local": "local",
    "default_site_admin_base_url()": baseUrlFn[1],
  };
  const settings = {};
  for (const line of block[1].split("\n")) {
    const field = line.match(/^\s*([a-z_]+):\s*(.+?),\s*$/);
    if (!field) continue;
    settings[snakeToCamel(field[1])] = literalValue(field[2], resolvers);
  }
  return settings;
}

function parseTsxDefaults(source) {
  const block = source.match(
    /const DEFAULT_MCP_SETTINGS: WorkspaceMcpSettings = \{([\s\S]*?)\n\};/,
  );
  assert.ok(block, "could not locate DEFAULT_MCP_SETTINGS in SettingsWindow.tsx");
  const settings = {};
  for (const line of block[1].split("\n")) {
    const field = line.match(/^\s*([A-Za-z]+):\s*(.+?),\s*$/);
    if (!field) continue;
    settings[field[1]] = literalValue(field[2], {});
  }
  return settings;
}

test("workspace MCP defaults agree across server, Rust, and Settings window", async () => {
  const rust = parseRustDefaults(await read(RUST_PATH));
  const tsx = parseTsxDefaults(await read(TSX_PATH));
  const server = { ...DEFAULT_MCP_SETTINGS };

  // Guard the parsers themselves — a silently empty match would make the
  // deepEqual below pass for the wrong reason.
  assert.ok(Object.keys(rust).length >= 12, `rust defaults parsed thin: ${JSON.stringify(rust)}`);
  assert.deepEqual(Object.keys(server).sort(), Object.keys(rust).sort());
  assert.deepEqual(Object.keys(server).sort(), Object.keys(tsx).sort());

  assert.deepEqual(rust, server, "Rust default disagrees with the MCP server default");
  assert.deepEqual(tsx, server, "Settings window default disagrees with the MCP server default");
});

test("workspace MCP write capabilities are opt-in by default", () => {
  // These four gate mutations against local workspace data. Defaulting them
  // on means the server would accept a write the UI says is disabled.
  for (const key of [
    "allowNotesWrite",
    "allowTodosWrite",
    "allowProjectsWrite",
    "allowContactsWrite",
    "allowReleaseWrite",
    "allowCalendarWrite",
  ]) {
    assert.equal(DEFAULT_MCP_SETTINGS[key], false, `${key} must default to false`);
  }
});

// The constant above is only what a *missing* settings file falls back to.
// The defect this guards is a settings file that predates a capability: the
// normalizer, not the constant, decides what an absent key means, so exercise
// it through a real tool call.
test("workspace MCP: a settings file that omits a capability does not grant it", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-mcp-legacy-settings-"));
  const settingsPath = path.join(dir, "mcp-settings.json");
  const saved = {
    settings: process.env.WORKSPACE_MCP_SETTINGS_PATH,
    audit: process.env.WORKSPACE_MCP_AUDIT_PATH,
    confirmations: process.env.WORKSPACE_MCP_CONFIRMATIONS_PATH,
    secretBackend: process.env.WORKSPACE_SECRET_BACKEND,
  };
  process.env.WORKSPACE_SECRET_BACKEND = "local-db";
  process.env.WORKSPACE_MCP_SETTINGS_PATH = settingsPath;
  process.env.WORKSPACE_MCP_AUDIT_PATH = path.join(dir, "mcp-audit.jsonl");
  process.env.WORKSPACE_MCP_CONFIRMATIONS_PATH = path.join(dir, "mcp-confirmations.json");
  // Written by a build that shipped before allowNotesWrite existed.
  await fs.writeFile(
    settingsPath,
    JSON.stringify({
      enabled: true,
      writeMode: "local-write",
      requireConfirmationForWrites: false,
    }),
  );

  const server = createWorkspaceMcpServer({ dbPath: path.join(dir, "workspace.db") });
  try {
    const response = server.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "notes.create_page", arguments: { title: "Should be refused" } },
    });
    assert.match(response.error?.message ?? "", /capability is disabled: allowNotesWrite/);
  } finally {
    server.close();
    for (const [key, value] of [
      ["WORKSPACE_MCP_SETTINGS_PATH", saved.settings],
      ["WORKSPACE_MCP_AUDIT_PATH", saved.audit],
      ["WORKSPACE_MCP_CONFIRMATIONS_PATH", saved.confirmations],
      ["WORKSPACE_SECRET_BACKEND", saved.secretBackend],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
});
