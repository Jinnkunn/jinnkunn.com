#!/usr/bin/env node

import { asBool, asString, parseArgs } from "./_lib/cli.mjs";
import { loadProjectEnv } from "./load-project-env.mjs";

const PHASE = "http_request_cache_settings";
const RULE_DESCRIPTION = "R2 media cache for cdn.jinkunchen.com";
const MEDIA_HOST = "cdn.jinkunchen.com";
const DEFAULT_ZONE_NAME = "jinkunchen.com";
const ONE_YEAR_SECONDS = 31_536_000;

function readEnv(name) {
  return asString(process.env[name] || "");
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function pickCloudflareError(body, fallback) {
  const payload = asRecord(body);
  const errors = Array.isArray(payload.errors) ? payload.errors : [];
  for (const item of errors) {
    const message = asString(asRecord(item).message);
    if (message) return message;
  }
  return fallback;
}

function ruleExpression(host = MEDIA_HOST) {
  return `(http.host eq "${host}")`;
}

function desiredRule() {
  return {
    description: RULE_DESCRIPTION,
    expression: ruleExpression(),
    action: "set_cache_settings",
    action_parameters: {
      cache: true,
      edge_ttl: {
        mode: "override_origin",
        default: ONE_YEAR_SECONDS,
      },
      browser_ttl: {
        mode: "override_origin",
        default: ONE_YEAR_SECONDS,
      },
    },
    enabled: true,
  };
}

async function cfRequest({ apiToken, method, path, body }) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await res.json().catch(() => null);
  const envelope = asRecord(raw);
  if (!res.ok || envelope.success !== true) {
    const message = pickCloudflareError(raw, `Cloudflare API failed: ${res.status}`);
    const error = new Error(message);
    error.status = res.status;
    error.body = raw;
    throw error;
  }
  return envelope.result;
}

async function resolveZoneId({ apiToken, zoneId, zoneName }) {
  if (zoneId) return zoneId;
  const result = await cfRequest({
    apiToken,
    method: "GET",
    path: `/zones?name=${encodeURIComponent(zoneName)}`,
  });
  const zones = Array.isArray(result) ? result : [];
  const exact = zones.find((zone) => asString(zone?.name) === zoneName);
  const id = asString(exact?.id || zones[0]?.id || "");
  if (!id) throw new Error(`Cloudflare zone not found: ${zoneName}`);
  return id;
}

async function readEntrypointRuleset({ apiToken, zoneId }) {
  try {
    return await cfRequest({
      apiToken,
      method: "GET",
      path: `/zones/${encodeURIComponent(zoneId)}/rulesets/phases/${PHASE}/entrypoint`,
    });
  } catch (error) {
    if (error?.status === 404) return null;
    if (asString(error?.message) === "Authentication error") {
      throw new Error(
        "Authentication error while reading cache rules. The Cloudflare token can deploy Workers but likely lacks zone rulesets/cache rules permissions.",
      );
    }
    throw error;
  }
}

async function createRuleset({ apiToken, zoneId, rules }) {
  return cfRequest({
    apiToken,
    method: "POST",
    path: `/zones/${encodeURIComponent(zoneId)}/rulesets`,
    body: {
      name: "default",
      kind: "zone",
      phase: PHASE,
      rules,
    },
  });
}

async function updateRuleset({ apiToken, zoneId, ruleset, rules }) {
  return cfRequest({
    apiToken,
    method: "PUT",
    path: `/zones/${encodeURIComponent(zoneId)}/rulesets/${encodeURIComponent(ruleset.id)}`,
    body: {
      name: ruleset.name || "default",
      kind: ruleset.kind || "zone",
      phase: ruleset.phase || PHASE,
      rules,
    },
  });
}

function mergeRules(existingRules) {
  const wanted = desiredRule();
  const rules = Array.isArray(existingRules) ? existingRules : [];
  const out = [];
  let replaced = false;
  for (const rule of rules) {
    if (asString(rule?.description) === RULE_DESCRIPTION) {
      out.push({ ...wanted, ...(rule?.id ? { id: rule.id } : {}) });
      replaced = true;
    } else {
      out.push(rule);
    }
  }
  if (!replaced) out.push(wanted);
  return { rules: out, action: replaced ? "updated" : "created" };
}

async function main() {
  loadProjectEnv({ override: true, files: [".env"] });
  const args = parseArgs(process.argv.slice(2));
  const dryRun = asBool(args["dry-run"], false);
  const apiToken = readEnv("CLOUDFLARE_API_TOKEN") || readEnv("CF_API_TOKEN");
  const zoneName = asString(args.zone || process.env.CLOUDFLARE_ZONE_NAME) || DEFAULT_ZONE_NAME;
  const zoneIdArg = asString(args["zone-id"] || process.env.CLOUDFLARE_ZONE_ID);
  if (!apiToken) throw new Error("Missing CLOUDFLARE_API_TOKEN (or CF_API_TOKEN)");

  const zoneId = await resolveZoneId({ apiToken, zoneId: zoneIdArg, zoneName });
  const current = await readEntrypointRuleset({ apiToken, zoneId });
  const { rules, action } = mergeRules(current?.rules || []);

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun,
          zoneName,
          zoneId,
          phase: PHASE,
          action,
          rule: desiredRule(),
          existingRuleCount: Array.isArray(current?.rules) ? current.rules.length : 0,
          nextRuleCount: rules.length,
        },
        null,
        2,
      ),
    );
    return;
  }

  const updated = current
    ? await updateRuleset({ apiToken, zoneId, ruleset: current, rules })
    : await createRuleset({ apiToken, zoneId, rules });
  const appliedRule = (updated.rules || []).find(
    (rule) => asString(rule?.description) === RULE_DESCRIPTION,
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun,
        zoneName,
        zoneId,
        phase: PHASE,
        action,
        rulesetId: updated.id || current?.id || null,
        ruleId: appliedRule?.id || null,
        rule: appliedRule || desiredRule(),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(`[upsert-cloudflare-media-cache-rule] FAIL: ${err instanceof Error ? err.stack : String(err)}`);
  process.exitCode = 1;
});
