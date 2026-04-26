// Lightweight inline @mention picker. Used by EditableBlock to expand a
// literal "@" character in a text block into a markdown link to another
// page in the site. The picker reuses the admin pages list endpoint
// (/api/site-admin/pages) and caches the result for the duration of the
// browser session — admin docs don't churn fast enough to need a TTL.

import { useEffect, useRef, useState } from "react";

import { BlockPopover, type BlockPopoverAnchor } from "./block-popover";
import type { NormalizedApiResponse } from "./types";

type RequestFn = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<NormalizedApiResponse>;

export interface MentionTarget {
  slug: string;
  title: string;
}

let mentionCache: { entries: MentionTarget[]; loadedAt: number } | null = null;

async function loadMentionTargets(request: RequestFn): Promise<MentionTarget[]> {
  if (mentionCache) return mentionCache.entries;
  const response = await request("/api/site-admin/pages", "GET");
  if (!response.ok) return [];
  const raw = response.data;
  const items = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as Record<string, unknown> | null)?.items)
      ? ((raw as Record<string, unknown>).items as unknown[])
      : [];
  const entries: MentionTarget[] = [];
  for (const entry of items) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const slug = typeof obj.slug === "string" ? obj.slug : "";
    if (!slug) continue;
    const title = typeof obj.title === "string" ? obj.title : slug;
    entries.push({ slug, title });
  }
  mentionCache = { entries, loadedAt: Date.now() };
  return entries;
}

interface MentionPickerProps {
  anchor: BlockPopoverAnchor;
  initialQuery?: string;
  onClose: () => void;
  onPick: (target: MentionTarget) => void;
  request: RequestFn;
}

export function MentionPicker({
  anchor,
  initialQuery = "",
  onClose,
  onPick,
  request,
}: MentionPickerProps) {
  const [query, setQuery] = useState(initialQuery);
  const [targets, setTargets] = useState<MentionTarget[]>(
    mentionCache?.entries ?? [],
  );
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadMentionTargets(request).then((entries) => {
      if (!cancelled) setTargets(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [request]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  const filtered = query
    ? targets.filter(
        (t) =>
          t.slug.toLowerCase().includes(query.toLowerCase()) ||
          t.title.toLowerCase().includes(query.toLowerCase()),
      )
    : targets;
  const visible = filtered.slice(0, 8);

  return (
    <BlockPopover
      anchor={anchor}
      ariaLabel="Mention page"
      className="block-popover--mention"
      onClose={onClose}
      open={true}
      placement="bottom-start"
    >
      <div className="mention-picker">
        <input
          ref={inputRef}
          className="mention-picker__input"
          value={query}
          placeholder="Search pages…"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && visible[0]) {
              event.preventDefault();
              onPick(visible[0]);
            }
          }}
        />
        <div className="mention-picker__list">
          {visible.length === 0 ? (
            <span className="mention-picker__empty">No pages found.</span>
          ) : (
            visible.map((target) => (
              <button
                key={target.slug}
                type="button"
                className="mention-picker__item"
                onClick={() => onPick(target)}
              >
                <strong>{target.title}</strong>
                <span>/{target.slug}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </BlockPopover>
  );
}
