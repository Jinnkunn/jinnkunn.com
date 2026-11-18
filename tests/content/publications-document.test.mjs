import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readPublicationsDocument, writePublicationsDocument, legacyPublicationsSource, publicationLinks } from "../../packages/content-core/src/publications.ts";
import { parsePublicationsEntries } from "../../lib/components/parse.ts";

test("Publications migration is reversible without changing order, links, or anchors", () => {
  const old = readFileSync(new URL("../../content/components/publications.mdx", import.meta.url), "utf8");
  const stored = writePublicationsDocument(old);
  const json = JSON.parse(stored);
  assert.equal(json.version, 1);
  assert.equal(json.kind, "publications");
  assert.ok(json.entries.length >= 8);
  assert.deepEqual(parsePublicationsEntries(stored), parsePublicationsEntries(old));
  assert.deepEqual(parsePublicationsEntries(stored).map(publicationLinks), parsePublicationsEntries(old).map(publicationLinks));
  assert.equal(writePublicationsDocument(legacyPublicationsSource(readPublicationsDocument(stored))), stored);
  assert.doesNotMatch(stored, /<PublicationsEntry/);
});

test("Publications migration rejects a future schema, duplicate IDs and unrecognized legacy text", () => {
  assert.throws(() => writePublicationsDocument('{"version":2,"kind":"publications"}'), /Unsupported/);
  const entries = [{ entryId: "same", title: "One", year: "2026" }, { entryId: "same", title: "Two", year: "2026" }];
  assert.throws(() => writePublicationsDocument(JSON.stringify({ version: 1, kind: "publications", frontmatter: "---\ntitle: Papers\n---", entries })), /unique entry IDs/);
  assert.throws(() => writePublicationsDocument("---\ntitle: Papers\n---\n\nDo not discard this paragraph."), /custom source/);
});
