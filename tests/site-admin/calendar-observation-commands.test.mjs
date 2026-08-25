import assert from "node:assert/strict";
import test from "node:test";

import { parseCalendarCollectorCleanupCommand } from "../../lib/site-admin/calendar-observation-commands.ts";

test("calendar collector cleanup: accepts a collector-wide command", () => {
  assert.deepEqual(parseCalendarCollectorCleanupCommand({ collectorId: "tauri-macos:abc-123" }), {
    ok: true,
    value: { collectorId: "tauri-macos:abc-123" },
  });
});

test("calendar collector cleanup: validates and normalizes an optional range", () => {
  assert.deepEqual(
    parseCalendarCollectorCleanupCommand({
      collectorId: "ios:phone",
      range: {
        startsAt: "2026-05-17T00:00:00-03:00",
        endsAt: "2026-05-18T00:00:00-03:00",
      },
    }),
    {
      ok: true,
      value: {
        collectorId: "ios:phone",
        range: {
          startsAt: "2026-05-17T03:00:00.000Z",
          endsAt: "2026-05-18T03:00:00.000Z",
        },
      },
    },
  );
});

test("calendar collector cleanup: accepts the canonical 129 and 160 character boundaries", () => {
  for (const length of [129, 160]) {
    const collectorId = `c${"a".repeat(length - 1)}`;
    assert.deepEqual(parseCalendarCollectorCleanupCommand({ collectorId }), {
      ok: true,
      value: { collectorId },
    });
  }
});

test("calendar collector cleanup: rejects collector ids beyond 160 characters", () => {
  const parsed = parseCalendarCollectorCleanupCommand({
    collectorId: `c${"a".repeat(160)}`,
  });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.status, 400);
});

for (const [label, body] of [
  ["missing collector", {}],
  ["unsafe collector characters", { collectorId: "mac a" }],
  ["non-object range", { collectorId: "mac-a", range: "all" }],
  [
    "invalid timestamp",
    {
      collectorId: "mac-a",
      range: { startsAt: "yesterday", endsAt: "2026-05-18T00:00:00Z" },
    },
  ],
  [
    "date-only range",
    {
      collectorId: "mac-a",
      range: { startsAt: "2026-05-17", endsAt: "2026-05-18" },
    },
  ],
  [
    "reversed range",
    {
      collectorId: "mac-a",
      range: {
        startsAt: "2026-05-18T00:00:00Z",
        endsAt: "2026-05-17T00:00:00Z",
      },
    },
  ],
  ["unsupported selector", { collectorId: "mac-a", sourceId: "icloud" }],
]) {
  test(`calendar collector cleanup: rejects ${label}`, () => {
    const parsed = parseCalendarCollectorCleanupCommand(body);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.status, 400);
  });
}
