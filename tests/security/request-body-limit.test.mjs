import assert from "node:assert/strict";
import test from "node:test";

import { importServerModule } from "../helpers/server-module-hooks.mjs";

const { readTextWithLimit, checkBodySize } = await importServerModule(
  "lib/server/request-guards.ts",
);
const { parseSiteAdminJsonCommand } = await importServerModule(
  "lib/server/site-admin-request.ts",
);

function streamingRequest(chunks, headers = {}) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Request("https://example.com/api/site-admin/config", {
    method: "POST",
    body,
    headers,
    duplex: "half",
  });
}

/**
 * A body source that reports how much it was actually asked to produce.
 * The point of the limit is that an oversized body is *abandoned*, not
 * buffered and then measured — only this fixture can tell the two apart.
 */
function instrumentedRequest({ chunkBytes, chunks, empty = false }) {
  const state = { produced: 0, pulls: 0, cancelled: false };
  let remaining = chunks;
  const body = new ReadableStream({
    pull(controller) {
      state.pulls += 1;
      if (empty) {
        controller.enqueue(new Uint8Array(0));
        return;
      }
      if (remaining <= 0) {
        controller.close();
        return;
      }
      remaining -= 1;
      state.produced += chunkBytes;
      controller.enqueue(new Uint8Array(chunkBytes).fill(0x61));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  const req = new Request("https://example.com/x", { method: "POST", body, duplex: "half" });
  return { req, state };
}

const acceptAnything = (body) => ({ ok: true, value: body });

test("readTextWithLimit: honest small body passes through", async () => {
  const req = new Request("https://example.com/x", { method: "POST", body: "hello" });
  const out = await readTextWithLimit(req, 1024);
  assert.equal(out.ok, true);
  assert.equal(out.body, "hello");
});

test("readTextWithLimit: rejects an over-declared Content-Length before reading", async () => {
  const req = new Request("https://example.com/x", {
    method: "POST",
    body: "hello",
    headers: { "content-length": "999999" },
  });
  const out = await readTextWithLimit(req, 1024);
  assert.equal(out.ok, false);
  assert.equal(out.reason, "body-too-large");
});

test("readTextWithLimit: rejects a body that lies about Content-Length", async () => {
  const req = new Request("https://example.com/x", {
    method: "POST",
    body: "y".repeat(5000),
    headers: { "content-length": "5" },
  });
  assert.equal(req.headers.get("content-length"), "5", "fixture must keep the lying header");
  const out = await readTextWithLimit(req, 1024);
  assert.equal(out.ok, false);
  assert.equal(out.reason, "body-too-large");
});

test("readTextWithLimit: rejects an oversized body with no Content-Length at all", async () => {
  const req = streamingRequest(["z".repeat(600), "z".repeat(600)]);
  assert.equal(req.headers.get("content-length"), null, "fixture must omit content-length");
  const out = await readTextWithLimit(req, 1024);
  assert.equal(out.ok, false);
  assert.equal(out.reason, "body-too-large");
});

test("readTextWithLimit: decodes multi-byte characters split across chunks", async () => {
  const encoder = new TextEncoder();
  const bytes = encoder.encode("héllo→");
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, 2));
      controller.enqueue(bytes.slice(2));
      controller.close();
    },
  });
  const req = new Request("https://example.com/x", { method: "POST", body, duplex: "half" });
  const out = await readTextWithLimit(req, 1024);
  assert.equal(out.ok, true);
  assert.equal(out.body, "héllo→");
});

test("readTextWithLimit: abandons the stream instead of buffering it", async () => {
  // 8MB on offer, 1KB allowed. Buffering-then-measuring would pull all of
  // it; the guard must stop within a few chunks and cancel the source.
  const { req, state } = instrumentedRequest({ chunkBytes: 1024, chunks: 8192 });
  const out = await readTextWithLimit(req, 1024);
  assert.equal(out.ok, false);
  assert.equal(out.reason, "body-too-large");
  assert.equal(state.cancelled, true, "the body source must be cancelled");
  assert.ok(
    state.produced <= 16 * 1024,
    `pulled ${state.produced} bytes for a 1KB cap — the body was buffered, not abandoned`,
  );
});

test("readTextWithLimit: a stream that only yields empty chunks terminates", async () => {
  // Empty chunks never advance the byte counter, so without a no-progress
  // bound this read never returns.
  const { req, state } = instrumentedRequest({ chunkBytes: 0, chunks: 0, empty: true });
  const out = await readTextWithLimit(req, 1024);
  assert.equal(out.ok, false);
  assert.equal(out.reason, "body-too-large");
  assert.equal(state.cancelled, true);
});

test("checkBodySize: counts encoded bytes, not UTF-16 units", () => {
  // 4 characters, 12 bytes in UTF-8.
  assert.equal(checkBodySize("→→→→", 16).ok, true);
  assert.equal(checkBodySize("→→→→", 8).ok, false);
});

test("parseSiteAdminJsonCommand: 413s a lying Content-Length instead of parsing it", async () => {
  const payload = JSON.stringify({ kind: "settings", pad: "p".repeat(5000) });
  const req = new Request("https://example.com/api/site-admin/config", {
    method: "POST",
    body: payload,
    headers: { "content-length": "12" },
  });
  const parsed = await parseSiteAdminJsonCommand(req, acceptAnything, { maxBytes: 1024 });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.status, 413);
});

test("parseSiteAdminJsonCommand: 413s an oversized chunked body with no Content-Length", async () => {
  const parsed = await parseSiteAdminJsonCommand(
    streamingRequest(['{"kind":"settings","pad":"', "p".repeat(4000), '"}']),
    acceptAnything,
    { maxBytes: 1024 },
  );
  assert.equal(parsed.ok, false);
  assert.equal(parsed.status, 413);
});

test("parseSiteAdminJsonCommand: bodies within the cap still parse", async () => {
  const req = new Request("https://example.com/api/site-admin/config", {
    method: "POST",
    body: JSON.stringify({ kind: "settings", rowId: "abc" }),
  });
  const parsed = await parseSiteAdminJsonCommand(req, acceptAnything, { maxBytes: 1024 });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value, { kind: "settings", rowId: "abc" });
});

test("parseSiteAdminJsonCommand: non-JSON bodies stay a 400, not a 413", async () => {
  const req = new Request("https://example.com/api/site-admin/config", {
    method: "POST",
    body: "not json",
  });
  const parsed = await parseSiteAdminJsonCommand(req, acceptAnything, { maxBytes: 1024 });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.status, 400);
});
