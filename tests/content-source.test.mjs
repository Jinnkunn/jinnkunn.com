import test from "node:test";
import assert from "node:assert/strict";

import {
  hasConfiguredNotionSource,
  normalizeContentSourceKind,
  resolveContentSourceKind,
} from "../lib/shared/content-source.mjs";

test("content-source: normalizes supported content source kinds", () => {
  assert.equal(normalizeContentSourceKind(" filesystem "), "filesystem");
  assert.equal(normalizeContentSourceKind("NOTION"), "notion");
  assert.equal(normalizeContentSourceKind("raw"), "");
});

test("content-source: detects whether notion source is configured", () => {
  assert.equal(
    hasConfiguredNotionSource({
      NOTION_TOKEN: "secret_123",
      NOTION_SITE_ADMIN_PAGE_ID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }),
    true,
  );
  assert.equal(
    hasConfiguredNotionSource({
      NOTION_TOKEN: "secret_123",
      NOTION_SITE_ADMIN_PAGE_ID: "",
    }),
    false,
  );
});

test("content-source: explicit CONTENT_SOURCE wins over auto-detection", () => {
  const source = resolveContentSourceKind({
    env: {
      CONTENT_SOURCE: "filesystem",
      NOTION_TOKEN: "secret_123",
      NOTION_SITE_ADMIN_PAGE_ID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  });
  assert.equal(source, "filesystem");
});

test("content-source: falls back to notion when notion env is configured", () => {
  const source = resolveContentSourceKind({
    env: {
      NOTION_TOKEN: "secret_123",
      NOTION_SITE_ADMIN_PAGE_ID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  });
  assert.equal(source, "notion");
});

test("content-source: defaults to filesystem when nothing is configured", () => {
  const source = resolveContentSourceKind({ env: {} });
  assert.equal(source, "filesystem");
});
