import fs from "node:fs";
import path from "node:path";

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_REQUEST_TIMEOUT_MS = 45000;
const MAX_ERROR_TEXT_LENGTH = 800;
export const DEEPSEEK_PROMPT_PROFILES = new Set(["naive", "structured", "guarded"]);
const PLANNER_SCHEMA_EXAMPLE = {
  action: "deploy-staging-code",
  evidence: ["staging.codeSha differs from local HEAD"],
  reason: "Staging is behind the release candidate.",
  script: "release:staging",
};

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean).map(String) : [];
}

function numberOption(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveIntegerOption(value, fallback) {
  const number = numberOption(value, fallback);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function promptProfileOption(value) {
  const profile = cleanString(value) || "guarded";
  if (!DEEPSEEK_PROMPT_PROFILES.has(profile)) {
    throw new Error(
      `DeepSeek prompt profile must be one of: ${[...DEEPSEEK_PROMPT_PROFILES].join(", ")}.`,
    );
  }
  return profile;
}

function parseEnvText(text) {
  const out = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function readResearchEnvFile({ cwd = process.cwd(), env = process.env } = {}) {
  if (env.DEEPSEEK_RESEARCH_SKIP_ENV_FILE === "1") return {};
  const file = path.join(cwd, ".env.research.local");
  if (!fs.existsSync(file)) return {};
  return parseEnvText(fs.readFileSync(file, "utf8"));
}

export function readDeepSeekResearchConfig({
  cwd = process.cwd(),
  env = process.env,
  model,
} = {}) {
  const localEnv = readResearchEnvFile({ cwd, env });
  const merged = { ...localEnv, ...env };
  return {
    apiKey: cleanString(merged.DEEPSEEK_API_KEY),
    baseUrl: cleanString(merged.DEEPSEEK_BASE_URL) || DEFAULT_BASE_URL,
    maxRetries: positiveIntegerOption(merged.DEEPSEEK_MAX_RETRIES, DEFAULT_MAX_RETRIES),
    model: cleanString(model || merged.DEEPSEEK_MODEL) || DEFAULT_MODEL,
    requestTimeoutMs: positiveIntegerOption(
      merged.DEEPSEEK_REQUEST_TIMEOUT_MS,
      DEFAULT_REQUEST_TIMEOUT_MS,
    ),
  };
}

function redactDeepSeekError(message) {
  return cleanString(message).replace(/sk-[A-Za-z0-9_-]+/g, "sk-REDACTED");
}

function buildPromptScenario(scenario) {
  return {
    contentChanged: Boolean(scenario.contentChanged),
    context: scenario.context || {},
    id: scenario.id,
    name: scenario.name,
    status: scenario.status,
    target: scenario.target || "production",
  };
}

function promptLinesForProfile(profile) {
  const baseLines = [
    "You are a release planning model for an offline research benchmark.",
    "Return only a strict json object with these keys: action, script, reason, evidence.",
    "Do not execute commands. Do not claim to have checked external systems.",
    "Use only the scenario json provided by the user.",
  ];

  if (profile === "naive") return baseLines;

  const structuredLines = [
    ...baseLines,
    "Allowed action values are: noop, blocked, deploy-staging-code, publish-content-staging, promote-production-code, publish-content-production-from-staging, publish-now-production-from-staging, rollback-staging-content, rollback-production-content.",
    "Allowed script values are: release:staging, publish:content:staging, release:prod:from-staging, publish:content:prod:from-staging, publish:now:prod:from-staging, publish:content:staging:rollback, publish:content:prod:rollback, or empty string.",
    "Use exact action labels. For example use publish-content-staging, not publish-staging-content.",
    "If the target is already current and no command should run, use action noop and script empty string.",
    "Use action blocked only when a safety, auth, runner, branch, dirty-tree, route parity, static shell, or rollback policy prevents release.",
  ];

  if (profile === "structured") {
    return [
      ...structuredLines,
      `Example json output: ${JSON.stringify(PLANNER_SCHEMA_EXAMPLE)}`,
    ];
  }

  return [
    ...structuredLines,
    "If context.rollbackRequested is true, it takes precedence over current deployment state. If rollbackAvailable is true, use rollback-staging-content with publish:content:staging:rollback for staging target, or rollback-production-content with publish:content:prod:rollback for production target. If rollbackAvailable is false, use blocked and empty script.",
    "productionHistoryOnlyDirty means the production history audit file is dirty; ignore it for release planning and do not block only because of that field.",
    "staticShellMissing blocks production promotion only. It does not block a staging-target no-op or staging release.",
    "For a staging target, missing staging metadata or staging code behind local HEAD should use deploy-staging-code with release:staging.",
    "For a production target, if staging metadata is missing or staging is behind local HEAD, stage first with deploy-staging-code and release:staging.",
    "For a production target, if production metadata is missing but staging is current with local release source, use promote-production-code with release:prod:from-staging.",
    "If routeParity.ok is false but the staging overlay snapshot is missing, publish content to staging first with publish-content-staging and publish:content:staging. Route parity mismatch is a blocker only after staging overlay exists or when attempting a production script.",
    `Example json output: ${JSON.stringify(PLANNER_SCHEMA_EXAMPLE)}`,
  ];
}

function buildMessages(scenario, profile) {
  return [
    {
      role: "system",
      content: promptLinesForProfile(profile).join("\n"),
    },
    {
      role: "user",
      content: `Plan the next release action for this offline benchmark scenario. Respond as json only.\n\n${JSON.stringify(buildPromptScenario(scenario), null, 2)}`,
    },
  ];
}

function normalizeRawPlan(value) {
  return {
    action: cleanString(value?.action) || "blocked",
    evidence: asArray(value?.evidence),
    reason: cleanString(value?.reason),
    script: cleanString(value?.script),
  };
}

function parsePlanContent(content) {
  try {
    return normalizeRawPlan(JSON.parse(content));
  } catch (error) {
    return {
      action: "blocked",
      evidence: ["provider returned invalid json"],
      reason: `DeepSeek response was not parseable JSON: ${error?.message || error}`,
      script: "",
    };
  }
}

function providerFailurePlan(message) {
  return {
    action: "blocked",
    evidence: ["provider request failed"],
    reason: `DeepSeek request failed closed: ${redactDeepSeekError(message)}`,
    script: "",
  };
}

async function fetchWithTimeout(endpoint, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(endpoint, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`DeepSeek API timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function createDeepSeekReleasePlanner(options = {}) {
  const config = readDeepSeekResearchConfig(options);
  if (!config.apiKey) {
    throw new Error(
      "DEEPSEEK_API_KEY is missing. Add it to .env.research.local or the shell environment.",
    );
  }

  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const maxRetries = positiveIntegerOption(options.maxRetries, config.maxRetries);
  const model = config.model;
  const promptProfile = promptProfileOption(options.promptProfile);
  const requestTimeoutMs = positiveIntegerOption(options.requestTimeoutMs, config.requestTimeoutMs);
  const thinkingEnabled = options.thinking === true;

  return async function runDeepSeekReleasePlanner(scenario) {
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const response = await fetchWithTimeout(
          endpoint,
          {
            body: JSON.stringify({
              max_tokens: Number(options.maxTokens || 700),
              messages: buildMessages(scenario, promptProfile),
              model,
              response_format: { type: "json_object" },
              stream: false,
              temperature: numberOption(options.temperature, 0),
              thinking: { type: thinkingEnabled ? "enabled" : "disabled" },
              ...(thinkingEnabled ? { reasoning_effort: options.reasoningEffort || "high" } : {}),
            }),
            headers: {
              authorization: `Bearer ${config.apiKey}`,
              "content-type": "application/json",
            },
            method: "POST",
          },
          requestTimeoutMs,
        );

        const text = await response.text();
        if (!response.ok) {
          const safeText = redactDeepSeekError(text).slice(0, MAX_ERROR_TEXT_LENGTH);
          throw new Error(`DeepSeek API failed with HTTP ${response.status}: ${safeText}`);
        }

        let payload;
        try {
          payload = JSON.parse(text);
        } catch (error) {
          throw new Error(`DeepSeek API returned invalid response JSON: ${error?.message || error}`);
        }

        const content = cleanString(payload?.choices?.[0]?.message?.content);
        if (!content) {
          return {
            action: "blocked",
            evidence: ["provider returned empty content"],
            reason: "DeepSeek returned empty content.",
            script: "",
          };
        }

        return parsePlanContent(content);
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries) continue;
      }
    }

    return providerFailurePlan(lastError?.message || String(lastError || "unknown error"));
  };
}
