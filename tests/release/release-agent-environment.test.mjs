import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadRunnerEnvironment } from "../../scripts/release/release-agent.mjs";

test("runner loads persistent repo credentials without overriding its launch environment", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-env-"));
  const names = ["RUNNER_ENV_TEST_SECRET", "RUNNER_ENV_TEST_OVERRIDE", "RUNNER_ENV_TEST_LOCAL"];
  const before = { ...process.env };
  try {
    for (const name of names) delete process.env[name];
    fs.writeFileSync(path.join(dir, ".env"), "RUNNER_ENV_TEST_SECRET=fixture\nRUNNER_ENV_TEST_OVERRIDE=file\nRUNNER_ENV_TEST_LOCAL=base\n");
    fs.writeFileSync(path.join(dir, ".env.local"), "RUNNER_ENV_TEST_LOCAL=local\n");
    fs.writeFileSync(path.join(dir, "runner.env"), "RUNNER_ENV_TEST_SECRET=runner\n");
    process.env.RUNNER_ENV_TEST_OVERRIDE = "launch";
    assert.equal(loadRunnerEnvironment([`--repo=${dir}`, `--env-file=${path.join(dir, "runner.env")}`, "--once"]).repo, dir);
    assert.equal(process.env.RUNNER_ENV_TEST_SECRET, "runner");
    assert.equal(process.env.RUNNER_ENV_TEST_OVERRIDE, "launch");
    assert.equal(process.env.RUNNER_ENV_TEST_LOCAL, "base");
    delete process.env.RUNNER_ENV_TEST_SECRET;
    loadRunnerEnvironment([`--repo=${dir}`, "--once"]);
    assert.equal(process.env.RUNNER_ENV_TEST_SECRET, "fixture");
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in before)) delete process.env[name];
    Object.assign(process.env, before);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
