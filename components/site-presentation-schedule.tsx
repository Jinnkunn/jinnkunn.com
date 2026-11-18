"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { SiteAnnouncementFrame, type AnnouncementFrameData } from "./site-announcement-frame";
import { announcementVisibleOnRoute } from "@/lib/shared/announcements";
import { getActiveMonochromeAppearance, type MonochromeAppearance } from "@/lib/appearance";
import { nextPresentationBoundary } from "@/lib/shared/presentation-time";

const MAX_DELAY = 2_147_000_000;
type SchedulePayload = { announcement: AnnouncementFrameData | null; refreshAt: number | null; compact?: string; expanded?: string };

export function ScheduledSiteAnnouncement({ initial, refreshAt, children }: {
  initial: AnnouncementFrameData | null;
  refreshAt: number;
  children: ReactNode;
}) {
  const [payload, setPayload] = useState<SchedulePayload>();
  const pathname = usePathname() || "/";
  useEffect(() => {
    const request = new AbortController();
    let deadline: number | null = refreshAt;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let loading = false;
    async function tick() {
      clearTimeout(timer);
      if (loading || deadline === null || request.signal.aborted) return;
      const delay = deadline - Date.now();
      if (delay > 0) { timer = setTimeout(tick, Math.min(delay, MAX_DELAY)); return; }
      loading = true;
      setPayload({ announcement: null, refreshAt: null });
      try {
        const response = await fetch("/api/site-announcement", { cache: "no-store", signal: request.signal });
        if (!response.ok) throw new Error("Announcement refresh failed.");
        const data = await response.json() as SchedulePayload;
        if (request.signal.aborted) return;
        setPayload(data);
        deadline = data.refreshAt === null ? null : Math.max(data.refreshAt, Date.now() + 1_000);
      } catch {
        // A failed request must not leave an expired banner visible.
        deadline = Date.now() + 30_000;
      } finally {
        loading = false;
        if (!request.signal.aborted) void tick();
      }
    }
    void tick();
    window.addEventListener("pageshow", tick);
    document.addEventListener("visibilitychange", tick);
    return () => { request.abort(); clearTimeout(timer); window.removeEventListener("pageshow", tick); document.removeEventListener("visibilitychange", tick); };
  }, [refreshAt]);
  const announcement = payload ? payload.announcement : initial;
  const visible = announcement && announcementVisibleOnRoute(announcement, pathname);
  useEffect(() => {
    const root = document.querySelector(".super-root");
    if (visible) root?.setAttribute("data-announcement-active", "true");
    else root?.removeAttribute("data-announcement-active");
  }, [visible]);
  if (!visible || !announcement) return null;
  if (!payload) return children;
  return <SiteAnnouncementFrame key={announcement.id} announcement={announcement}
    compactContent={<div className="site-announcement__markup" dangerouslySetInnerHTML={{ __html: payload.compact || "" }} />}>
      <div className="site-announcement__markup" dangerouslySetInnerHTML={{ __html: payload.expanded || "" }} />
    </SiteAnnouncementFrame>;
}

export function MonochromeSchedule({ config }: { config: MonochromeAppearance }) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function update() {
      clearTimeout(timer);
      const now = new Date();
      const active = getActiveMonochromeAppearance(config, now);
      const root = document.querySelector(".super-root");
      for (const [key, value] of [["mode", active ? "true" : ""], ["scope", active?.scope || ""], ["media", active?.desaturateMedia ? "true" : ""]]) {
        if (value) root?.setAttribute(`data-monochrome-${key}`, value);
        else root?.removeAttribute(`data-monochrome-${key}`);
      }
      const next = config.enabled ? nextPresentationBoundary([config], now.getTime()) : null;
      if (next !== null) timer = setTimeout(update, Math.min(next - now.getTime(), MAX_DELAY));
    }
    update();
    window.addEventListener("pageshow", update);
    document.addEventListener("visibilitychange", update);
    return () => { clearTimeout(timer); window.removeEventListener("pageshow", update); document.removeEventListener("visibilitychange", update); };
  }, [config]);
  return null;
}
