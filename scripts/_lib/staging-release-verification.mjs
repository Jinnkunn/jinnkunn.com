import { clearMarker, readMarker, writeMarker } from "./release-cache.mjs";
import { readStagingOverlayIdentity, readTargetWorkerDeployment } from "../content/publish-content.mjs";

const BUCKET = "staging-acceptance";
const TTL_MS = 30 * 60 * 1000;
const CHECKS = ["verify:cf:staging", "verify:staging:authenticated", "verify:calendar:staging", "check:staging-visual"];
const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export function stagingReleaseIdentity(worker, overlay) {
  const status = overlay?.status;
  if (!worker?.versionId || !worker.deploymentId || !SHA1.test(worker.workerCodeSha) ||
      !SHA1.test(worker.meta?.contentSha) || status?.ok !== true || status.env !== "staging" ||
      status.workerCodeSha !== worker.workerCodeSha || !SHA1.test(status.snapshotSha) ||
      !SHA256.test(overlay.publication_sha) || status.publicationSnapshotSha !== overlay.publication_sha ||
      !SHA1.test(overlay.baseline_row_sha) || !SHA1.test(overlay.status_sha)) {
    throw new Error("Staging has no matching Worker and published content baseline. Repair staging before promotion.");
  }
  return {
    versionId: worker.versionId,
    deploymentId: worker.deploymentId,
    codeSha: worker.workerCodeSha,
    artifactSha: worker.meta.contentSha,
    publicationSha: overlay.publication_sha,
    overlaySha: status.snapshotSha,
    baselineRowSha: overlay.baseline_row_sha,
    overlayStatusSha: overlay.status_sha,
  };
}

export async function readStagingReleaseIdentity() {
  const worker = await readTargetWorkerDeployment("staging");
  return stagingReleaseIdentity(worker, await readStagingOverlayIdentity(worker.overlayKey));
}

export function assertStagingReleaseIdentity(actual, expected) {
  if (Object.entries(expected).some(([key, value]) => !value || actual[key] !== value)) {
    throw new Error("Staging Worker or published content changed during release verification. Verify the active deployment again.");
  }
}

export async function verifyStagingRelease({ root, expected, runCheck,
  force = false, skipAuthenticated = false, skipVisual = false, readIdentity = readStagingReleaseIdentity }) {
  const identity = await readIdentity();
  assertStagingReleaseIdentity(identity, expected);
  const complete = !skipAuthenticated && !skipVisual;
  const marker = complete && !force
    ? readMarker({ repoRoot: root, bucket: BUCKET, sha: identity.codeSha, maxAgeMs: TTL_MS })
    : null;
  if (Array.isArray(marker?.checks) && CHECKS.every((check) => marker.checks.includes(check)) &&
      Object.entries(identity).every(([key, value]) => marker.identity?.[key] === value)) {
    return { identity, checks: CHECKS, cached: true };
  }
  clearMarker({ repoRoot: root, bucket: BUCKET, sha: identity.codeSha });
  const checks = CHECKS.filter((check) =>
    !(skipAuthenticated && check === "verify:staging:authenticated") &&
    !(skipVisual && check === "check:staging-visual"));
  for (const check of checks) await runCheck(check);
  assertStagingReleaseIdentity(await readIdentity(), identity);
  if (complete) writeMarker({ repoRoot: root, bucket: BUCKET, sha: identity.codeSha, payload: { identity, checks } });
  return { identity, checks, cached: false };
}
