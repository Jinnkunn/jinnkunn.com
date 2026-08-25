import assert from "node:assert/strict";
import test from "node:test";

import {
  contentListPlaceholder,
  contentSaveEffects,
  countLabel,
  createSelectionGate,
  editorialStatus,
  liveSyncStatus,
  releaseJobOutcome,
  settingsDraftDirty,
  visibilityLabel,
} from "../../app/site-admin/site-admin-console-model.ts";

test("selection gate: a stale token cannot claim the selection", () => {
  const gate = createSelectionGate();
  const first = gate.open();
  const second = gate.open();

  assert.equal(gate.isStale(first), true);
  assert.equal(gate.isStale(second), false);
  assert.equal(gate.current(), second);
});

/**
 * Reproduces the cross-document overwrite: the author saves document A, then
 * opens document B before A's PATCH+GET resolves. Without the token, A's
 * response is written into the editor that is now showing B.
 */
test("selection gate: a save that resolves after a document switch does not write into the new document", async () => {
  const remote = {
    a: { body: "post A body" },
    b: { body: "post B body" },
  };
  const gate = createSelectionGate();
  const editor = { id: "", body: "" };
  const applied = [];

  const openDocument = async (id, latency) => {
    const token = gate.open();
    const detail = await withLatency(remote[id], latency);
    if (gate.isStale(token)) return;
    editor.id = id;
    editor.body = detail.body;
    applied.push(`open:${id}`);
  };

  const saveDocument = async (id, latency) => {
    const token = gate.current();
    const detail = await withLatency(remote[id], latency);
    if (gate.isStale(token)) return;
    editor.id = id;
    editor.body = detail.body;
    applied.push(`save:${id}`);
  };

  await openDocument("a", 0);
  const slowSave = saveDocument("a", 30);
  const fastOpen = openDocument("b", 5);
  await Promise.all([slowSave, fastOpen]);

  assert.equal(editor.id, "b");
  assert.equal(editor.body, "post B body");
  assert.deepEqual(applied, ["open:a", "open:b"]);
});

test("quiet autosave saves the draft and never queues a publish", () => {
  const quiet = contentSaveEffects({ quiet: true });
  assert.equal(quiet.persist, true);
  assert.equal(quiet.publish, false);
  assert.equal(quiet.reconcileLists, false);
  assert.equal(quiet.announce, false);
});

test("an explicit save publishes, reconciles, and reports back", () => {
  for (const options of [{}, { quiet: false }, undefined]) {
    const effects = contentSaveEffects(options);
    assert.equal(effects.persist, true);
    assert.equal(effects.publish, true);
    assert.equal(effects.reconcileLists, true);
    assert.equal(effects.announce, true);
  }
});

test("release outcome: failed jobs stay failed instead of becoming live", () => {
  assert.deepEqual(
    releaseJobOutcome({ status: "failed", error: "Runner worktree is dirty." }),
    { state: "failed", message: "Runner worktree is dirty." },
  );
  assert.deepEqual(releaseJobOutcome({ status: "canceled", error: "" }), {
    state: "canceled",
    message: "Publish was canceled.",
  });
  assert.deepEqual(releaseJobOutcome({ status: "succeeded", error: "ignored" }), {
    state: "succeeded",
    message: "",
  });
  assert.deepEqual(releaseJobOutcome({ status: "running", error: "" }), {
    state: "active",
    message: "",
  });
});

test("live sync: unpublished autosaves are counted and named", () => {
  const one = liveSyncStatus({
    releaseActionKind: "noop",
    pendingSaves: 1,
    releaseRunning: false,
  });
  assert.equal(one.state, "pending");
  assert.equal(one.label, "Draft saved · 1 change not yet live");

  const many = liveSyncStatus({
    releaseActionKind: "noop",
    pendingSaves: 4,
    releaseRunning: false,
  });
  assert.equal(many.label, "Draft saved · 4 changes not yet live");
});

test("live sync: a running release outranks the pending count", () => {
  const status = liveSyncStatus({
    releaseActionKind: "watch-release",
    pendingSaves: 3,
    releaseRunning: true,
  });
  assert.equal(status.state, "publishing");
  assert.equal(status.pendingCount, 3);
});

test("live sync: nothing pending reports the release summary verbatim", () => {
  assert.equal(
    liveSyncStatus({ releaseActionKind: "noop", pendingSaves: 0, releaseRunning: false })
      .state,
    "live",
  );
  assert.equal(
    liveSyncStatus({
      releaseActionKind: "smart-release",
      pendingSaves: 0,
      releaseRunning: false,
    }).state,
    "pending",
  );
  assert.equal(
    liveSyncStatus({ releaseActionKind: "refresh", pendingSaves: 0, releaseRunning: false })
      .state,
    "unknown",
  );
});

test("editorial status presents one clear next state", () => {
  const live = liveSyncStatus({
    releaseActionKind: "noop",
    pendingSaves: 0,
    releaseRunning: false,
  });
  assert.deepEqual(
    editorialStatus({
      saving: false,
      blocked: false,
      dirty: false,
      runnerOffline: false,
      liveSync: live,
    }),
    { state: "live", label: "Live current", tone: "noop" },
  );

  const pending = liveSyncStatus({
    releaseActionKind: "noop",
    pendingSaves: 2,
    releaseRunning: false,
  });
  assert.equal(
    editorialStatus({
      saving: false,
      blocked: false,
      dirty: false,
      runnerOffline: false,
      liveSync: pending,
    }).label,
    "Ready to publish",
  );
});

test("editorial status gives local edits and validation priority over live state", () => {
  const live = liveSyncStatus({
    releaseActionKind: "noop",
    pendingSaves: 0,
    releaseRunning: false,
  });
  assert.equal(
    editorialStatus({
      saving: false,
      blocked: false,
      dirty: true,
      runnerOffline: false,
      liveSync: live,
    }).label,
    "Unsaved changes",
  );
  assert.equal(
    editorialStatus({
      saving: false,
      blocked: true,
      dirty: true,
      runnerOffline: false,
      liveSync: live,
    }).label,
    "Needs attention",
  );
});

test("content list: an unloaded list is loading, not empty", () => {
  assert.equal(
    contentListPlaceholder({ hasLoadedOnce: false, itemCount: 0, searching: false }),
    "loading",
  );
  assert.equal(
    contentListPlaceholder({ hasLoadedOnce: true, itemCount: 0, searching: false }),
    "empty",
  );
  assert.equal(
    contentListPlaceholder({ hasLoadedOnce: true, itemCount: 0, searching: true }),
    "no-matches",
  );
  assert.equal(
    contentListPlaceholder({ hasLoadedOnce: true, itemCount: 3, searching: false }),
    "ready",
  );
});

test("counts read as unknown until the payload arrives", () => {
  assert.equal(countLabel(undefined), "—");
  assert.equal(countLabel(null), "—");
  assert.equal(countLabel(0), "0");
  assert.equal(countLabel(12), "12");
});

test("visibility is labelled by state and acted on positively", () => {
  const hidden = visibilityLabel(true);
  assert.equal(hidden.label, "Hidden");
  assert.equal(hidden.actionLabel, "Show on the public site");

  const shown = visibilityLabel(false);
  assert.equal(shown.label, "Public");
  assert.equal(shown.actionLabel, "Hide from the public site");
});

test("settings dirty state tracks the draft against the last saved row", () => {
  const saved = { rowId: "r1", siteName: "Jinkun Chen.", googleAnalyticsId: "" };

  assert.equal(settingsDraftDirty(saved, { ...saved }), false);
  assert.equal(
    settingsDraftDirty(saved, { ...saved, googleAnalyticsId: "G-123" }),
    true,
  );
  // A field the console never rendered still counts: the PATCH carries it.
  assert.equal(settingsDraftDirty(saved, { ...saved, favicon: "/f.ico" }), true);
  assert.equal(settingsDraftDirty(null, { ...saved }), false);
  assert.equal(settingsDraftDirty(saved, null), false);

  // The Save button is gated on this, so a missed field is a field the author
  // cannot persist — booleans and empty strings both have to register.
  const flags = { rowId: "r1", sitemapAutoExcludeEnabled: true, favicon: "/f.ico" };
  assert.equal(
    settingsDraftDirty(flags, { ...flags, sitemapAutoExcludeEnabled: false }),
    true,
  );
  assert.equal(settingsDraftDirty(flags, { ...flags, favicon: "" }), true);
});

function withLatency(value, ms) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}
