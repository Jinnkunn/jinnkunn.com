"use client";

import { useId, useMemo, useState } from "react";

import type { PublicationStructuredEntry } from "@/lib/seo/publications-items";

import { PublicationCard, classifyLabel, type LabelKind } from "./publication-card";

type TypeFilter = "all" | LabelKind;

const TYPE_OPTIONS: Array<{ value: TypeFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "conference", label: "Conference" },
  { value: "journal", label: "Journal" },
  { value: "arxiv", label: "arXiv" },
  { value: "workshop", label: "Workshop" },
];

function orderYearKey(year: string): number {
  const m = /\d{4}/.exec(year);
  return m ? Number(m[0]) : -1;
}

function entryMatches(
  entry: PublicationStructuredEntry,
  type: TypeFilter,
  query: string,
): boolean {
  if (type !== "all") {
    const kinds = new Set((entry.labels ?? []).map(classifyLabel));
    if (!kinds.has(type)) return false;
  }
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (entry.title.toLowerCase().includes(q)) return true;
  if ((entry.authors ?? []).some((a) => a.toLowerCase().includes(q))) return true;
  if ((entry.venues ?? []).some((v) => v.text.toLowerCase().includes(q))) return true;
  if ((entry.venue ?? "").toLowerCase().includes(q)) return true;
  return false;
}

export function PublicationList({ entries }: { entries: PublicationStructuredEntry[] }) {
  const [type, setType] = useState<TypeFilter>("all");
  const [query, setQuery] = useState("");
  const searchId = useId();

  const availableKinds = useMemo(() => {
    const set = new Set<LabelKind>();
    for (const e of entries) {
      for (const label of e.labels ?? []) set.add(classifyLabel(label));
    }
    return set;
  }, [entries]);

  const filtered = useMemo(
    () => entries.filter((e) => entryMatches(e, type, query)),
    [entries, type, query],
  );

  const groups = useMemo(() => {
    const map = new Map<string, PublicationStructuredEntry[]>();
    for (const entry of filtered) {
      const year = entry.year || "Unknown";
      const arr = map.get(year) ?? [];
      arr.push(entry);
      map.set(year, arr);
    }
    return Array.from(map.entries()).sort(
      (a, b) => orderYearKey(b[0]) - orderYearKey(a[0]),
    );
  }, [filtered]);

  const total = entries.length;
  const visible = filtered.length;

  return (
    <div className="pub-list" data-total={total}>
      <div className="pub-list__toolbar" role="search">
        <div className="pub-list__search">
          <label className="pub-list__search-label" htmlFor={searchId}>
            Search publications
          </label>
          <input
            id={searchId}
            type="search"
            className="pub-list__search-input"
            placeholder="Title, author, or venue…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="pub-list__filters" role="tablist" aria-label="Filter by type">
          {TYPE_OPTIONS.map((option) => {
            if (option.value !== "all" && !availableKinds.has(option.value)) return null;
            const active = type === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={active}
                className={active ? "pub-list__filter is-active" : "pub-list__filter"}
                onClick={() => setType(option.value)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <p className="pub-list__counts" aria-live="polite">
        {visible === total
          ? `${total} publication${total === 1 ? "" : "s"}`
          : `${visible} of ${total} publication${total === 1 ? "" : "s"}`}
      </p>

      {groups.length === 0 ? (
        <p className="pub-list__empty">No publications match your filters.</p>
      ) : (
        groups.map(([year, items]) => (
          <section key={year} className="pub-list__group" aria-label={`Publications from ${year}`}>
            <h2 className="pub-list__year">{year}</h2>
            <ul className="pub-list__items">
              {items.map((entry, index) => (
                <li key={`${year}-${index}-${entry.title}`}>
                  <PublicationCard entry={entry} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
