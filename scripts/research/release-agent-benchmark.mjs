#!/usr/bin/env node

import {
  evaluateReleaseAgentScenariosAsync,
} from "./release-agent-benchmark-lib.mjs";
import {
  createSingleBenchmarkPlanner,
  SINGLE_PLANNER_CHOICES,
} from "./release-agent-benchmark-planners.mjs";
import {
  selectReleaseAgentBenchmarkScenarios,
} from "./release-agent-benchmark-scenarios.mjs";

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function argValue(argv, name) {
  const prefix = `--${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argv.indexOf(`--${name}`);
  if (index >= 0) return argv[index + 1];
  return "";
}

function parseLimit(value) {
  if (!value) return null;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("--limit must be a positive integer.");
  }
  return limit;
}

function parseArgs(argv = process.argv.slice(2)) {
  const planner = cleanString(argValue(argv, "planner")) || "rule";
  if (!SINGLE_PLANNER_CHOICES.has(planner)) {
    throw new Error(`--planner must be one of: ${[...SINGLE_PLANNER_CHOICES].join(", ")}.`);
  }

  return {
    compact: argv.includes("--compact"),
    failOnMismatch: argv.includes("--fail-on-mismatch"),
    json: argv.includes("--json"),
    limit: parseLimit(argValue(argv, "limit")),
    maxRetries: argValue(argv, "max-retries"),
    maxTokens: argValue(argv, "max-tokens"),
    model: cleanString(argValue(argv, "model")),
    planner,
    promptProfile: cleanString(argValue(argv, "prompt-profile")),
    reasoningEffort: cleanString(argValue(argv, "reasoning-effort")),
    requestTimeoutMs: argValue(argv, "request-timeout-ms"),
    scenarioTag: cleanString(argValue(argv, "scenario-tag")),
    temperature: argValue(argv, "temperature"),
    thinking: argv.includes("--thinking"),
  };
}

function failedResults(report) {
  return report.results.filter((result) =>
    Object.values(result.checks).some((ok) => !ok),
  );
}

function formatMetric(value) {
  return Number(value).toFixed(3);
}

function printHumanReport(report, metadata) {
  const failures = failedResults(report);
  console.log("[release-agent-benchmark] Guarded Agentic Release benchmark");
  console.log(`planner: ${metadata.planner}${metadata.model ? ` (${metadata.model})` : ""}`);
  if (metadata.promptProfile) console.log(`prompt_profile: ${metadata.promptProfile}`);
  if (metadata.scenarioTag) console.log(`scenario_tag: ${metadata.scenarioTag}`);
  console.log(`verified: ${metadata.verified ? "yes" : "no"}`);
  console.log(`scenarios: ${report.total}`);
  for (const [name, value] of Object.entries(report.metrics)) {
    console.log(`${name}: ${formatMetric(value)}`);
  }
  console.log(`failures: ${failures.length}`);
  if (failures.length === 0) return;
  for (const failure of failures) {
    console.log(`- ${failure.id}: expected ${failure.expected.action}, got ${failure.output.action}`);
  }
}

async function main() {
  const args = parseArgs();
  const scenarios = selectReleaseAgentBenchmarkScenarios({
    limit: args.limit,
    scenarioTag: args.scenarioTag,
  });
  if (scenarios.length === 0) {
    throw new Error(`No scenarios matched --scenario-tag=${args.scenarioTag}.`);
  }
  const plannerConfig = createSingleBenchmarkPlanner(args);
  const report = await evaluateReleaseAgentScenariosAsync(
    scenarios,
    plannerConfig.planner,
  );
  const failures = failedResults(report);
  const metadata = {
    model: plannerConfig.model,
    planner: plannerConfig.label,
    promptProfile: plannerConfig.promptProfile,
    scenarioTag: args.scenarioTag,
    verified: plannerConfig.verified,
  };

  if (args.json) {
    const payload = args.compact
      ? { ...metadata, metrics: report.metrics, total: report.total }
      : { ...metadata, ...report };
    console.log(JSON.stringify(payload, null, args.compact ? 0 : 2));
  } else {
    printHumanReport(report, metadata);
  }

  if (failures.length > 0 && (args.failOnMismatch || args.planner === "rule")) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
