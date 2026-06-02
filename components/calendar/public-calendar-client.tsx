"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  PublicCalendarView,
  type PublicCalendarAudienceMode,
  type PublicCalendarEventAnchor,
  type PublicCalendarViewMode,
} from "@/components/calendar/public-calendar-view";
import { isPublicCalendarDataStale } from "@/components/calendar/public-calendar-model";
import {
  PUBLIC_CALENDAR_SERVED_AT_HEADER,
  normalizePublicCalendarData,
  normalizePublicCalendarServedAt,
  selectPublicCalendarHydrationData,
  type PublicCalendarData,
} from "@/lib/shared/public-calendar";
import {
  DEFAULT_CALENDAR_TIME_ZONE,
  normalizeCalendarTimeZone,
  zonedStartOfDay,
} from "@/lib/shared/calendar-timezone";

// Tag filter persists in the URL search param `tag` (`?tag=foo&tag=bar`)
// so a shareable link can deep-link to "/calendar filtered by talks".
// Reading the initial state from the URL once at mount is enough — the
// useEffect that listens to popstate handles back/forward.
const TAG_QUERY_KEY = "tag";
const SCOPE_QUERY_KEY = "scope";
const TIME_ZONE_QUERY_KEY = "tz";
const TIME_ZONE_STORAGE_KEY = "public-calendar.timeZone.v1";

function readTagsFromLocation(): string[] {
  if (typeof window === "undefined") return [];
  const params = new URLSearchParams(window.location.search);
  return params.getAll(TAG_QUERY_KEY).filter((t) => t.length > 0);
}

function writeTagsToLocation(tags: readonly string[]): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  params.delete(TAG_QUERY_KEY);
  for (const tag of tags) {
    if (tag) params.append(TAG_QUERY_KEY, tag);
  }
  const next = params.toString();
  const target =
    window.location.pathname + (next ? `?${next}` : "") + window.location.hash;
  window.history.replaceState(null, "", target);
}

function readAudienceFromLocation(): PublicCalendarAudienceMode {
  if (typeof window === "undefined") return "featured";
  const params = new URLSearchParams(window.location.search);
  return params.get(SCOPE_QUERY_KEY) === "all" ? "all" : "featured";
}

function writeAudienceToLocation(audience: PublicCalendarAudienceMode): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (audience === "all") params.set(SCOPE_QUERY_KEY, "all");
  else params.delete(SCOPE_QUERY_KEY);
  const next = params.toString();
  const target =
    window.location.pathname + (next ? `?${next}` : "") + window.location.hash;
  window.history.replaceState(null, "", target);
}

function readTimeZoneFromLocation(): string {
  if (typeof window === "undefined") return DEFAULT_CALENDAR_TIME_ZONE;
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get(TIME_ZONE_QUERY_KEY);
  if (fromQuery) return normalizeCalendarTimeZone(fromQuery);
  try {
    return normalizeCalendarTimeZone(
      window.localStorage.getItem(TIME_ZONE_STORAGE_KEY) ??
        DEFAULT_CALENDAR_TIME_ZONE,
    );
  } catch {
    return DEFAULT_CALENDAR_TIME_ZONE;
  }
}

function writeTimeZoneToLocation(timeZone: string): void {
  if (typeof window === "undefined") return;
  const normalized = normalizeCalendarTimeZone(timeZone);
  try {
    window.localStorage.setItem(TIME_ZONE_STORAGE_KEY, normalized);
  } catch {
    // URL persistence still works when localStorage is unavailable.
  }
  const params = new URLSearchParams(window.location.search);
  if (normalized === DEFAULT_CALENDAR_TIME_ZONE) {
    params.delete(TIME_ZONE_QUERY_KEY);
  } else {
    params.set(TIME_ZONE_QUERY_KEY, normalized);
  }
  const next = params.toString();
  const target =
    window.location.pathname + (next ? `?${next}` : "") + window.location.hash;
  window.history.replaceState(null, "", target);
}

function readResponseTimestampIso(response: Response): string {
  return normalizePublicCalendarServedAt(
    response.headers.get(PUBLIC_CALENDAR_SERVED_AT_HEADER) ??
      response.headers.get("date"),
  );
}

type SyncStatus = "idle" | "syncing" | "ok" | "stale" | "failed";

const SYNC_STATUS_LABEL: Record<SyncStatus, string> = {
  idle: "",
  syncing: "Syncing…",
  ok: "Loaded",
  stale: "Calendar stale",
  failed: "Could not refresh",
};

type SelectedCalendarEvent = {
  id: string;
  anchor: PublicCalendarEventAnchor | null;
};

export function PublicCalendarClient({
  initialData,
}: {
  initialData: PublicCalendarData;
}) {
  const [data, setData] = useState<PublicCalendarData>(initialData);
  const [view, setView] = useState<PublicCalendarViewMode>(() =>
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 720px)").matches
      ? "agenda"
      : "month",
  );
  const [currentDateIso, setCurrentDateIso] = useState<string | null>(null);
  const [anchorIso, setAnchorIso] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] =
    useState<SelectedCalendarEvent | null>(null);
  const [agendaDays, setAgendaDays] = useState<30 | 90>(30);
  const [audience, setAudience] = useState<PublicCalendarAudienceMode>(() =>
    readAudienceFromLocation(),
  );
  const [timeZone, setTimeZone] = useState<string>(() =>
    readTimeZoneFromLocation(),
  );
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  // Hydrate tag filter from URL. The lazy initializer reads location
  // synchronously on first render so we don't need a pre-paint effect
  // that would then cascade into another render cycle (which the
  // existing react-hooks/no-set-state-in-effect lint forbids). The
  // popstate listener still lives in an effect — it only writes new
  // state when the user navigates back/forward, not on every render.
  const [selectedTags, setSelectedTags] = useState<readonly string[]>(() =>
    readTagsFromLocation(),
  );
  const expandedEventId = selectedEvent?.id ?? null;
  useEffect(() => {
    const onPopState = () => {
      setSelectedTags(readTagsFromLocation());
      setAudience(readAudienceFromLocation());
      setTimeZone(readTimeZoneFromLocation());
      setSelectedEvent(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const handleSelectedTagsChange = useCallback((next: string[]) => {
    // Round-trip the selection through replaceState so a deep-link
    // share captures the filtered view + a refresh preserves it.
    writeTagsToLocation(next);
    setSelectedTags(next);
    setSelectedEvent(null);
  }, []);
  const handleAudienceChange = useCallback((next: PublicCalendarAudienceMode) => {
    writeAudienceToLocation(next);
    setAudience(next);
    setSelectedEvent(null);
  }, []);
  const handleTimeZoneChange = useCallback((next: string) => {
    const normalized = normalizeCalendarTimeZone(next);
    writeTimeZoneToLocation(normalized);
    setTimeZone(normalized);
    setSelectedEvent(null);
  }, []);
  const handleViewChange = useCallback((next: PublicCalendarViewMode) => {
    setView(next);
    setSelectedEvent(null);
  }, []);
  const handleAnchorChange = useCallback((date: Date) => {
    setAnchorIso(date.toISOString());
    setSelectedEvent(null);
  }, []);
  const handleEventToggle = useCallback(
    (id: string, anchor: PublicCalendarEventAnchor | null = null) => {
      setSelectedEvent((current) =>
        current?.id === id ? null : { id, anchor },
      );
    },
    [],
  );

  useEffect(() => {
    if (!selectedEvent) return;
    const close = () => setSelectedEvent(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, { passive: true });
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectedEvent]);

  const automaticAnchorIso = useMemo(
    () =>
      currentDateIso
        ? zonedStartOfDay(new Date(currentDateIso), timeZone).toISOString()
        : null,
    [currentDateIso, timeZone],
  );

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      if (!cancelled) setSyncStatus("syncing");
      try {
        const res = await fetch("/api/public/calendar", {
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        const servedAtIso = readResponseTimestampIso(res);
        if (!res.ok) {
          if (!cancelled) {
            setCurrentDateIso(servedAtIso);
            setSyncStatus("failed");
          }
          return;
        }
        const next = normalizePublicCalendarData(await res.json());
        if (cancelled) return;
        setData((current) =>
          selectPublicCalendarHydrationData({
            currentData: current,
            refreshedData: next,
          }),
        );
        setCurrentDateIso(servedAtIso);
        setSyncStatus(
          isPublicCalendarDataStale(next.generatedAt, new Date(servedAtIso))
            ? "stale"
            : "ok",
        );
        setLastSyncedAt(servedAtIso);
      } catch {
        // Keep the static fallback visible if the dynamic endpoint is unavailable.
        if (!cancelled) {
          setCurrentDateIso(normalizePublicCalendarServedAt(null));
          setSyncStatus("failed");
        }
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
        anchorIso={anchorIso ?? automaticAnchorIso ?? initialData.generatedAt}
        currentDateIso={currentDateIso}
        agendaDays={agendaDays}
        audience={audience}
        timeZone={timeZone}
        selectedTags={selectedTags}
        onSelectedTagsChange={handleSelectedTagsChange}
        onAudienceChange={handleAudienceChange}
        onViewChange={handleViewChange}
        onAnchorChange={handleAnchorChange}
        onAgendaDaysChange={setAgendaDays}
        onTimeZoneChange={handleTimeZoneChange}
        expandedEventId={expandedEventId}
        selectedEventAnchor={selectedEvent?.anchor ?? null}
        onEventToggle={handleEventToggle}
        onDaySelect={(date) => {
          setAnchorIso(date.toISOString());
          setView("day");
          setSelectedEvent(null);
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
          {syncStatus === "stale"
            ? ` · ${new Date(data.generatedAt).toLocaleDateString("en", {
                month: "short",
                day: "numeric",
              })}`
            : null}
        </p>
      ) : null}
    </div>
  );
}
