import { useEffect, useRef, useState } from "react";
import {
  buildSiteAdminReleaseProgress, selectActiveReleaseJob,
  type SiteAdminReleaseJobLike, type SiteAdminReleaseRunnerLike,
} from "../../lib/site-admin/release-progress.ts";
import { releaseJobOutcome, type ReleaseJobOutcome } from "./site-admin-console-model.ts";

export type ReleaseJobsPayload = {
  jobs: SiteAdminReleaseJobLike[];
  runners: { agents: SiteAdminReleaseRunnerLike[]; queuedCount: number; runningCount: number };
};
type FinishedOutcome = Exclude<ReleaseJobOutcome, { state: "active" }>;

export function startReleaseMonitor({
  jobId, deadline, readJobs, refreshSummary, onActivity, onFinished, onStop, onError,
  now = Date.now, schedule = (callback: () => void, ms: number) => setTimeout(callback, ms),
  unschedule = (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
}: {
  jobId: string; deadline: number;
  readJobs: () => Promise<ReleaseJobsPayload>;
  refreshSummary: () => Promise<{ release: { recommendedAction: { kind: string } } } | null>;
  onActivity: (payload: ReleaseJobsPayload | null) => void;
  onFinished: (outcome: FinishedOutcome) => void;
  onStop: () => void;
  onError: (error: string) => void;
  now?: () => number;
  schedule?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  unschedule?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  let canceled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const later = (ms: number) => { if (!canceled) timer = schedule(() => void poll(), ms); };
  const poll = async () => {
    try {
      const payload = await readJobs();
      if (canceled) return;
      const watched = jobId ? payload.jobs.find((job) => job.id === jobId) : null;
      const outcome = watched ? releaseJobOutcome(watched) : null;
      if (outcome && outcome.state !== "active") {
        onActivity(null);
        onFinished(outcome);
        // A summary outage must not re-deliver an already completed job.
        try { await refreshSummary(); }
        catch (error) { if (!canceled) onError(error instanceof Error ? error.message : String(error)); }
        return;
      }
      const active = selectActiveReleaseJob(payload.jobs);
      if (!active) {
        if (jobId && deadline > now()) { onActivity(null); later(3_000); return; }
        const summary = await refreshSummary();
        if (canceled) return;
        onActivity(null);
        if (summary?.release.recommendedAction.kind !== "watch-release" || deadline <= now()) onStop();
        else later(4_000);
        return;
      }
      onActivity(payload);
      const progress = buildSiteAdminReleaseProgress({ job: active, jobs: payload.jobs, runners: payload.runners.agents, now: now() });
      later(active.status === "queued" && progress.runnerState === "offline" ? 10_000 : 3_000);
    } catch (error) {
      if (canceled) return;
      onError(error instanceof Error ? error.message : String(error));
      later(5_000);
    }
  };
  void poll();
  return () => { canceled = true; if (timer !== undefined) unschedule(timer); };
}

export function useSiteAdminReleaseMonitor(options: {
  releaseRunning: boolean;
  readJobs: () => Promise<ReleaseJobsPayload>;
  refreshSummary: () => Promise<{ release: { recommendedAction: { kind: string } } } | null>;
  onFinished: (outcome: FinishedOutcome, coveredRevision: number) => void;
  onError: (message: string) => void;
  onActivity: () => void;
}) {
  const [activity, setActivity] = useState<ReleaseJobsPayload | null>(null);
  const [watch, setWatch] = useState({ jobId: "", deadline: 0, coveredRevision: 0 });
  const callbacks = useRef(options);
  useEffect(() => { callbacks.current = options; });
  const running = options.releaseRunning || Boolean(activity && selectActiveReleaseJob(activity.jobs));
  useEffect(() => {
    if (!watch.jobId && !running && watch.deadline <= Date.now()) return;
    return startReleaseMonitor({
      jobId: watch.jobId, deadline: watch.deadline,
      readJobs: () => callbacks.current.readJobs(),
      refreshSummary: () => callbacks.current.refreshSummary(),
      onActivity: (payload) => { setActivity(payload); if (payload) callbacks.current.onActivity(); },
      onFinished: (outcome) => { setWatch({ jobId: "", deadline: 0, coveredRevision: 0 }); callbacks.current.onFinished(outcome, watch.coveredRevision); },
      onStop: () => setWatch({ jobId: "", deadline: 0, coveredRevision: 0 }),
      onError: (error) => callbacks.current.onError(error),
    });
  }, [running, watch]);
  function watchRelease(jobId: string, coveredRevision: number) {
    setActivity(null);
    setWatch({ jobId, coveredRevision, deadline: Date.now() + 15 * 60 * 1000 });
  }
  return { releaseActivity: activity, watchRelease };
}
