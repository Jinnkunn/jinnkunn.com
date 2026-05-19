#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import {
  evaluateReleaseAgentScenariosAsync,
  recomputeReleaseAgentReport,
  RELEASE_AGENT_BENCHMARK_METRICS,
} from "./release-agent-benchmark-lib.mjs";
import {
  createConditionBenchmarkPlanner,
  EXPERIMENT_CONDITIONS,
} from "./release-agent-benchmark-planners.mjs";
import {
  selectReleaseAgentBenchmarkScenarios,
} from "./release-agent-benchmark-scenarios.mjs";

const EXPERIMENT_NAME = "release-agent-benchmark-v2";
const METRIC_NAMES = RELEASE_AGENT_BENCHMARK_METRICS;
const OUTPUT_RESEARCH_DIR = path.resolve(process.cwd(), "output", "research");

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

function parsePositiveInteger(value, name, fallback) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--${name} must be a positive integer.`);
  }
  return parsed;
}

function parseConditions(value) {
  const raw = cleanString(value);
  if (!raw) return ["rule-only"];
  if (raw === "all") return [...EXPERIMENT_CONDITIONS];

  const conditions = [...new Set(raw.split(",").map(cleanString).filter(Boolean))];
  const unknown = conditions.filter((condition) => !EXPERIMENT_CONDITIONS.has(condition));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown experiment condition(s): ${unknown.join(", ")}. Valid conditions: ${[
        ...EXPERIMENT_CONDITIONS,
      ].join(", ")}.`,
    );
  }
  return conditions;
}

function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function defaultOutputDir() {
  return path.join(OUTPUT_RESEARCH_DIR, "release-agent-benchmark-runs", timestampSlug());
}

function resolveOutputDir(value) {
  const resolved = path.resolve(cleanString(value) || defaultOutputDir());
  const relative = path.relative(OUTPUT_RESEARCH_DIR, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Experiment artifacts must be written under output/research.");
  }
  return resolved;
}

function resolveRunDir(value) {
  const raw = cleanString(value);
  if (!raw) return "";
  const resolved = path.resolve(raw);
  const relative = path.relative(OUTPUT_RESEARCH_DIR, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Existing experiment artifacts must be under output/research.");
  }
  return resolved;
}

function parseArgs(argv = process.argv.slice(2)) {
  return {
    compact: argv.includes("--compact"),
    conditions: parseConditions(argValue(argv, "conditions")),
    concurrency: parsePositiveInteger(argValue(argv, "concurrency"), "concurrency", 1),
    failOnMismatch: argv.includes("--fail-on-mismatch"),
    json: argv.includes("--json"),
    limit: parsePositiveInteger(argValue(argv, "limit"), "limit", null),
    maxTokens: argValue(argv, "max-tokens"),
    maxRetries: argValue(argv, "max-retries"),
    model: cleanString(argValue(argv, "model")),
    outputDir: resolveOutputDir(argValue(argv, "output-dir")),
    promptProfile: cleanString(argValue(argv, "prompt-profile")),
    reasoningEffort: cleanString(argValue(argv, "reasoning-effort")),
    requestTimeoutMs: argValue(argv, "request-timeout-ms"),
    refreshRunDir: resolveRunDir(argValue(argv, "refresh-run-dir")),
    runs: parsePositiveInteger(argValue(argv, "runs"), "runs", 1),
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

function stats(values, options = {}) {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) {
    return { ci95High: 0, ci95Low: 0, count: 0, max: 0, mean: 0, min: 0, stddev: 0, stderr: 0 };
  }
  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  const variance =
    finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / finite.length;
  const sampleVariance =
    finite.length > 1
      ? finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (finite.length - 1)
      : 0;
  const t95ByDf = new Map([
    [1, 12.706],
    [2, 4.303],
    [3, 3.182],
    [4, 2.776],
    [5, 2.571],
    [6, 2.447],
    [7, 2.365],
    [8, 2.306],
    [9, 2.262],
    [10, 2.228],
  ]);
  const stderr = finite.length > 1 ? Math.sqrt(sampleVariance) / Math.sqrt(finite.length) : 0;
  const t95 = t95ByDf.get(finite.length - 1) || 1.96;
  const margin = t95 * stderr;
  const ci95Low = mean - margin;
  const ci95High = mean + margin;
  return {
    ci95High: options.bounded ? Math.min(1, ci95High) : ci95High,
    ci95Low: options.bounded ? Math.max(0, ci95Low) : ci95Low,
    count: finite.length,
    max: Math.max(...finite),
    mean,
    min: Math.min(...finite),
    stddev: Math.sqrt(variance),
    stderr,
  };
}

function aggregateRuns(runs) {
  const metrics = {};
  for (const metric of METRIC_NAMES) {
    metrics[metric] = stats(runs.map((run) => Number(run.metrics[metric])), {
      bounded: true,
    });
  }
  return {
    failureCount: stats(runs.map((run) => Number(run.failureCount))),
    metrics,
  };
}

function runFileName(condition, runIndex) {
  return `${condition}-run-${String(runIndex).padStart(2, "0")}.json`;
}

function writeJson(file, payload) {
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

function formatNumber(value) {
  return Number(value).toFixed(3);
}

function formatCsv(summary) {
  const rows = [
    ["condition", "runs", "metric", "mean", "min", "max", "stddev", "stderr", "ci95_low", "ci95_high"],
  ];
  for (const condition of summary.conditions) {
    for (const metric of METRIC_NAMES) {
      const metricStats = condition.aggregate.metrics[metric];
      rows.push([
        condition.condition,
        String(condition.runs.length),
        metric,
        String(metricStats.mean),
        String(metricStats.min),
        String(metricStats.max),
        String(metricStats.stddev),
        String(metricStats.stderr),
        String(metricStats.ci95Low),
        String(metricStats.ci95High),
      ]);
    }
  }
  return `${rows.map((row) => row.join(",")).join("\n")}\n`;
}

function formatMarkdown(summary) {
  const lines = [
    "# Release Agent Benchmark Experiment",
    "",
    `- Experiment: ${summary.experiment}`,
    `- Scenarios: ${summary.totalScenarios}`,
    `- Runs per condition: ${summary.runsPerCondition}`,
    `- Concurrency: ${summary.concurrency || 1}`,
    ...(summary.scenarioTag ? [`- Scenario tag: ${summary.scenarioTag}`] : []),
    "",
    "| Condition | Verified | Prompt | Action Mean | Script Mean | Blocker Recall | Unsafe Allowed Max | Confirm Violation Max | Hard Blocker Miss | FP Block Mean | Invalid Script Max | Verifier Intervention | Failure Max |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const condition of summary.conditions) {
    lines.push(
      [
        condition.condition,
        condition.verified ? "yes" : "no",
        condition.promptProfile || "n/a",
        formatNumber(condition.aggregate.metrics.next_action_accuracy.mean),
        formatNumber(condition.aggregate.metrics.script_accuracy.mean),
        formatNumber(condition.aggregate.metrics.blocker_recall.mean),
        formatNumber(condition.aggregate.metrics.unsafe_allowed_execution_rate.max),
        formatNumber(condition.aggregate.metrics.production_confirmation_violation_rate.max),
        formatNumber(condition.aggregate.metrics.hard_blocker_miss_rate.mean),
        formatNumber(condition.aggregate.metrics.false_positive_block_rate.mean),
        formatNumber(condition.aggregate.metrics.invalid_script_rate.max),
        formatNumber(condition.aggregate.metrics.verifier_intervention_rate.mean),
        formatNumber(condition.aggregate.failureCount.max),
      ].join(" | ").replace(/^/, "| ").replace(/$/, " |"),
    );
  }

  return `${lines.join("\n")}\n`;
}

function compactSummary(summary) {
  return {
    conditions: summary.conditions.map((condition) => ({
      aggregate: {
        failureCount: condition.aggregate.failureCount,
        metrics: Object.fromEntries(
          METRIC_NAMES.map((metric) => [metric, condition.aggregate.metrics[metric].mean]),
        ),
      },
      condition: condition.condition,
      model: condition.model,
      promptProfile: condition.promptProfile,
      runs: condition.runs.length,
      verified: condition.verified,
    })),
    concurrency: summary.concurrency || 1,
    experiment: summary.experiment,
    outputDir: summary.outputDir,
    runsPerCondition: summary.runsPerCondition,
    scenarioTag: summary.scenarioTag || "",
    totalScenarios: summary.totalScenarios,
  };
}

async function runCondition(condition, args, scenarios) {
  const plannerConfig = createConditionBenchmarkPlanner(condition, args);
  const runs = [];
  const fullReports = [];
  fs.mkdirSync(args.outputDir, { recursive: true });

  for (let runIndex = 1; runIndex <= args.runs; runIndex += 1) {
    const startedAt = Date.now();
    console.error(
      `[release-agent-benchmark-experiments] ${condition} run ${runIndex}/${args.runs} started`,
    );
    const report = await evaluateReleaseAgentScenariosAsync(
      scenarios,
      plannerConfig.planner,
      { concurrency: args.concurrency },
    );
    const failures = failedResults(report);
    const reportFile = runFileName(condition, runIndex);
    const runSummary = {
      failureCount: failures.length,
      failureIds: failures.map((failure) => failure.id),
      metrics: report.metrics,
      reportFile,
      runIndex,
      total: report.total,
    };
    const fullReport = {
      condition,
      experiment: EXPERIMENT_NAME,
      model: plannerConfig.model,
      promptProfile: plannerConfig.promptProfile,
      provider: plannerConfig.provider,
      runIndex,
      verified: plannerConfig.verified,
      ...report,
    };
    runs.push(runSummary);
    fullReports.push({
      condition,
      model: plannerConfig.model,
      promptProfile: plannerConfig.promptProfile,
      provider: plannerConfig.provider,
      report,
      reportFile,
      runIndex,
      verified: plannerConfig.verified,
    });
    writeJson(path.join(args.outputDir, reportFile), fullReport);
    console.error(
      `[release-agent-benchmark-experiments] ${condition} run ${runIndex}/${args.runs} finished in ${Math.round(
        (Date.now() - startedAt) / 1000,
      )}s failures=${failures.length}`,
    );
  }

  return {
    summary: {
      aggregate: aggregateRuns(runs),
      condition,
      model: plannerConfig.model,
      promptProfile: plannerConfig.promptProfile,
      provider: plannerConfig.provider,
      runs,
      verified: plannerConfig.verified,
    },
    fullReports,
  };
}

function writeArtifacts(summary, fullReports) {
  fs.mkdirSync(summary.outputDir, { recursive: true });
  for (const item of fullReports) {
    writeJson(path.join(summary.outputDir, item.reportFile), {
      condition: item.condition,
      experiment: summary.experiment,
      model: item.model,
      promptProfile: item.promptProfile,
      provider: item.provider,
      runIndex: item.runIndex,
      verified: item.verified,
      ...item.report,
    });
  }
  writeJson(path.join(summary.outputDir, "summary.json"), summary);
  fs.writeFileSync(path.join(summary.outputDir, "summary.csv"), formatCsv(summary));
  fs.writeFileSync(path.join(summary.outputDir, "summary.md"), formatMarkdown(summary));
}

function printHumanSummary(summary) {
  console.log("[release-agent-benchmark-experiments] repeatable experiment runner");
  console.log(`output_dir: ${summary.outputDir}`);
  console.log(`scenarios: ${summary.totalScenarios}`);
  console.log(`runs_per_condition: ${summary.runsPerCondition}`);
  console.log(`concurrency: ${summary.concurrency || 1}`);
  for (const condition of summary.conditions) {
    const action = condition.aggregate.metrics.next_action_accuracy.mean;
    const script = condition.aggregate.metrics.script_accuracy.mean;
    const unsafe = condition.aggregate.metrics.unsafe_allowed_execution_rate.max;
    console.log(
      `${condition.condition}: action_mean=${formatNumber(action)} script_mean=${formatNumber(
        script,
      )} unsafe_allowed_max=${formatNumber(unsafe)} failure_max=${formatNumber(
        condition.aggregate.failureCount.max,
      )}`,
    );
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function refreshExistingRunDir(runDir) {
  const summaryFile = path.join(runDir, "summary.json");
  if (!fs.existsSync(summaryFile)) {
    throw new Error(`summary.json not found in ${runDir}`);
  }

  const oldSummary = readJson(summaryFile);
  const conditionSummaries = [];
  const fullReports = [];

  for (const condition of oldSummary.conditions || []) {
    const runs = [];
    for (const run of condition.runs || []) {
      const reportFile = run.reportFile;
      const reportPath = path.join(runDir, reportFile);
      if (!fs.existsSync(reportPath)) {
        throw new Error(`Run report not found: ${reportPath}`);
      }

      const report = recomputeReleaseAgentReport(readJson(reportPath));
      const failures = failedResults(report);
      runs.push({
        failureCount: failures.length,
        failureIds: failures.map((failure) => failure.id),
        metrics: report.metrics,
        reportFile,
        runIndex: run.runIndex || report.runIndex,
        total: report.total,
      });
      fullReports.push({
        condition: condition.condition,
        model: condition.model || report.model || "",
        promptProfile: condition.promptProfile || report.promptProfile || "",
        provider: condition.provider || report.provider || "",
        report,
        reportFile,
        runIndex: run.runIndex || report.runIndex,
        verified: Boolean(condition.verified),
      });
    }

    conditionSummaries.push({
      aggregate: aggregateRuns(runs),
      condition: condition.condition,
      model: condition.model,
      promptProfile: condition.promptProfile,
      provider: condition.provider,
      runs,
      verified: Boolean(condition.verified),
    });
  }

  const summary = {
    ...oldSummary,
    conditions: conditionSummaries,
    refreshedAt: new Date().toISOString(),
  };
  writeArtifacts(summary, fullReports);
  return summary;
}

async function main() {
  const args = parseArgs();
  if (args.refreshRunDir) {
    const summary = refreshExistingRunDir(args.refreshRunDir);
    if (args.json) {
      const payload = args.compact ? compactSummary(summary) : summary;
      console.log(JSON.stringify(payload, null, args.compact ? 0 : 2));
    } else {
      printHumanSummary(summary);
    }
    return;
  }

  const scenarios = selectReleaseAgentBenchmarkScenarios({
    limit: args.limit,
    scenarioTag: args.scenarioTag,
  });
  if (scenarios.length === 0) {
    throw new Error(`No scenarios matched --scenario-tag=${args.scenarioTag}.`);
  }
  const conditionSummaries = [];
  const fullReports = [];

  for (const condition of args.conditions) {
    const result = await runCondition(condition, args, scenarios);
    conditionSummaries.push(result.summary);
    fullReports.push(...result.fullReports);
  }

  const summary = {
    conditions: conditionSummaries,
    concurrency: args.concurrency,
    createdAt: new Date().toISOString(),
    experiment: EXPERIMENT_NAME,
    outputDir: args.outputDir,
    runsPerCondition: args.runs,
    scenarioTag: args.scenarioTag,
    totalScenarios: scenarios.length,
  };

  writeArtifacts(summary, fullReports);

  if (args.json) {
    const payload = args.compact ? compactSummary(summary) : summary;
    console.log(JSON.stringify(payload, null, args.compact ? 0 : 2));
  } else {
    printHumanSummary(summary);
  }

  const hasFailures = conditionSummaries.some(
    (condition) => condition.aggregate.failureCount.max > 0,
  );
  const ruleOnlyFailed = conditionSummaries.some(
    (condition) =>
      condition.condition === "rule-only" && condition.aggregate.failureCount.max > 0,
  );
  if (hasFailures && (args.failOnMismatch || ruleOnlyFailed)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
