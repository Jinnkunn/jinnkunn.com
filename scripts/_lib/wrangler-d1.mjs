/**
 * Binding-aware wrangler.toml D1 lookups for the release/content scripts.
 *
 * The scripts used to take the FIRST `[[env.<env>.d1_databases]]` block and
 * read its `database_id` without checking `binding`. `env.staging` declares
 * two blocks — SITE_ADMIN_DB (staging content) followed by SITE_ADMIN_DB_LIVE,
 * which points at the PRODUCTION database — so a harmless-looking reorder of
 * wrangler.toml would silently aim every staging content publish, overlay
 * upload, and DELETE at production. Resolving by binding name closes that trap
 * once, for every caller.
 */

import fs from "node:fs";
import path from "node:path";

export const SITE_ADMIN_DB_BINDING = "SITE_ADMIN_DB";

/**
 * Return the `database_id` of the `[[env.<env>.d1_databases]]` block whose
 * `binding` matches. Scans every block for the environment instead of trusting
 * block order. Throws when the environment has no D1 blocks at all, or none
 * with the requested binding.
 *
 * Pass `wranglerToml` (raw file contents) to bypass the filesystem in tests.
 */
export function d1DatabaseIdForEnv({
  root,
  env,
  binding = SITE_ADMIN_DB_BINDING,
  wranglerToml,
}) {
  const raw =
    typeof wranglerToml === "string"
      ? wranglerToml
      : fs.readFileSync(path.join(root, "wrangler.toml"), "utf8");
  const marker = `[[env.${env}.d1_databases]]`;
  let searchFrom = 0;
  let sawBlock = false;
  while (true) {
    const start = raw.indexOf(marker, searchFrom);
    if (start < 0) break;
    sawBlock = true;
    const rest = raw.slice(start + marker.length);
    const nextBlock = rest.search(/\n\[/);
    const block = nextBlock >= 0 ? rest.slice(0, nextBlock) : rest;
    const bindingMatch = /^\s*binding\s*=\s*"([^"]+)"/m.exec(block);
    if (bindingMatch?.[1] === binding) {
      const databaseMatch = /^\s*database_id\s*=\s*"([^"]+)"/m.exec(block);
      if (!databaseMatch) {
        throw new Error(
          `Missing database_id for env.${env} binding "${binding}" in wrangler.toml`,
        );
      }
      return databaseMatch[1];
    }
    searchFrom = start + marker.length;
  }
  if (!sawBlock) throw new Error(`Missing ${marker} in wrangler.toml`);
  throw new Error(
    `No env.${env} d1_databases block has binding = "${binding}" in wrangler.toml`,
  );
}
