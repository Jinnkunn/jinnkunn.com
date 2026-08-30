import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { d1DatabaseIdForEnv } from "../../scripts/_lib/wrangler-d1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const NORMAL_ORDER = `
[[env.staging.d1_databases]]
binding = "SITE_ADMIN_DB"
database_name = "jinnkunn-content-staging"
database_id = "staging-id"

[[env.staging.d1_databases]]
# Live mirror — points at PRODUCTION.
binding = "SITE_ADMIN_DB_LIVE"
database_name = "jinnkunn-content"
database_id = "production-id"

[[env.production.d1_databases]]
binding = "SITE_ADMIN_DB"
database_id = "production-id"
`;

// The trap this helper exists to close: the production-pointing block listed
// FIRST for the staging env.
const REORDERED = `
[[env.staging.d1_databases]]
binding = "SITE_ADMIN_DB_LIVE"
database_name = "jinnkunn-content"
database_id = "production-id"

[[env.staging.d1_databases]]
binding = "SITE_ADMIN_DB"
database_name = "jinnkunn-content-staging"
database_id = "staging-id"
`;

test("wrangler d1: resolves staging SITE_ADMIN_DB in normal block order", () => {
  assert.equal(
    d1DatabaseIdForEnv({ env: "staging", wranglerToml: NORMAL_ORDER }),
    "staging-id",
  );
});

test("wrangler d1: block reorder cannot point staging at production", () => {
  assert.equal(
    d1DatabaseIdForEnv({ env: "staging", wranglerToml: REORDERED }),
    "staging-id",
  );
});

test("wrangler d1: explicit binding selects the live mirror", () => {
  assert.equal(
    d1DatabaseIdForEnv({
      env: "staging",
      binding: "SITE_ADMIN_DB_LIVE",
      wranglerToml: NORMAL_ORDER,
    }),
    "production-id",
  );
});

test("wrangler d1: missing env throws", () => {
  assert.throws(
    () => d1DatabaseIdForEnv({ env: "preview", wranglerToml: NORMAL_ORDER }),
    /Missing \[\[env\.preview\.d1_databases\]\]/,
  );
});

test("wrangler d1: missing binding throws instead of falling back by position", () => {
  assert.throws(
    () =>
      d1DatabaseIdForEnv({
        env: "production",
        binding: "SITE_ADMIN_DB_LIVE",
        wranglerToml: NORMAL_ORDER,
      }),
    /No env\.production d1_databases block has binding/,
  );
});

test("wrangler d1: real wrangler.toml keeps staging and production apart", () => {
  const staging = d1DatabaseIdForEnv({ root: ROOT, env: "staging" });
  const production = d1DatabaseIdForEnv({ root: ROOT, env: "production" });
  assert.notEqual(staging, production);
  // The staging live mirror must resolve to the production database id.
  assert.equal(
    d1DatabaseIdForEnv({ root: ROOT, env: "staging", binding: "SITE_ADMIN_DB_LIVE" }),
    production,
  );
});
