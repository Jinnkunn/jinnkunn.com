import "server-only";

import { Fragment, type ReactElement } from "react";

import nowContent from "@/content/now.json";

import { ClassicLink } from "@/components/classic/classic-link";

type NowLink = {
  label: string;
  href: string;
};

type NowUpdate = {
  id: string;
  text: string;
  at: string;
};

type NowFeedData = {
  current?: {
    text?: string;
    context?: string;
    location?: string;
    updatedAt?: string;
  };
  updates?: NowUpdate[];
  links?: NowLink[];
};

const DISPLAY_TIME_ZONE = "America/Halifax";

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeLink(value: unknown): NowLink | null {
  if (!isRecord(value)) return null;
  const label = asText(value.label);
  const href = asText(value.href);
  if (!label || !href) return null;
  return { label, href };
}

function normalizeUpdate(value: unknown): NowUpdate | null {
  if (!isRecord(value)) return null;
  const id = asText(value.id);
  const text = asText(value.text);
  const at = asText(value.at);
  if (!id || !text || !at) return null;
  return { id, text, at };
}

function normalizeNowFeedData(value: unknown): Required<NowFeedData> {
  const root = isRecord(value) ? value : {};
  const currentRaw = isRecord(root.current) ? root.current : {};
  return {
    current: {
      text: asText(currentRaw.text),
      context: asText(currentRaw.context),
      location: asText(currentRaw.location),
      updatedAt: asText(currentRaw.updatedAt),
    },
    updates: Array.isArray(root.updates)
      ? root.updates.map(normalizeUpdate).filter((item): item is NowUpdate => Boolean(item))
      : [],
    links: Array.isArray(root.links)
      ? root.links.map(normalizeLink).filter((item): item is NowLink => Boolean(item))
      : [],
  };
}

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

export function NowFeed(): ReactElement {
  const data = normalizeNowFeedData(nowContent);
  const currentText = data.current.text || "Working quietly.";
  const currentMeta = [
    data.current.location,
    data.current.updatedAt ? formatTimestamp(data.current.updatedAt) : "",
  ].filter(Boolean);

  return (
    <section className="now-feed" aria-label="Current status">
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

      {data.updates.length > 0 ? (
        <ol className="now-feed__updates" aria-label="Recent updates">
          {data.updates.map((item) => (
            <li className="now-feed__update" key={item.id}>
              <time className="now-feed__update-time" dateTime={item.at}>
                {formatTimestamp(item.at)}
              </time>
              <span className="now-feed__update-text">{item.text}</span>
            </li>
          ))}
        </ol>
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
