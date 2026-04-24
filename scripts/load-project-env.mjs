#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function unquote(value) {
  const trimmed = String(value || "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const inner = trimmed.slice(1, -1);
    return inner
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t");
  }
  return trimmed;
}

function parseEnvFile(contents) {
  const out = new Map();
  const lines = String(contents || "").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, valueRaw] = match;
    out.set(key, unquote(valueRaw));
  }
  return out;
}

export function loadProjectEnv(options = {}) {
  const cwd = options.cwd ? path.resolve(String(options.cwd)) : process.cwd();
  const override = Boolean(options.override);
  const files = Array.isArray(options.files) && options.files.length > 0
    ? options.files
    : [".env", ".env.local"];

  let loaded = 0;
  for (const rel of files) {
    const abs = path.resolve(cwd, String(rel));
    let source = "";
    try {
      source = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const pairs = parseEnvFile(source);
    for (const [key, value] of pairs.entries()) {
      if (!override && Object.prototype.hasOwnProperty.call(process.env, key)) {
        continue;
      }
      process.env[key] = value;
      loaded += 1;
    }
  }

  return { loaded };
}

