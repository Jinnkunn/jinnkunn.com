"use client";

import type { SiteAdminReleaseProgress } from "@/lib/site-admin/release-progress";

import styles from "./site-admin-dashboard.module.css";

function formatDuration(value: number | null | undefined) {
  const milliseconds = Math.max(0, Number(value || 0));
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function formatClock(value: number) {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Halifax",
  }).format(new Date(value));
}

function etaLabel(progress: SiteAdminReleaseProgress) {
  const { eta } = progress;
  if (eta.overdue) return "Longer than the recent completion window";
  if (eta.earliestAt && eta.latestAt) {
    const earliest = formatClock(eta.earliestAt);
    const latest = formatClock(eta.latestAt);
    const window = earliest === latest ? `around ${latest}` : `${earliest}–${latest}`;
    return eta.source === "history"
      ? `Expected ${window} · ${eta.sampleSize} recent run${eta.sampleSize === 1 ? "" : "s"}`
      : `First-run estimate · ${window}`;
  }
  if (eta.typicalMinMs && eta.typicalMaxMs) {
    return `ETA unavailable · typically ${formatDuration(eta.typicalMinMs)}–${formatDuration(
      eta.typicalMaxMs,
    )} once started`;
  }
  return "ETA unavailable until the runner starts";
}

export function SiteAdminPublishingProgress({
  progress,
  compact = false,
}: {
  progress: SiteAdminReleaseProgress;
  compact?: boolean;
}) {
  const percent = progress.percent;
  const progressValueProps =
    percent === null
      ? {}
      : {
          "aria-valuenow": percent,
        };
  return (
    <div
      className={styles.publishingProgress}
      data-compact={compact ? "true" : "false"}
      data-runner={progress.runnerState}
      aria-busy={progress.stage === "complete" ? "false" : "true"}
    >
      <div className={styles.publishingProgressHeader}>
        <div role="status" aria-live="polite" aria-atomic="true">
          <strong>{progress.label}</strong>
          <span>{etaLabel(progress)}</span>
        </div>
        <small>{formatDuration(progress.elapsedMs)} elapsed</small>
      </div>
      <div
        className={styles.publishingProgressTrack}
        data-indeterminate={progress.indeterminate ? "true" : "false"}
        role="progressbar"
        aria-label="Publishing progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${progress.label}, step ${progress.step} of ${progress.stepCount}`}
        {...progressValueProps}
      >
        <span
          className={styles.publishingProgressValue}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      <div className={styles.publishingProgressMeta}>
        <span>{progress.detail}</span>
        <span>
          Step {progress.step} of {progress.stepCount}
        </span>
      </div>
    </div>
  );
}
