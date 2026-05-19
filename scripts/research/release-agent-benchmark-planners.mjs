import { runRuleReleasePlanner } from "./release-agent-benchmark-lib.mjs";
import {
  createDeepSeekReleasePlanner,
  readDeepSeekResearchConfig,
} from "./providers/deepseek.mjs";

export const SINGLE_PLANNER_CHOICES = new Set(["rule", "deepseek", "deepseek-only"]);
export const EXPERIMENT_CONDITIONS = new Set([
  "rule-only",
  "deepseek-naive",
  "deepseek-structured",
  "deepseek-guarded",
  "deepseek-only",
]);

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean).map(String) : [];
}

function normalizeRawPlan(value) {
  return {
    action: cleanString(value?.action) || "blocked",
    evidence: asArray(value?.evidence),
    reason: cleanString(value?.reason),
    script: cleanString(value?.script),
  };
}

function unverifiedOutput(rawPlanInput) {
  const rawPlan = normalizeRawPlan(rawPlanInput);
  return {
    action: rawPlan.action,
    allowedToExecute: rawPlan.action !== "blocked" && Boolean(rawPlan.script),
    blockers: [],
    evidence: rawPlan.evidence,
    reason: rawPlan.reason,
    requiresHumanConfirmation: false,
    script: rawPlan.script,
  };
}

function createDeepSeekPlannerConfig(options, { promptProfile, verified }) {
  const config = readDeepSeekResearchConfig({ model: options.model });
  const planner = createDeepSeekReleasePlanner({
    maxRetries: options.maxRetries,
    maxTokens: options.maxTokens,
    model: options.model,
    promptProfile,
    reasoningEffort: options.reasoningEffort,
    requestTimeoutMs: options.requestTimeoutMs,
    temperature: options.temperature,
    thinking: options.thinking,
  });

  return {
    model: config.model,
    planner: verified ? planner : async (scenario) => unverifiedOutput(await planner(scenario)),
    promptProfile,
    provider: "deepseek",
    verified,
  };
}

export function createSingleBenchmarkPlanner(args) {
  if (args.planner === "rule") {
    return {
      label: "rule",
      model: "",
      planner: runRuleReleasePlanner,
      promptProfile: "",
      provider: "rule",
      verified: true,
    };
  }

  const promptProfile =
    cleanString(args.promptProfile) || (args.planner === "deepseek-only" ? "structured" : "guarded");
  const deepSeek = createDeepSeekPlannerConfig(args, {
    promptProfile,
    verified: args.planner !== "deepseek-only",
  });

  return {
    ...deepSeek,
    label: args.planner,
  };
}

export function createConditionBenchmarkPlanner(condition, options = {}) {
  if (condition === "rule-only") {
    return {
      condition,
      label: "rule",
      model: "",
      planner: runRuleReleasePlanner,
      promptProfile: "",
      provider: "rule",
      verified: true,
    };
  }

  const profileByCondition = {
    "deepseek-guarded": "guarded",
    "deepseek-naive": "naive",
    "deepseek-only": cleanString(options.promptProfile) || "structured",
    "deepseek-structured": "structured",
  };
  const promptProfile = profileByCondition[condition];
  if (!promptProfile) {
    throw new Error(
      `Experiment condition must be one of: ${[...EXPERIMENT_CONDITIONS].join(", ")}.`,
    );
  }

  const deepSeek = createDeepSeekPlannerConfig(options, {
    promptProfile,
    verified: condition !== "deepseek-only",
  });

  return {
    ...deepSeek,
    condition,
    label: condition,
  };
}
