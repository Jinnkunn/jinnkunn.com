"use client";

import { useEffect, useState } from "react";

import {
  PublicCalendarView,
  type PublicCalendarViewMode,
} from "@/components/calendar/public-calendar-view";
import {
  normalizePublicCalendarData,
  type PublicCalendarData,
} from "@/lib/shared/public-calendar";

type SyncStatus = "idle" | "syncing" | "ok" | "failed";

const SYNC_STATUS_LABEL: Record<SyncStatus, string> = {
  idle: "",
  syncing: "Syncing…",
  ok: "Up to date",
  failed: "Could not refresh",
};

export function PublicCalendarClient({
  initialData,
}: {
  initialData: PublicCalendarData;
}) {
  const [data, setData] = useState<PublicCalendarData>(initialData);
  const [view, setView] = useState<PublicCalendarViewMode>("month");
  const [anchorIso, setAnchorIso] = useState(() => new Date().toISOString());
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [agendaDays, setAgendaDays] = useState<30 | 90>(30);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      if (!cancelled) setSyncStatus("syncing");
      try {
        const res = await fetch("/api/public/calendar", {
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        if (!res.ok) {
          if (!cancelled) setSyncStatus("failed");
          return;
        }
        const next = normalizePublicCalendarData(await res.json());
        if (cancelled) return;
        setData(next);
        setSyncStatus("ok");
        setLastSyncedAt(new Date().toISOString());
      } catch {
        // Keep the static fallback visible if the dynamic endpoint is unavailable.
        if (!cancelled) setSyncStatus("failed");
      }
    }

    void refresh();
    const id = window.setInterval(refresh, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <div className="public-calendar__shell">
      <PublicCalendarView
        data={data}
        view={view}
        anchorIso={anchorIso}
        agendaDays={agendaDays}
        onViewChange={setView}
        onAnchorChange={(date) => setAnchorIso(date.toISOString())}
        onAgendaDaysChange={setAgendaDays}
        expandedEventId={expandedEventId}
        onEventToggle={(id) =>
          setExpandedEventId((current) => (current === id ? null : id))
        }
        onDaySelect={(date) => {
          setAnchorIso(date.toISOString());
          setView("day");
        }}
      />
      {syncStatus !== "idle" ? (
        <p
          className="public-calendar__sync-status"
          data-status={syncStatus}
          role="status"
          aria-live="polite"
        >
          <span className="public-calendar__sync-status-dot" aria-hidden="true" />
          {SYNC_STATUS_LABEL[syncStatus]}
          {syncStatus === "ok" && lastSyncedAt
            ? ` · ${new Date(lastSyncedAt).toLocaleTimeString("en", {
                hour: "numeric",
                minute: "2-digit",
              })}`
            : null}
        </p>
      ) : null}
    </div>
  );
}
