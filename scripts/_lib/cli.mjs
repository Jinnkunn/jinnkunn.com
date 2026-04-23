/**
 * Shared CLI helpers for repo scripts.
 *
 * The several `site-admin-*.mjs` scripts each reimplement the same arg
 * parser + string/bool coercion helpers. Centralising them here means a
 * fix to, say, `=`-style arg handling propagates everywhere instead of
 * needing to be mirrored across four files.
 */

/**
 * Parse `--key value` and `--key=value` pairs out of `process.argv`.
 *
 * Bare flags (no following value or followed by another `--flag`) are
 * recorded as `"1"` to match the pre-existing convention.
 */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = String(argv[i] || "");
    if (!raw.startsWith("--")) continue;
    const eq = raw.indexOf("=");
    if (eq > 2) {
      out[raw.slice(2, eq)] = raw.slice(eq + 1);
      continue;
    }
    const key = raw.slice(2);
    const next = argv[i + 1];
    if (next === undefined || String(next).startsWith("--")) {
      out[key] = "1";
      continue;
    }
    out[key] = String(next);
    i += 1;
  }
  return out;
}

export function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

export function asBool(value, fallback = false) {
  const raw = asString(value).toLowerCase();
  if (!raw) return fallback;
  if (TRUE_VALUES.has(raw)) return true;
  if (FALSE_VALUES.has(raw)) return false;
  return fallback;
}
