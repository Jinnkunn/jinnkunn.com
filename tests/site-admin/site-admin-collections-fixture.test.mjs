import assert from "node:assert/strict";
import test from "node:test";
import { createCollectionsFixture } from "../../scripts/_lib/site-admin-collections-fixture.mjs";

async function request(fixture, path, method = "GET", body = null) {
  let result;
  await fixture.handle({
    request: () => ({ url: () => `https://example.test/api/site-admin/${path}`, method: () => method, postDataJSON: () => body }),
    fulfill: async (response) => { result = { status: response.status, data: JSON.parse(response.body) }; },
  });
  return result;
}
test("fixture rejects unconfigured mutations rather than forwarding them", async () => {
  const fixture = createCollectionsFixture();
  assert.equal((await request(fixture, "pages/real-page", "DELETE")).status, 503);
  assert.deepEqual(fixture.unexpected, ["DELETE /api/site-admin/pages/real-page"]);
});
test("fixture version checks, failures and publish snapshots model separate draft/live state", async () => {
  const fixture = createCollectionsFixture();
  const detail = (await request(fixture, "components/news")).data;
  const source = detail.source.replace("Initial news body.", "New body.");
  assert.equal((await request(fixture, "components/news", "PATCH", { source, version: "stale" })).status, 409);
  fixture.failures.set("news", 503);
  assert.equal((await request(fixture, "components/news", "PATCH", { source, version: detail.version })).status, 503);
  fixture.failures.delete("news");
  assert.equal((await request(fixture, "components/news", "PATCH", { source, version: detail.version })).status, 200);
  await request(fixture, "release-jobs", "POST", {});
  fixture.completeRelease("failed");
  assert.equal(fixture.published.get("news"), detail.source);
  await request(fixture, "release-jobs", "POST", {});
  fixture.changeRemotely("news", source.replace("New body.", "Later draft."));
  fixture.completeRelease();
  assert.equal(fixture.published.get("news"), source);
  assert.notEqual(fixture.published.get("news"), fixture.saved.get("news"));
  const summary = (await request(fixture, "mobile/summary")).data.summary;
  assert.equal(summary.source.pendingDeploy, true);
});
