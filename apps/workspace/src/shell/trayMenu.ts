import type { OutboxStatus } from "../modules/site-admin/tauri";
import type { SidebarRecentItem } from "./recent";

/** A single item the JS side passes to the Rust `tray_set_menu` IPC.
 * `id == "-"` (or `label == "-"`) becomes a separator; `children` makes
 * the row a submenu. The id is what comes back through `menu://action`
 * when the user picks the row. Stay flat unless a feature really needs
 * nesting (recents is the only one today). */
export interface TrayMenuItem {
  id: string;
  label: string;
  enabled?: boolean;
  children?: TrayMenuItem[];
}

export interface TrayMenuPayload {
  items: TrayMenuItem[];
  /** Text rendered next to the icon in the macOS menubar. Used as a
   * status badge — empty string clears it. Keep tight: 1–3 visible
   * chars at most ("●", "(3)", "·"). */
  title: string | null;
  /** Hover tooltip; `null` keeps the prior value. */
  tooltip: string | null;
}

export interface ReleaseState {
  kind: "idle" | "running" | "watching";
  /** Free-form summary line ("promoting v1.4.2"); shown disabled at the
   * top of the menu when active. */
  info?: string;
}

export interface TodayDigest {
  /** Next event in the user's primary calendar, or null when none. */
  nextEvent: { title: string; startMs: number } | null;
  todayEventCount: number;
  todayTodoCount: number;
}

export interface TrayMenuInputs {
  windowVisible: boolean;
  syncPaused: boolean;
  outboxStatus: OutboxStatus;
  releaseState: ReleaseState;
  todayDigest: TodayDigest;
  autostartEnabled: boolean | null;
  recentItems: readonly SidebarRecentItem[];
  enabledSurfaceIds: ReadonlySet<string>;
}

/** Build the recents submenu — one row per recent item, prefixed with
 * the surface label so a "Foo" note and a "Foo" project don't collide
 * visually. Cap at 8 rows to keep the submenu scannable; the main
 * window's sidebar is the canonical place to browse the full list. */
function buildRecentsSubmenu(
  recentItems: readonly SidebarRecentItem[],
  enabledSurfaceIds: ReadonlySet<string>,
): TrayMenuItem | null {
  const visible = recentItems
    .filter((item) => enabledSurfaceIds.has(item.surfaceId))
    .slice(0, 8);
  if (visible.length === 0) return null;
  return {
    id: "tray:recents",
    label: "Recent",
    children: visible.map((item) => ({
      id: `tray:open-recent::${item.surfaceId}::${item.itemId}`,
      label: `${item.label}`,
    })),
  };
}

function formatTimeUntil(targetMs: number, nowMs: number): string {
  const deltaMin = Math.round((targetMs - nowMs) / 60_000);
  if (deltaMin < 0) return "now";
  if (deltaMin === 0) return "now";
  if (deltaMin < 60) return `in ${deltaMin}m`;
  const hours = Math.floor(deltaMin / 60);
  const mins = deltaMin % 60;
  return mins > 0 ? `in ${hours}h ${mins}m` : `in ${hours}h`;
}

function formatClock(ms: number): string {
  const date = new Date(ms);
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Pure function — same inputs always produce the same payload. The
 * wrapper hook diffs payloads to skip redundant IPC. */
export function computeTrayMenu(
  inputs: TrayMenuInputs,
  nowMs: number = Date.now(),
): TrayMenuPayload {
  const items: TrayMenuItem[] = [];

  // ── Status header (when something interesting is happening) ─────
  if (inputs.releaseState.kind !== "idle") {
    items.push({
      id: "tray:release-status",
      label: inputs.releaseState.info ?? "Production deploy in progress…",
      enabled: false,
    });
    items.push({
      id: "tray:open-deploy",
      label: "Open release panel",
    });
    items.push({ id: "-", label: "-" });
  }

  // ── Today digest (read-only summary) ─────────────────────────────
  const digestRows: TrayMenuItem[] = [];
  if (inputs.todayDigest.nextEvent) {
    const { title, startMs } = inputs.todayDigest.nextEvent;
    digestRows.push({
      id: "tray:today-next-event",
      label: `Next: ${title} · ${formatClock(startMs)} (${formatTimeUntil(startMs, nowMs)})`,
      enabled: false,
    });
  }
  if (
    inputs.todayDigest.todayEventCount > 0 ||
    inputs.todayDigest.todayTodoCount > 0
  ) {
    const parts: string[] = [];
    if (inputs.todayDigest.todayEventCount > 0) {
      parts.push(
        `${inputs.todayDigest.todayEventCount} event${inputs.todayDigest.todayEventCount === 1 ? "" : "s"}`,
      );
    }
    if (inputs.todayDigest.todayTodoCount > 0) {
      parts.push(
        `${inputs.todayDigest.todayTodoCount} todo${inputs.todayDigest.todayTodoCount === 1 ? "" : "s"} due`,
      );
    }
    digestRows.push({
      id: "tray:today-counts",
      label: `Today: ${parts.join(" · ")}`,
      enabled: false,
    });
  }
  if (digestRows.length > 0) {
    items.push(...digestRows);
    items.push({ id: "-", label: "-" });
  }

  // ── Window toggle ────────────────────────────────────────────────
  items.push({
    id: inputs.windowVisible ? "tray:hide-window" : "tray:show-window",
    label: inputs.windowVisible ? "Hide Workspace" : "Open Workspace",
  });

  // ── Quick capture ────────────────────────────────────────────────
  items.push({ id: "tray:quick-capture-todo", label: "New todo…" });

  // ── Recents submenu (only when there's something to show) ───────
  const recents = buildRecentsSubmenu(inputs.recentItems, inputs.enabledSurfaceIds);
  if (recents) items.push(recents);

  items.push({ id: "-", label: "-" });

  // ── Outbox status (only when non-empty) ─────────────────────────
  if (inputs.outboxStatus.pending > 0 || inputs.outboxStatus.failing > 0) {
    const pieces: string[] = [];
    if (inputs.outboxStatus.pending > 0) {
      pieces.push(
        `${inputs.outboxStatus.pending} pending change${inputs.outboxStatus.pending === 1 ? "" : "s"}`,
      );
    }
    if (inputs.outboxStatus.failing > 0) {
      pieces.push(
        `${inputs.outboxStatus.failing} failing`,
      );
    }
    items.push({
      id: "tray:outbox-status",
      label: pieces.join(" · "),
      enabled: false,
    });
    items.push({ id: "tray:outbox-retry", label: "Retry now" });
    items.push({ id: "-", label: "-" });
  }

  // ── Toggles ──────────────────────────────────────────────────────
  items.push({
    id: inputs.syncPaused ? "tray:resume-sync" : "tray:pause-sync",
    label: inputs.syncPaused
      ? "Resume calendar sync"
      : "Pause calendar sync",
  });
  if (inputs.autostartEnabled !== null) {
    items.push({
      id: "tray:toggle-autostart",
      label: inputs.autostartEnabled ? "Disable launch at login" : "Launch at login",
    });
  }
  items.push({ id: "tray:check-updates", label: "Check for updates…" });

  items.push({ id: "-", label: "-" });
  items.push({ id: "tray:quit", label: "Quit Jinnkunn Workspace" });

  // ── Title (badge) ───────────────────────────────────────────────
  // Compact single-glyph signal that's readable at the menubar's tiny
  // size. Priority: deploy in progress > error > queued writes > idle.
  let title: string | null = null;
  if (inputs.releaseState.kind === "running") {
    title = "↑";
  } else if (inputs.releaseState.kind === "watching") {
    title = "·";
  } else if (inputs.outboxStatus.failing > 0) {
    title = "!";
  } else if (inputs.outboxStatus.pending > 0) {
    title = `(${inputs.outboxStatus.pending})`;
  }

  // ── Tooltip ─────────────────────────────────────────────────────
  let tooltip = "Jinnkunn Workspace";
  if (inputs.releaseState.info) {
    tooltip = inputs.releaseState.info;
  } else if (inputs.outboxStatus.pending > 0) {
    tooltip = `${inputs.outboxStatus.pending} change${inputs.outboxStatus.pending === 1 ? "" : "s"} queued`;
  }

  return { items, title, tooltip };
}
