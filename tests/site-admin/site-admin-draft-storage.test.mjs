import assert from "node:assert/strict";
import test from "node:test";
import { readLocalDraft, writeLocalDraft, clearLocalDraft, localDraftKey } from "../../app/site-admin/site-admin-draft-storage.ts";

function storage() {
  const values = new Map();
  return { values, getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}
test("local recovery preserves raw structured fields through reload", () => {
  const store = storage();
  const snapshot = { source: "serialized", collection: { name: "works", value: { items: [{ role: "Instructor ", periodRange: { end: "2026-02", start: "" } }] } }, savedAt: new Date().toISOString() };
  assert.equal(writeLocalDraft("components", "works", snapshot, store), true);
  assert.deepEqual(readLocalDraft("components", "works", store), { ...snapshot, key: localDraftKey("components", "works") });
  clearLocalDraft("components", "works", store);
  assert.equal(readLocalDraft("components", "works", store), null);
});
test("expired and malformed recovery copies cannot replace current content", () => {
  const store = storage();
  writeLocalDraft("pages", "bio", { source: "old", savedAt: "2000-01-01T00:00:00Z" }, store);
  assert.equal(readLocalDraft("pages", "bio", store), null);
  assert.equal(store.values.size, 0);
  store.setItem(localDraftKey("pages", "bio"), "not JSON");
  assert.equal(readLocalDraft("pages", "bio", store), null);
});
test("quota and privacy failures do not throw or masquerade as successful recovery", () => {
  const broken = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("quota"); }, removeItem() { throw new Error("denied"); } };
  assert.equal(writeLocalDraft("components", "news", { source: "local", savedAt: "now" }, broken), false);
  assert.equal(readLocalDraft("components", "news", broken), null);
  assert.doesNotThrow(() => clearLocalDraft("components", "news", broken));
});
