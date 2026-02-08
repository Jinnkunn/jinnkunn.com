"use client";

import { useMemo, useState } from "react";

import type { RouteManifestItem } from "@/lib/routes-manifest";

function normalizeQuery(q: string): string {
  return String(q || "").trim().toLowerCase();
}

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // ignore
  }
}

export default function RouteExplorer({
  items,
}: {
  items: RouteManifestItem[];
}) {
  const [q, setQ] = useState("");
  const [onlyNav, setOnlyNav] = useState(false);
  const [onlyOverridden, setOnlyOverridden] = useState(false);

  const filtered = useMemo(() => {
    const query = normalizeQuery(q);
    const out = items.filter((it) => {
      if (onlyNav && !it.navGroup) return false;
      if (onlyOverridden && !it.overridden) return false;
      if (!query) return true;
      return (
        it.routePath.toLowerCase().includes(query) ||
        it.title.toLowerCase().includes(query) ||
        it.id.toLowerCase().includes(query)
      );
    });

    // Stable, predictable ordering: routePath ASC.
    out.sort((a, b) => a.routePath.localeCompare(b.routePath));
    return out;
  }, [items, q, onlyNav, onlyOverridden]);

  return (
    <div className="routes-explorer">
      <div className="routes-explorer__header">
        <div className="routes-explorer__title">
          <h1 className="routes-explorer__h1">Routes</h1>
          <p className="routes-explorer__sub">
            Auto-generated from Notion on deploy.
          </p>
        </div>

        <div className="routes-explorer__controls">
          <label className="routes-explorer__search">
            <span className="sr-only">Search</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search title, route, page id..."
              className="routes-explorer__input"
              inputMode="search"
            />
          </label>

          <label className="routes-explorer__toggle">
            <input
              type="checkbox"
              checked={onlyNav}
              onChange={(e) => setOnlyNav(e.target.checked)}
            />
            <span>Nav only</span>
          </label>

          <label className="routes-explorer__toggle">
            <input
              type="checkbox"
              checked={onlyOverridden}
              onChange={(e) => setOnlyOverridden(e.target.checked)}
            />
            <span>Overrides</span>
          </label>
        </div>
      </div>

      <div className="routes-explorer__meta">
        <span className="routes-explorer__count">{filtered.length}</span>
        <span className="routes-explorer__count-label">routes</span>
      </div>

      <div className="routes-explorer__table" role="table" aria-label="Routes">
        <div className="routes-explorer__row routes-explorer__row--head" role="row">
          <div className="routes-explorer__cell routes-explorer__cell--title" role="columnheader">
            Title
          </div>
          <div className="routes-explorer__cell routes-explorer__cell--route" role="columnheader">
            URL
          </div>
          <div className="routes-explorer__cell routes-explorer__cell--kind" role="columnheader">
            Notes
          </div>
        </div>

        {filtered.map((it) => (
          <div
            key={it.id}
            className="routes-explorer__row"
            role="row"
            data-nav={it.navGroup ? "1" : "0"}
            data-overridden={it.overridden ? "1" : "0"}
          >
            <div className="routes-explorer__cell routes-explorer__cell--title" role="cell">
              <div className="routes-explorer__title-main">{it.title || "Untitled"}</div>
              <div className="routes-explorer__id">{it.id}</div>
            </div>
            <div className="routes-explorer__cell routes-explorer__cell--route" role="cell">
              <code className="routes-explorer__code">{it.routePath}</code>
              <button
                type="button"
                className="routes-explorer__copy"
                onClick={() => copyToClipboard(it.routePath)}
                aria-label={`Copy ${it.routePath}`}
              >
                Copy
              </button>
            </div>
            <div className="routes-explorer__cell routes-explorer__cell--kind" role="cell">
              <span
                className={cn(
                  "routes-explorer__pill",
                  it.navGroup ? "routes-explorer__pill--nav" : "",
                )}
              >
                {it.navGroup ? `nav:${it.navGroup}` : it.kind}
              </span>
              {it.overridden ? (
                <span className="routes-explorer__pill routes-explorer__pill--override">
                  overridden
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

