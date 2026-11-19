import { publicCalendarFreshness } from "../../packages/calendar-core/src/public-calendar.ts";
import { verifyPublicCalendarFeeds } from "../_lib/verify-public-calendar.mjs";

const MAX_SYNC_AGE_MS = 24 * 60 * 60_000;

try {
  const summary = await verifyPublicCalendarFeeds((path) => fetch(`https://jinkunchen.com${path}`, {
    method: "GET", redirect: "manual", signal: AbortSignal.timeout(12_000),
  }), {
    // Allow the production cache window to converge before alerting on skew.
    retryDelays: [0, 30_000, 60_000, 120_000, 180_000],
    requireVerifiedAt: true,
  });
  const freshness = publicCalendarFreshness(summary.verifiedAt, Date.now(), MAX_SYNC_AGE_MS);
  if (freshness !== "current") throw new Error(freshness === "stale"
    ? "Both public feeds agree, but no verified Live calendar update arrived in 24 hours."
    : "The public verification time is not usable.");
  console.log("[public-calendar-health]", JSON.stringify(summary));
} catch (error) {
  console.error("[public-calendar-health]", error instanceof SyntaxError ? "Invalid calendar JSON." : error.message);
  process.exitCode = 1;
}
