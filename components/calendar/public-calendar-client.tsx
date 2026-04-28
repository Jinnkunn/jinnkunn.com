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

export function PublicCalendarClient({
  initialData,
}: {
  initialData: PublicCalendarData;
}) {
  const [data, setData] = useState<PublicCalendarData>(initialData);
  const [view, setView] = useState<PublicCalendarViewMode>("month");
  const [anchorIso, setAnchorIso] = useState(() => new Date().toISOString());

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const res = await fetch("/api/public/calendar", {
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        if (!res.ok) return;
        const next = normalizePublicCalendarData(await res.json());
        if (!cancelled) setData(next);
      } catch {
        // Keep the static fallback visible if the dynamic endpoint is unavailable.
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
    <PublicCalendarView
      data={data}
      view={view}
      anchorIso={anchorIso}
      onViewChange={setView}
      onAnchorChange={(date) => setAnchorIso(date.toISOString())}
    />
  );
}
