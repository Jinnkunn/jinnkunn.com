/**
 * Single source of truth for the Cloudflare Worker version "annotation
 * message" that release-cloudflare.mjs writes and the promote/dispatch
 * paths read.
 *
 * Format: a single line with whitespace-separated `key=value` tokens,
 * e.g.
 *
 *   Release upload (staging) source=abc1234 branch=main code=abc1234
 *   codeBranch=main content=abc1234 contentBranch=main
 *
 * Tokens parsed:
 *   source       — historical alias for contentSha; older deployments only set this.
 *   branch       — historical alias for contentBranch.
 *   code         — current code SHA being deployed.
 *   codeBranch   — branch the code came from (typically `main`).
 *   content      — SHA the content was dumped at; equals code when there's
 *                  no overlay.
 *   contentBranch — branch the content came from.
 *
 * MIRROR: lib/server/deploy-metadata.ts is the canonical TypeScript
 * implementation used by the Worker runtime. Scripts run with plain
 * `node *.mjs` and can't import `.ts`, so this file mirrors that parser
 * for the script side. The test in tests/release-deploy-metadata-mirror
 * .test.mjs pins both impls to the same fixture so they cannot drift
 * silently.
 *
 * Shape note: this script-side mirror returns plain strings (empty when
 * absent) to match the existing script ergonomics. The TS canonical
 * returns `string | null` for the same fields. Use `effectiveCodeSha`
 * below for null-safe access regardless of which impl produced the
 * metadata.
 */

const SHA_RE = /^[a-f0-9]{7,40}$/i;

function asString(value) {
  return typeof value === "string" ? value : "";
}

function normalizeSha(value) {
  const raw = asString(value).trim().toLowerCase();
  return SHA_RE.test(raw) ? raw : "";
}

/**
 * Parse a Worker version annotation message into a typed metadata bag.
 * Missing tokens come back as empty strings — callers decide whether
 * that's a fatal error (e.g. STAGING_METADATA_UNREADABLE) or fine.
 */
export function parseDeployMessage(messageRaw) {
  const message = asString(messageRaw);
  const token = (name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hit = new RegExp(`\\b${escaped}=([^\\s]+)`, "i").exec(message);
    return hit?.[1] || "";
  };
  const sourceSha = normalizeSha(token("source"));
  const sourceBranch = asString(token("branch"));
  return {
    sourceSha,
    sourceBranch,
    codeSha: normalizeSha(token("code")),
    codeBranch: asString(token("codeBranch")),
    contentSha: normalizeSha(token("content")) || sourceSha,
    contentBranch: asString(token("contentBranch")) || sourceBranch,
  };
}

/**
 * Pick the effective "code SHA this Worker version was built from"
 * value, with the historical fallback to `source=` for pre-overlay
 * deployments.
 */
export function effectiveCodeSha(meta) {
  if (!meta) return "";
  return normalizeSha(meta.codeSha) || normalizeSha(meta.sourceSha);
}

/**
 * Compare a Worker deployment's metadata against the release-source code
 * SHA. Returns a verdict the release scripts can render directly.
 *
 *   { ok: true,  meta }                          — staging is up to date
 *   { ok: false, code: "STAGING_METADATA_UNREADABLE", detail }
 *   { ok: false, code: "STAGING_SOURCE_MISMATCH",    detail, stagingSha }
 */
export function compareDeploymentToReleaseSource({ meta, sourceSha }) {
  const stagingSha = effectiveCodeSha(meta);
  if (!stagingSha) {
    return {
      ok: false,
      code: "STAGING_METADATA_UNREADABLE",
      detail: `Worker deployment annotation has no code= or source= SHA; metadata=${JSON.stringify(meta || {})}`,
    };
  }
  const target = normalizeSha(sourceSha);
  if (!target) {
    return {
      ok: false,
      code: "RELEASE_SOURCE_UNREADABLE",
      detail: `Could not resolve a usable release-source git SHA: ${sourceSha}`,
    };
  }
  if (stagingSha !== target) {
    return {
      ok: false,
      code: "STAGING_SOURCE_MISMATCH",
      detail: [
        "Staging is on a different code SHA than the release source:",
        `  staging: ${stagingSha}`,
        `  source:  ${target}`,
        "",
        "Run `npm run release:staging` first so staging matches the release source, then retry.",
      ].join("\n"),
      stagingSha,
    };
  }
  return { ok: true, meta, stagingSha };
}
