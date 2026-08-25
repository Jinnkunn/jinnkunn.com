import type { SiteAdminMobileReleaseActionKind } from "@/lib/site-admin/mobile-summary";

/**
 * Framework-free state rules for the Site Admin web console.
 *
 * The console is a single large client component, so the rules that decide
 * *which document a response may write into* and *which save may reach the
 * live site* used to be buried in async callbacks where they could not be
 * exercised. They live here so they can be tested directly.
 */

export type SelectionGate = {
  /** Claims the selection for a new document and returns the owning token. */
  open(): number;
  /** The token that currently owns the selection. */
  current(): number;
  /** True once another `open()` has superseded `token`. */
  isStale(token: number): boolean;
};

/**
 * A monotonic token guarding every `await` in the editor's load/save paths.
 * Switching documents mid-flight must not let the previous request's response
 * land in the newly opened document (or vice versa).
 */
export function createSelectionGate(): SelectionGate {
  let token = 0;
  return {
    open() {
      token += 1;
      return token;
    },
    current() {
      return token;
    },
    isStale(candidate: number) {
      return candidate !== token;
    },
  };
}

export type ContentSaveEffects = {
  /** PATCH the draft. Always true; the save is the point of the call. */
  persist: true;
  /** Queue a content publish job (reaches the live site). */
  publish: boolean;
  /** Re-read the pages/posts/components lists. */
  reconcileLists: boolean;
  /** Show a success notice. */
  announce: boolean;
};

/**
 * Autosave saves the draft and stops there. Publishing is an explicit action:
 * a 1.6s typing pause must never ship a half-written paragraph to production,
 * and a silent save that also woke the release runner had no way to say so.
 */
export function contentSaveEffects(
  options: { quiet?: boolean } = {},
): ContentSaveEffects {
  const quiet = options.quiet === true;
  return {
    persist: true,
    publish: !quiet,
    reconcileLists: !quiet,
    announce: !quiet,
  };
}

export type LiveSyncState = "live" | "pending" | "publishing" | "unknown";

export type ReleaseJobOutcome =
  | { state: "active"; message: "" }
  | { state: "succeeded"; message: "" }
  | { state: "failed" | "canceled"; message: string };

/**
 * A release that left the active queue still has to be surfaced to the
 * author. Treating every missing active job as "current" hid failed runner
 * jobs and made a completed progress animation look like a successful publish.
 */
export function releaseJobOutcome(job: {
  status?: unknown;
  error?: unknown;
}): ReleaseJobOutcome {
  const status = String(job.status || "").trim().toLowerCase();
  if (status === "succeeded") return { state: "succeeded", message: "" };
  if (status === "failed" || status === "canceled") {
    return {
      state: status,
      message:
        String(job.error || "").trim() ||
        (status === "canceled" ? "Publish was canceled." : "Publish failed."),
    };
  }
  return { state: "active", message: "" };
}

export type LiveSyncStatus = {
  state: LiveSyncState;
  label: string;
  pendingCount: number;
};

export type EditorialStatusState = "saving" | "attention" | "dirty" | "pending" | "live" | "unknown";

export type EditorialStatus = {
  state: EditorialStatusState;
  label: string;
  tone: "saving" | "blocked" | "smart-release" | "noop";
};

/**
 * One document gets one primary state. The console previously rendered draft,
 * visibility, and live badges with equal weight, so a healthy document could
 * read as "Saved / Public / Live current / Up to date" all at once. Visibility
 * remains a separate control; this status answers only "what should I do next?".
 */
export function editorialStatus(input: {
  saving: boolean;
  blocked: boolean;
  dirty: boolean;
  runnerOffline: boolean;
  liveSync: LiveSyncStatus;
}): EditorialStatus {
  if (input.saving) {
    return { state: "saving", label: "Saving", tone: "saving" };
  }
  if (input.blocked) {
    return { state: "attention", label: "Needs attention", tone: "blocked" };
  }
  if (input.dirty) {
    return { state: "dirty", label: "Unsaved changes", tone: "smart-release" };
  }
  if (input.runnerOffline) {
    return { state: "attention", label: "Runner offline", tone: "blocked" };
  }
  if (input.liveSync.state === "publishing") {
    return { state: "saving", label: "Publishing", tone: "saving" };
  }
  if (input.liveSync.state === "pending") {
    return { state: "pending", label: "Ready to publish", tone: "smart-release" };
  }
  if (input.liveSync.state === "live") {
    return { state: "live", label: "Live current", tone: "noop" };
  }
  return { state: "unknown", label: "Status unavailable", tone: "blocked" };
}

/**
 * The Draft -> Preview -> Live card has to admit that saved drafts are not
 * live. `pendingSaves` counts saves made since the last publish was queued,
 * because a quiet save deliberately does not refresh the release summary.
 */
export function liveSyncStatus(input: {
  releaseActionKind?: SiteAdminMobileReleaseActionKind;
  pendingSaves: number;
  releaseRunning: boolean;
}): LiveSyncStatus {
  const pendingCount = Math.max(0, Math.trunc(input.pendingSaves || 0));
  if (input.releaseRunning) {
    return { state: "publishing", label: "Publishing", pendingCount };
  }
  if (pendingCount > 0) {
    return {
      state: "pending",
      label: `Draft saved · ${pendingCount} change${
        pendingCount === 1 ? "" : "s"
      } not yet live`,
      pendingCount,
    };
  }
  if (input.releaseActionKind === "smart-release") {
    return { state: "pending", label: "Saved content is not yet live", pendingCount };
  }
  if (input.releaseActionKind === "noop") {
    return { state: "live", label: "Live current", pendingCount };
  }
  return { state: "unknown", label: "Publish status unavailable", pendingCount };
}

export type ListPlaceholder = "loading" | "empty" | "no-matches" | "ready";

/**
 * Before the first load resolves the lists are `null`, which is not the same
 * as empty. Telling an author "No posts yet · create the first item here"
 * while their posts are still in flight invites them to write a duplicate.
 */
export function contentListPlaceholder(input: {
  hasLoadedOnce: boolean;
  itemCount: number;
  searching: boolean;
}): ListPlaceholder {
  if (!input.hasLoadedOnce) return "loading";
  if (input.itemCount > 0) return "ready";
  return input.searching ? "no-matches" : "empty";
}

/**
 * `null` means "not loaded yet"; only a loaded payload may report a count.
 */
export function countLabel(count: number | null | undefined): string {
  return typeof count === "number" ? String(count) : "—";
}

export type VisibilityLabel = {
  /** Pill text, phrased as the current state rather than the negation. */
  label: string;
  /** Accessible name for the toggle, phrased as the resulting state. */
  actionLabel: string;
  state: "smart-release" | "noop";
};

/**
 * The draft flag is stored as "hidden", but authors think in terms of what is
 * visible. Both the pill and the checkbox read positively.
 */
export function visibilityLabel(draft: boolean): VisibilityLabel {
  return draft
    ? { label: "Hidden", actionLabel: "Show on the public site", state: "smart-release" }
    : { label: "Public", actionLabel: "Hide from the public site", state: "noop" };
}

/**
 * Settings live in their own hook, so the console could not see their draft
 * and let tab switches discard it without asking.
 */
export function settingsDraftDirty(
  baseline: Record<string, unknown> | null,
  draft: Record<string, unknown> | null,
): boolean {
  if (!baseline || !draft) return false;
  const keys = new Set([...Object.keys(baseline), ...Object.keys(draft)]);
  for (const key of keys) {
    if (String(baseline[key] ?? "") !== String(draft[key] ?? "")) return true;
  }
  return false;
}
