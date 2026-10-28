import assert from "node:assert/strict";
import test from "node:test";
import { reloadLaunchAgent } from "../../scripts/release/setup-runner.mjs";

const agent = { uid: 501, label: "fixture-runner", plistPath: "/fixture/agent.plist" };
test("runner setup retries launchd unloading and never force-restarts a newly bootstrapped process", () => {
  const calls = []; let bootstraps = 0, pauses = 0;
  reloadLaunchAgent(agent, (args) => {
    calls.push(args);
    return args[0] === "bootstrap" ? ++bootstraps === 2 : true;
  }, () => { pauses++; });
  assert.deepEqual(calls.map((args) => args[0]), ["bootout", "enable", "bootstrap", "bootstrap", "kickstart"]);
  assert.equal(pauses, 1);
  assert.equal(calls.flat().includes("-k"), false);
});

test("runner setup stops after bounded bootstrap failures", () => {
  let bootstraps = 0, pauses = 0;
  assert.throws(() => reloadLaunchAgent(agent, (args) => {
    if (args[0] === "bootstrap") bootstraps++;
    return false;
  }, () => { pauses++; }), /three attempts/);
  assert.equal(bootstraps, 3);
  assert.equal(pauses, 2);
});
