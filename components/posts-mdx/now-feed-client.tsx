"use client";

import { Fragment, type ReactElement, useEffect, useState } from "react";

import { ClassicLink } from "@/components/classic/classic-link";
import type { SiteAdminNowData, SiteAdminNowUpdate } from "@/lib/site-admin/api-types";
import { normalizeNowData } from "@/lib/site-admin/now-normalize";

const DISPLAY_TIME_ZONE = "America/Halifax";
const RECENT_UPDATE_WINDOW_DAYS = 7;
const RECENT_UPDATE_LIMIT = 3;

type PublicNowResponse = {
  ok?: boolean;
  data?: unknown;
};

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(date);
}

function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

function recentHistoryUpdates(data: SiteAdminNowData): SiteAdminNowUpdate[] {
  const reference = data.current.updatedAt
    ? new Date(data.current.updatedAt).getTime()
    : Date.now();
  const cutoff = Number.isFinite(reference)
    ? reference - RECENT_UPDATE_WINDOW_DAYS * 24 * 60 * 60 * 1000
    : 0;
  return data.updates
    .filter((item) => {
      const timestamp = new Date(item.at).getTime();
      if (!Number.isFinite(timestamp) || timestamp < cutoff) return false;
      return item.at !== data.current.updatedAt || item.text !== data.current.text;
    })
    .slice(0, RECENT_UPDATE_LIMIT);
}

export function NowFeedClient({
  initialData,
}: {
  initialData: SiteAdminNowData;
}): ReactElement {
  const [data, setData] = useState(() => normalizeNowData(initialData));
  const currentText = data.current.text || "Working quietly.";
  const recentUpdates = recentHistoryUpdates(data);
  const currentMeta = [
    data.current.location,
    data.current.updatedAt ? formatTimestamp(data.current.updatedAt) : "",
  ].filter(Boolean);

  useEffect(() => {
    const controller = new AbortController();
    async function refreshNow(): Promise<void> {
      try {
        const response = await fetch("/api/public/now", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = (await response.json()) as PublicNowResponse;
        if (payload?.ok === false || payload?.data === undefined) return;
        setData(normalizeNowData(payload.data));
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
      }
    }
    void refreshNow();
    return () => controller.abort();
  }, []);

  return (
    <section className="now-feed" aria-label="Current status" aria-live="polite">
      <div className="now-feed__current">
        <span className="now-feed__presence-dot" aria-hidden="true" />
        <div className="now-feed__current-body">
          <p className="now-feed__current-text">{currentText}</p>
          {data.current.context ? (
            <p className="now-feed__current-context">{data.current.context}</p>
          ) : null}
          {currentMeta.length > 0 ? (
            <p className="now-feed__current-meta">{currentMeta.join(" · ")}</p>
          ) : null}
        </div>
      </div>

      {recentUpdates.length > 0 ? (
        <details className="now-feed__history">
          <summary>Recent trail</summary>
          <ol className="now-feed__updates" aria-label="Recent updates">
            {recentUpdates.map((item) => (
              <li className="now-feed__update" key={item.id}>
                <time className="now-feed__update-time" dateTime={item.at}>
                  {formatTimestamp(item.at)}
                </time>
                <span className="now-feed__update-text">{item.text}</span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      {data.links.length > 0 ? (
        <nav className="now-feed__links" aria-label="Related links">
          {data.links.map((item, index) => (
            <Fragment key={item.href}>
              {index > 0 ? (
                <span className="now-feed__link-separator" aria-hidden="true">
                  ·
                </span>
              ) : null}
              <ClassicLink
                className="notion-link link now-feed__link"
                href={item.href}
                {...(isExternalHref(item.href)
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
              >
                {item.label}
              </ClassicLink>
            </Fragment>
          ))}
        </nav>
      ) : null}
    </section>
  );
}
