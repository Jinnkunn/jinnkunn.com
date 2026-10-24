import test from "node:test";
import assert from "node:assert/strict";
import { registerNextModuleHooks } from "../helpers/next-module-hooks.mjs";
import { importServerModule } from "../helpers/server-module-hooks.mjs";
import { publicationSnapshot, publicationSearchSnapshot } from "../../lib/shared/publication-snapshot.mjs";
registerNextModuleHooks();
const { loadPublishedSearch } = await importServerModule("lib/server/published-search.ts");

test("runtime search reads one published D1 row and never queries saved draft content", async () => {
  const baseline = publicationSnapshot({ "home.json": "published biography" });
  const search = publicationSearchSnapshot(baseline, [{ id: "home", title: "Home", routePath: "/", kind: "page", text: "published biography" }]);
  const queries = [];
  const db = { prepare(sql) { queries.push(sql); return { bind(path) {
    assert.equal(path, "/__admin/publication-baseline.json");
    return { async all() { return { results: [{ sha: baseline.sha, search: JSON.stringify(search) }] }; } };
  } }; } };
  const result = await loadPublishedSearch(db);
  assert.equal(result.snapshotSha, baseline.sha);
  assert.equal(result.index[0].text, "published biography");
  assert.equal(queries.length, 1);
  assert.doesNotMatch(queries[0], /content_files/);
});
test("database failures and incomplete legacy search snapshots do not reveal stale results", async () => {
  const sha = publicationSnapshot({}).sha;
  const db = { prepare() { return { bind() { return { async all() { return { results: [{ sha, search: null }] }; } }; } }; } };
  await assert.rejects(loadPublishedSearch(db), /Republish content/);
  const unavailable = { prepare() { throw new Error("Database unavailable"); } };
  await assert.rejects(loadPublishedSearch(unavailable), /Database unavailable/);
});
