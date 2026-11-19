"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import {
  PublicCalendarView,
  isBottomSheetPlacement,
  type PublicCalendarAudienceMode,
  type PublicCalendarEventAnchor,
  type PublicCalendarViewMode,
} from "@/components/calendar/public-calendar-view";
import {
  PUBLIC_CALENDAR_SERVED_AT_HEADER,
  normalizePublicCalendarRuntimeData,
  normalizePublicCalendarServedAt,
  publicCalendarFreshness,
  selectPublicCalendarHydrationData,
  type PublicCalendarData,
} from "@jinnkunn/calendar-core/public";
import {
  DEFAULT_CALENDAR_TIME_ZONE,
  normalizeCalendarTimeZone,
} from "@jinnkunn/calendar-core/timezone";

// Tag filter persists in the URL search param `tag` (`?tag=foo&tag=bar`)
// so a shareable link can deep-link to "/calendar filtered by talks".
// Reading the initial state from the URL once at mount is enough — the
// useEffect that listens to popstate handles back/forward.
const TAG_QUERY_KEY = "tag";
const SCOPE_QUERY_KEY = "scope";
const TIME_ZONE_QUERY_KEY = "tz";
const TIME_ZONE_STORAGE_KEY = "public-calendar.timeZone.v1";
const serverPreferences = {
  view: "month" as PublicCalendarViewMode,
  audience: "all" as PublicCalendarAudienceMode,
  timeZone: DEFAULT_CALENDAR_TIME_ZONE,
  selectedTags: [] as readonly string[],
};

const subscribeToHydration = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

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
  if (typeof window === "undefined") return "all";
  const params = new URLSearchParams(window.location.search);
  return params.get(SCOPE_QUERY_KEY) === "featured" ? "featured" : "all";
}

function writeAudienceToLocation(audience: PublicCalendarAudienceMode): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (audience === "featured") params.set(SCOPE_QUERY_KEY, "featured");
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

type SelectedCalendarEvent = {
  id: string;
  anchor: PublicCalendarEventAnchor | null;
};

export function PublicCalendarClient({
  initialData,
}: {
  initialData: PublicCalendarData;
}) {
  // The prerendered shell has no current date. Use the browser clock until
  // the first server timestamp arrives, not the age of the bundled events.
  const hydrated = useSyncExternalStore(subscribeToHydration, clientSnapshot, serverSnapshot);
  const preferences = useMemo(() => hydrated ? {
    view: window.matchMedia("(max-width: 720px)").matches ? "agenda" as const : "month" as const,
    audience: readAudienceFromLocation(),
    timeZone: readTimeZoneFromLocation(),
    selectedTags: readTagsFromLocation(),
  } : serverPreferences, [hydrated]);
  const [data, setData] = useState<PublicCalendarData>(initialData);
  const [viewChoice, setView] = useState<PublicCalendarViewMode | null>(null);
  const [currentDateIso, setCurrentDateIso] = useState(() => new Date().toISOString());
  const [freshnessCheckedAt, setFreshnessCheckedAt] = useState<number | null>(null);
  const [anchorIso, setAnchorIso] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] =
    useState<SelectedCalendarEvent | null>(null);
  const [agendaDays, setAgendaDays] = useState<30 | 90>(30);
  const [audienceChoice, setAudience] = useState<PublicCalendarAudienceMode | null>(null);
  const [timeZoneChoice, setTimeZone] = useState<string | null>(null);
  const [tagChoice, setSelectedTags] = useState<readonly string[] | null>(null);
  const view = viewChoice ?? preferences.view;
  const audience = audienceChoice ?? preferences.audience;
  const timeZone = timeZoneChoice ?? preferences.timeZone;
  const selectedTags = tagChoice ?? preferences.selectedTags;
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
    // The desktop popover is positioned from a viewport rect captured once,
    // at click time, so any scroll detaches it from the event it points at
    // and it has to close. Under 720px the same panel is a bottom sheet
    // pinned to left/bottom (calendar.css) with no tether to the anchor —
    // there a stray scroll would just swallow the tap and up to 74dvh of
    // content, so leave it open.
    const closesOnScroll = !isBottomSheetPlacement(selectedEvent.anchor);
    // iOS fires `resize` when the address bar collapses mid-scroll, which
    // would dismiss the sheet through the back door. Only a width change can
    // invalidate the captured rect, so ignore height-only resizes.
    let lastWidth = window.innerWidth;
    const closeOnWidthChange = () => {
      if (window.innerWidth === lastWidth) return;
      lastWidth = window.innerWidth;
      close();
    };
    window.addEventListener("resize", closeOnWidthChange);
    if (closesOnScroll) {
      window.addEventListener("scroll", close, { passive: true });
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("resize", closeOnWidthChange);
      window.removeEventListener("scroll", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectedEvent]);

  useEffect(() => {
    let cancelled = false;
    let pending: AbortController | null = null;
    let lastAttempt = 0;

    async function refresh() {
      if (document.hidden || pending) return;
      lastAttempt = Date.now();
      const controller = new AbortController();
      pending = controller;
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      try {
        const res = await fetch("/api/public/calendar", {
          headers: { accept: "application/json" },
          cache: "no-store",
          signal: controller.signal,
        });
        const servedAtIso = readResponseTimestampIso(res);
        if (!res.ok) {
          if (!cancelled) {
            setCurrentDateIso(servedAtIso);
          }
          return;
        }
        const next = normalizePublicCalendarRuntimeData(await res.json());
        if (cancelled) return;
        setData((current) =>
          selectPublicCalendarHydrationData({
            currentData: current,
            refreshedData: next,
          }),
        );
        setCurrentDateIso(servedAtIso);
      } catch {
        // Keep the static fallback visible if the dynamic endpoint is unavailable.
        if (!cancelled) {
          setCurrentDateIso(normalizePublicCalendarServedAt(null));
        }
      } finally {
        window.clearTimeout(timeout);
        pending = null;
        if (!cancelled) setFreshnessCheckedAt(Date.now());
      }
    }

    void refresh();
    const refreshAfterResume = () => {
      if (Date.now() - lastAttempt >= 10_000) void refresh();
    };
    document.addEventListener("visibilitychange", refreshAfterResume);
    window.addEventListener("focus", refreshAfterResume);
    window.addEventListener("online", refresh);
    const id = window.setInterval(refresh, 60_000);
    return () => {
      cancelled = true;
      pending?.abort();
      document.removeEventListener("visibilitychange", refreshAfterResume);
      window.removeEventListener("focus", refreshAfterResume);
      window.removeEventListener("online", refresh);
      window.clearInterval(id);
    };
  }, []);

  const verifiedAt = data.observationSnapshot?.verifiedAt;
  const freshness = freshnessCheckedAt === null ? "checking" : publicCalendarFreshness(verifiedAt, freshnessCheckedAt);
  if (!hydrated) {
    return <p className="public-calendar__loading" role="status">Loading calendar...</p>;
  }
  return (
    <div className="public-calendar__shell">
      {freshness === "stale" || freshness === "unverified" ? (
        <p className="public-calendar__freshness" role="status">
          Availability may be out of date. Unlisted times are not confirmed as free.
          {freshness === "stale" && verifiedAt ? <> Last verified <time dateTime={verifiedAt}>{new Intl.DateTimeFormat("en", {
            dateStyle: "medium", timeStyle: "short", timeZone,
          }).format(new Date(verifiedAt))}</time> ({timeZone}).</> : null}
        </p>
      ) : null}
      <PublicCalendarView
        data={data}
        loadingEvents={freshness === "checking"}
        view={view}
        anchorIso={anchorIso ?? undefined}
        currentDateIso={currentDateIso}
        agendaDays={agendaDays}
        audience={audience}
        timeZone={timeZone}
        selectedTags={selectedTags}
        onSelectedTagsChange={handleSelectedTagsChange}
        onAudienceChange={handleAudienceChange}
        onViewChange={handleViewChange}
        onAnchorChange={handleAnchorChange}
        onToday={() => {
          setAnchorIso(null);
          setSelectedEvent(null);
        }}
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
    </div>
  );
}
