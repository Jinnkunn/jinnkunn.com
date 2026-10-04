import assert from "node:assert/strict";
import test from "node:test";
import { startReleaseMonitor } from "../../app/site-admin/use-site-admin-release-monitor.ts";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const payload = (status, id = "mine") => ({ jobs: status ? [{ id, status, script: "publish-content", error: "fingerprint mismatch" }] : [], runners: { agents: [], queuedCount: 0, runningCount: 0 } });
function fixture(overrides = {}) {
  const events = [], timers = [];
  const cancel = startReleaseMonitor({
    jobId: "mine", deadline: 100, now: () => 0,
    readJobs: async () => payload("succeeded"),
    refreshSummary: async () => ({ release: { recommendedAction: { kind: "noop" } } }),
    onActivity: (value) => events.push(["activity", value]), onFinished: (value) => events.push(["finished", value]),
    onStop: () => events.push(["stop"]), onError: (value) => events.push(["error", value]),
    schedule: (callback, ms) => { timers.push({ callback, ms }); return timers.length; }, unschedule: () => {},
    ...overrides,
  });
  return { events, timers, cancel };
}
test("release monitor surfaces success, failure and cancellation distinctly", async () => {
  for (const state of ["succeeded", "failed", "canceled"]) {
    const { events, timers } = fixture({ readJobs: async () => payload(state) });
    await flush();
    assert.equal(events.find(([event]) => event === "finished")[1].state, state);
    assert.equal(timers.length, 0);
  }
});
test("a missing or unrelated job never masquerades as publish success", async () => {
  const { events, timers } = fixture({ readJobs: async () => payload("succeeded", "other") });
  await flush();
  assert.ok(!events.some(([event]) => event === "finished"));
  assert.equal(timers[0].ms, 3000);
});
test("network errors retry; offline runners use backoff", async () => {
  const failed = fixture({ readJobs: async () => { throw new Error("offline"); } });
  await flush();
  assert.equal(failed.timers[0].ms, 5000);
  assert.deepEqual(failed.events[0], ["error", "offline"]);
  const queued = fixture({ readJobs: async () => payload("queued") });
  await flush();
  assert.equal(queued.timers[0].ms, 10000);
});
test("canceling while a response is in flight prevents state updates and polling", async () => {
  let resolve;
  const { events, timers, cancel } = fixture({ readJobs: () => new Promise((done) => { resolve = done; }) });
  cancel();
  resolve(payload("succeeded"));
  await flush();
  assert.deepEqual(events, []);
  assert.deepEqual(timers, []);
});
test("the watch window expires without a success notice", async () => {
  const { events, timers } = fixture({ readJobs: async () => payload(null), now: () => 101 });
  await flush();
  assert.ok(events.some(([event]) => event === "stop"));
  assert.ok(!events.some(([event]) => event === "finished"));
  assert.deepEqual(timers, []);
});

test("summary refresh failures do not replay a completed publication", async () => {
  const { events, timers } = fixture({ refreshSummary: async () => { throw new Error("summary offline"); } });
  await flush();
  assert.equal(events.filter(([event]) => event === "finished").length, 1);
  assert.ok(events.some(([event, message]) => event === "error" && message === "summary offline"));
  assert.deepEqual(timers, []);
});
