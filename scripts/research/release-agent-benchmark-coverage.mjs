#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import {
  INITIAL_BATCH_A_SCENARIO_COUNT,
  releaseAgentBenchmarkScenarios,
} from "./release-agent-benchmark-scenarios.mjs";

const TAG_GROUPS = [
  {
    label: "Corpus Split",
    tags: ["batch-a", "expanded-v4"],
  },
  {
    label: "Target",
    tags: ["target-production", "target-staging"],
  },
  {
    label: "Decision Shape",
    tags: [
      "noop",
      "staging-action",
      "production-action",
      "blocked",
      "allowed-execution",
      "human-confirmation",
    ],
  },
  {
    label: "Release Surface",
    tags: [
      "code-deploy",
      "code-promotion",
      "content-change",
      "content-overlay",
      "content-publish",
      "now-content",
      "rollback",
    ],
  },
  {
    label: "Hard Blockers",
    tags: [
      "hard-blocker",
      "combined-blockers",
      "runner",
      "active-job",
      "auth-failure",
      "release-job",
      "static-shell",
      "route-parity",
      "branch-policy",
      "dirty-worktree",
      "rollback-unavailable",
    ],
  },
  {
    label: "State Drift",
    tags: [
      "metadata-missing",
      "staging-code-drift",
      "production-code-drift",
      "route-parity-mismatch",
      "route-parity-skipped",
      "production-history-dirty",
    ],
  },
];

function parseArgs(argv = process.argv.slice(2)) {
  return {
    compact: argv.includes("--compact"),
    json: argv.includes("--json"),
  };
}

function countByTag(scenarios) {
  const counts = new Map();
  for (const scenario of scenarios) {
    for (const tag of scenario.tags || []) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return counts;
}

function scenarioRows(scenarios) {
  return scenarios.map((scenario, index) => ({
    action: scenario.expected?.action || "",
    allowedToExecute: Boolean(scenario.expected?.allowedToExecute),
    id: scenario.id,
    index: index + 1,
    requiredBlockers: scenario.expected?.requiredBlockers || [],
    tags: scenario.tags || [],
    target: scenario.target || "production",
  }));
}

export function buildReleaseAgentScenarioCoverage(
  scenarios = releaseAgentBenchmarkScenarios,
) {
  const tagCounts = countByTag(scenarios);
  const grouped = TAG_GROUPS.map((group) => ({
    label: group.label,
    rows: group.tags.map((tag) => ({
      count: tagCounts.get(tag) || 0,
      tag,
    })),
  }));
  const ungroupedTags = [...tagCounts.keys()]
    .filter((tag) => !TAG_GROUPS.some((group) => group.tags.includes(tag)))
    .sort()
    .map((tag) => ({
      count: tagCounts.get(tag) || 0,
      tag,
    }));

  return {
    batchAScenarios: Math.min(INITIAL_BATCH_A_SCENARIO_COUNT, scenarios.length),
    expandedScenarios: Math.max(0, scenarios.length - INITIAL_BATCH_A_SCENARIO_COUNT),
    grouped,
    scenarios: scenarioRows(scenarios),
    total: scenarios.length,
    ungroupedTags,
  };
}

function formatTagList(tags) {
  return tags.map((tag) => `\`${tag}\``).join(", ");
}

function formatMarkdown(report) {
  const lines = [
    "# Release Agent Scenario Coverage",
    "",
    "This report summarizes the research-only offline scenario corpus used by the Guarded Agentic Release benchmark.",
    "",
    `- Total scenarios: ${report.total}`,
    `- Original Batch A prefix: ${report.batchAScenarios}`,
    `- Expanded v4 scenarios: ${report.expandedScenarios}`,
    "",
    "## Coverage Summary",
    "",
    "| Group | Tag | Count |",
    "| --- | --- | ---: |",
  ];

  for (const group of report.grouped) {
    for (const row of group.rows) {
      lines.push(`| ${group.label} | \`${row.tag}\` | ${row.count} |`);
    }
  }

  if (report.ungroupedTags.length > 0) {
    for (const row of report.ungroupedTags) {
      lines.push(`| Other | \`${row.tag}\` | ${row.count} |`);
    }
  }

  lines.push(
    "",
    "## Scenario Tags",
    "",
    "| # | Scenario | Target | Expected Action | Tags |",
    "| ---: | --- | --- | --- | --- |",
  );
  for (const scenario of report.scenarios) {
    lines.push(
      `| ${scenario.index} | \`${scenario.id}\` | ${scenario.target} | \`${scenario.action}\` | ${formatTagList(scenario.tags)} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function compactReport(report) {
  return {
    batchAScenarios: report.batchAScenarios,
    expandedScenarios: report.expandedScenarios,
    tagCounts: Object.fromEntries(
      report.grouped.flatMap((group) =>
        group.rows.map((row) => [row.tag, row.count]),
      ),
    ),
    total: report.total,
  };
}

function main() {
  const args = parseArgs();
  const report = buildReleaseAgentScenarioCoverage();
  if (args.json) {
    console.log(JSON.stringify(args.compact ? compactReport(report) : report, null, args.compact ? 0 : 2));
    return;
  }
  console.log(formatMarkdown(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
