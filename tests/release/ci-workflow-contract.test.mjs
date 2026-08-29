// Pins the CI workflow's trigger/step contract.
//
// Incident (audit P1-22): ci.yml declared only `workflow_dispatch`, so nothing
// ran on push or PR — 600+ tests, lint, a11y, snapshots and perf were all off.
// Worse, half the steps were gated on `github.event_name == 'push'`, which can
// never be true under workflow_dispatch, so the manual runs that *did* happen
// went green while silently skipping the UI matrix.
//
// The release gate is the other half of the same hole: ci.yml's
// `workspace-quality` job had never executed, and release-cloudflare.mjs
// didn't run the workspace checks either, so the Tauri surface was unverified
// on every path to production.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const ROOT = process.cwd();

// The four steps the dead `event_name == 'push'` gate silently disabled.
const UI_QUALITY_STEPS = [
  "UI Smoke (Quick)",
  "Accessibility (Axe)",
  "UI Snapshots (Light/Dark Matrix)",
  "Performance Budget",
];

function read(relative) {
  return readFileSync(path.join(ROOT, relative), "utf8");
}

// Splits a workflow into `- name: X` blocks so a gate can be attributed to the
// step it guards. Asserting "the file contains a correct gate somewhere" would
// still pass with three of the four UI steps re-broken.
function readStepBlocks(yaml) {
  const lines = yaml.split(/\r?\n/);
  const blocks = new Map();
  let current = null;
  for (const line of lines) {
    const header = /^(\s*)-\s+name:\s*(.+)$/.exec(line);
    if (header) {
      current = { indent: header[1].length, name: header[2].trim(), lines: [] };
      blocks.set(current.name, current);
      continue;
    }
    if (!current) continue;
    if (line.trim() && line.length - line.trimStart().length <= current.indent) {
      current = null;
      continue;
    }
    current.lines.push(line);
  }
  return blocks;
}

function stepGate(yaml, name) {
  const block = readStepBlocks(yaml).get(name);
  assert.ok(block, `step "${name}" disappeared from the workflow`);
  const match = /^\s*if:\s*(.+)$/m.exec(block.lines.join("\n"));
  return match ? match[1].trim() : "";
}

test("ci: push and pull_request actually trigger the workflow", () => {
  const yaml = read(".github/workflows/ci.yml");
  assert.match(yaml, /^\s{2}push:\s*$/m, "push trigger missing — CI would be manual-only again");
  assert.match(yaml, /^\s{2}pull_request:\s*$/m, "pull_request trigger missing");
  assert.match(yaml, /^\s{2}workflow_dispatch:\s*$/m, "manual runs must stay available");
});

test("ci: no step is gated on an event that cannot fire it", () => {
  const yaml = read(".github/workflows/ci.yml");
  // `event_name == 'push'` as a *positive* gate is the shape that made UI
  // smoke/axe/snapshots/perf dead under workflow_dispatch. The write-smoke
  // step is the deliberate exception: it is push+main only by design.
  const gates = [...yaml.matchAll(/^\s*if:\s*(.+)$/gm)].map((match) => match[1].trim());
  const deadGates = gates.filter(
    (gate) =>
      /github\.event_name\s*==\s*'push'/.test(gate) &&
      !/github\.ref\s*==\s*'refs\/heads\/main'/.test(gate),
  );
  assert.deepEqual(
    deadGates,
    [],
    "UI/a11y/perf steps must not be gated on `event_name == 'push'` alone",
  );
  for (const step of UI_QUALITY_STEPS) {
    assert.equal(
      stepGate(yaml, step),
      "github.event_name != 'pull_request' || steps.changes.outputs.ui_quality == 'true'",
      `${step} must run everywhere except PRs with no UI-impacting diff`,
    );
  }
});

test("ci: the paths-filter step the UI gates read is the only PR-only step besides staging smoke", () => {
  const yaml = read(".github/workflows/ci.yml");
  // `steps.changes.outputs.*` is empty whenever the filter step is skipped, so
  // the UI gates are only sound while the filter itself is PR-scoped and the
  // gates fall open on every other event.
  assert.equal(stepGate(yaml, "Detect UI-Impacting Changes (PR)"), "github.event_name == 'pull_request'");
  assert.equal(
    stepGate(yaml, "Skip UI/A11y/Perf (No UI-Impacting Changes)"),
    "github.event_name == 'pull_request' && steps.changes.outputs.ui_quality != 'true'",
  );
  assert.match(
    yaml,
    /id:\s*changes/,
    "the UI gates reference steps.changes; the filter step must keep that id",
  );
});

test("ci: lint runs and no job deploys on push", () => {
  const yaml = read(".github/workflows/ci.yml");
  assert.match(yaml, /run:\s*npm run lint\b/, "`npm run lint` is not part of CI");
  // Push-triggered deploys are staging-only and production promotion is
  // manual (AGENTS.md). CI verifies; it must never ship.
  assert.doesNotMatch(yaml, /npm run (release|deploy)[:\s]/, "CI must not run a release/deploy script");
  assert.doesNotMatch(yaml, /wrangler (deploy|versions)/, "CI must not invoke wrangler deploys");
});

test("ci: workspace-quality job still runs tsc, vitest and cargo", () => {
  const yaml = read(".github/workflows/ci.yml");
  assert.match(yaml, /^\s{2}workspace-quality:/m, "workspace-quality job missing");
  assert.match(yaml, /working-directory: apps\/workspace\s*\n\s*run: npm run typecheck/);
  assert.match(yaml, /working-directory: apps\/workspace\s*\n\s*run: npm test/);
  assert.match(yaml, /cargo test --lib/);
});

test("release gate includes the workspace typecheck and vitest run", () => {
  const script = read("scripts/release/release-cloudflare.mjs");
  assert.match(script, /\["workspace types", "npm", \["run", "typecheck"\], \{ cwd: WORKSPACE_DIR \}\]/);
  assert.match(script, /\["workspace tests", "npm", \["run", "test"\], \{ cwd: WORKSPACE_DIR \}\]/);
  // `git archive` ships tracked sources only, so the clean-snapshot path must
  // link each sub-project's deps too or the check dies at `tsc: not found`.
  assert.match(script, /dependencyRoots: \["", WORKSPACE_DIR\]/);
  // A green CHECKS marker written before these checks existed must not let a
  // release skip them.
  assert.match(script, /CHECKS\.every\(\(\[name\]\) => \(marker\.checks \|\| \[\]\)\.includes\(name\)\)/);
});

test("release gate refuses a sub-project check before spending the root checks", () => {
  const script = read("scripts/release/release-cloudflare.mjs");
  // The missing-install error must be raised in a preflight pass, not from
  // inside the run loop: discovering it after ~10 minutes of lint/test throws
  // away the whole gate for a one-command fix.
  const preflight = script.indexOf("node_modules is missing");
  const runLoop = script.indexOf("console.log(`[release-cloudflare] running ${name}`)");
  assert.ok(preflight > 0 && runLoop > 0, "expected both the guard and the CHECKS run loop");
  assert.ok(
    preflight < runLoop,
    "the missing-node_modules guard must run before the first check is executed",
  );
});
