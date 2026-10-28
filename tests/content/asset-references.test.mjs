import assert from "node:assert/strict";
import test from "node:test";
import { findAssetReferences } from "../../lib/shared/asset-references.ts";
import { readAssetReferenceSnapshots } from "../../lib/server/asset-reference-snapshots.ts";

const asset = { key: "uploads/2026/10/abc.png", url: "https://cdn.jinkunchen.com/uploads/2026/10/abc.png" };
test("media references include MDX, Markdown, escaped JSON, and both environments/states", () => {
  const snapshots = [
    { environment: "staging", state: "draft", sources: { "pages/a.mdx": `![alt](${asset.url}?v=1#image)\n<img src="${asset.url}" />` } },
    { environment: "production", state: "published", sources: { "home.json": '{"cover":"https:\\/\\/cdn.jinkunchen.com\\/uploads\\/2026\\/10\\/abc.png"}' } },
    { environment: "production", state: "draft", sources: { "pages/b.mdx": "![reference][img]\n[img]: /uploads/2026/10/abc.png" } },
    { environment: "staging", state: "published", sources: { "pages/c.mdx": '<img src="/public/uploads/2026/10/abc.png" />' } },
  ];
  const refs = findAssetReferences([asset], snapshots)[asset.key];
  assert.equal(refs.length, 4);
  assert.deepEqual(refs[0], { path: "pages/a.mdx", environment: "staging", state: "draft" });
});

test("media references distinguish exact paths, decode URL encoding, and fail closed for invalid JSON", () => {
  const snapshot = { environment: "local", state: "draft", sources: { "pages/a.mdx": `${asset.url}.backup /uploads/2026/10/%61bc.png` } };
  assert.equal(findAssetReferences([asset], [snapshot])[asset.key].length, 1);
  snapshot.sources["pages/a.mdx"] = `${asset.url}.backup`;
  assert.equal(findAssetReferences([asset], [snapshot])[asset.key].length, 0);
  assert.throws(() => findAssetReferences([asset], [{ ...snapshot, sources: { "home.json": "broken" } }]));
});

const hex = (value) => Buffer.from(value).toString("hex");
const db = (results) => ({ prepare: () => ({ bind: () => ({ all: async () => ({ results }) }) }) });
test("media database scan requires the environment's own published baseline", async () => {
  await assert.rejects(readAssetReferenceSnapshots(db([]), "production"), /unavailable/);
  const rows = [
    { path: "pages/draft.mdx", body_hex: hex(asset.url), state: "draft" },
    { path: "/__admin/publication-baseline.json", body_hex: hex(JSON.stringify({ version: 1, sources: { "pages/live.mdx": asset.url } })), state: "published" },
  ];
  const snapshots = await readAssetReferenceSnapshots(db(rows), "production");
  assert.equal(findAssetReferences([asset], snapshots)[asset.key].length, 2);
  await assert.rejects(readAssetReferenceSnapshots(db([{ ...rows[1], body_hex: hex('{"version":1,"sources":{"bad":4}}') }]), "staging"), /invalid/);
});
