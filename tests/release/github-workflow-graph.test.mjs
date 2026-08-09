// Cross-workflow reference integrity for `.github/workflows/*.yml`.
//
// GitHub links workflows to each other by *display name*, not filename:
// `on.workflow_run.workflows: ["Foo"]` matches whatever workflow currently
// declares `name: Foo`. Rename the upstream workflow and the hook stops
// firing — no error, no warning, no run in the Actions tab. That happened to
// post-deploy-visual-check.yml, which pointed at "Release on dispatch (db
// mode)" from commit 1c8ffa6 until 2026-08 and silently never ran.
//
// A hand-rolled scan is deliberate: neither `yaml` nor `js-yaml` is a direct
// dependency, and this test must keep working when the transitive tree moves.

import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const WORKFLOW_DIR = path.join(process.cwd(), ".github/workflows");

function listWorkflowFiles() {
  return readdirSync(WORKFLOW_DIR)
    .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
    .sort();
}

function stripComments(yaml) {
  // Only whole-line comments; a `#` inside a value (e.g. a URL fragment) must
  // survive. Good enough for the key/list shapes this test reads.
  return yaml
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

function unquote(value) {
  const trimmed = String(value || "").trim();
  const quoted = /^(['"])(.*)\1$/.exec(trimmed);
  return quoted ? quoted[2] : trimmed;
}

function readWorkflowName(yaml) {
  // Top-level `name:` only — job-level names are indented.
  const match = /^name:\s*(.+)$/m.exec(stripComments(yaml));
  return match ? unquote(match[1]) : "";
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

// Returns every workflow name referenced by `on.workflow_run.workflows`,
// handling both the flow form (`["A", "B"]`) and the block form (`- A`).
function readWorkflowRunRefs(yaml) {
  const lines = stripComments(yaml).split(/\r?\n/);
  const refs = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*workflow_run:\s*$/.test(lines[i])) continue;
    const blockIndent = indentOf(lines[i]);
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (!line.trim()) continue;
      if (indentOf(line) <= blockIndent) break;
      const listed = /^\s*workflows:\s*(.*)$/.exec(line);
      if (!listed) continue;
      const inline = listed[1].trim();
      if (inline.startsWith("[")) {
        refs.push(
          ...inline
            .replace(/^\[|\]$/g, "")
            .split(",")
            .map(unquote)
            .filter(Boolean),
        );
      } else if (inline) {
        refs.push(unquote(inline));
      } else {
        for (let k = j + 1; k < lines.length; k += 1) {
          const item = /^\s*-\s*(.+)$/.exec(lines[k]);
          if (!item) break;
          refs.push(unquote(item[1]));
        }
      }
    }
  }
  return refs;
}

test("every workflow declares a top-level name", () => {
  for (const file of listWorkflowFiles()) {
    const name = readWorkflowName(readFileSync(path.join(WORKFLOW_DIR, file), "utf8"));
    assert.ok(name, `${file} has no top-level \`name:\` — workflow_run cannot reference it`);
  }
});

test("workflow_run references resolve to an existing workflow name", () => {
  const files = listWorkflowFiles();
  const names = new Set(
    files.map((file) => readWorkflowName(readFileSync(path.join(WORKFLOW_DIR, file), "utf8"))),
  );
  let checked = 0;
  for (const file of files) {
    const yaml = readFileSync(path.join(WORKFLOW_DIR, file), "utf8");
    for (const ref of readWorkflowRunRefs(yaml)) {
      checked += 1;
      assert.ok(
        names.has(ref),
        `${file} hooks workflow_run on "${ref}", but no workflow declares that name. ` +
          `Known names: ${[...names].join(", ")}`,
      );
    }
  }
  assert.ok(checked > 0, "expected at least one workflow_run reference to validate");
});

test("post-deploy visual check hooks the release workflow that exists today", () => {
  // The one reference that actually broke; pinned by name so a future rename
  // has to touch both sides.
  const refs = readWorkflowRunRefs(
    readFileSync(path.join(WORKFLOW_DIR, "post-deploy-visual-check.yml"), "utf8"),
  );
  const releaseName = readWorkflowName(
    readFileSync(path.join(WORKFLOW_DIR, "release-from-dispatch.yml"), "utf8"),
  );
  assert.deepEqual(refs, [releaseName]);
});

test("parser reads both flow-style and block-style workflow lists", () => {
  const flow = ["on:", "  workflow_run:", '    workflows: ["A", \'B\']', "    types: [completed]"].join(
    "\n",
  );
  const block = ["on:", "  workflow_run:", "    workflows:", "      - A", '      - "B"'].join("\n");
  assert.deepEqual(readWorkflowRunRefs(flow), ["A", "B"]);
  assert.deepEqual(readWorkflowRunRefs(block), ["A", "B"]);
  assert.deepEqual(readWorkflowRunRefs("on:\n  push:\n    branches: [main]\n"), []);
});
