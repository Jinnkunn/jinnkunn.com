import assert from "node:assert/strict";
import test from "node:test";

import {
  logError,
  logWarn,
  readErrorLogSummary,
  resetErrorLogForTests,
} from "../lib/server/error-log.ts";

// Silence the console emitter during tests so the test output stays
// readable — each logWarn/logError writes a line otherwise.
function withSilencedConsole(run) {
  return () => {
    const origWarn = console.warn;
    const origError = console.error;
    console.warn = () => {};
    console.error = () => {};
    try {
      run();
    } finally {
      console.warn = origWarn;
      console.error = origError;
    }
  };
}

test(
  "error-log: logWarn appends to the ring and counts separately from errors",
  withSilencedConsole(() => {
    resetErrorLogForTests();
    logWarn({ source: "x", message: "first" });
    logWarn({ source: "x", message: "second", detail: "extra" });
    const s = readErrorLogSummary();
    assert.equal(s.total, 2);
    assert.equal(s.warnCount, 2);
    assert.equal(s.errorCount, 0);
    assert.equal(s.recent.at(-1)?.message, "second");
    assert.equal(s.recent.at(-1)?.detail, "extra");
  }),
);

test(
  "error-log: logError counts as error severity",
  withSilencedConsole(() => {
    resetErrorLogForTests();
    logError({ source: "y", message: "boom", detail: new Error("stack") });
    const s = readErrorLogSummary();
    assert.equal(s.total, 1);
    assert.equal(s.errorCount, 1);
    assert.equal(s.warnCount, 0);
    assert.equal(s.recent[0]?.severity, "error");
    assert.equal(s.recent[0]?.detail, "stack");
  }),
);

test(
  "error-log: ring buffer is bounded at 64 entries",
  withSilencedConsole(() => {
    resetErrorLogForTests();
    for (let i = 0; i < 80; i++) {
      logWarn({ source: "bulk", message: `m${i}` });
    }
    const s = readErrorLogSummary(10);
    assert.equal(s.total, 64);
    // Newest at the tail.
    assert.equal(s.recent.at(-1)?.message, "m79");
    // Oldest surviving is m16 (80 - 64).
    assert.equal(s.oldestAt !== null, true);
  }),
);

test(
  "error-log: detail serialization handles Error, string, object, undefined",
  withSilencedConsole(() => {
    resetErrorLogForTests();
    logWarn({ source: "a", message: "from error", detail: new Error("err-msg") });
    logWarn({ source: "a", message: "from object", detail: { foo: "bar" } });
    logWarn({ source: "a", message: "from string", detail: "plain string" });
    logWarn({ source: "a", message: "no detail" });
    const s = readErrorLogSummary();
    assert.equal(s.recent[0].detail, "err-msg");
    assert.equal(s.recent[1].detail, '{"foo":"bar"}');
    assert.equal(s.recent[2].detail, "plain string");
    assert.equal(s.recent[3].detail, undefined);
  }),
);

test(
  "error-log: long detail strings are truncated with an ellipsis",
  withSilencedConsole(() => {
    resetErrorLogForTests();
    const big = "x".repeat(2000);
    logWarn({ source: "a", message: "huge", detail: big });
    const s = readErrorLogSummary();
    const detail = s.recent[0].detail ?? "";
    assert.ok(detail.length <= 501, `expected <=501 chars got ${detail.length}`);
    assert.ok(detail.endsWith("…"));
  }),
);
