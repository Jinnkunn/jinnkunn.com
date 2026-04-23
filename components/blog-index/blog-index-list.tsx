"use client";

import { useId, useMemo, useState } from "react";

import type { BlogPostIndexItem } from "@/lib/blog";

import { BlogRow } from "./blog-row";

function yearKey(entry: BlogPostIndexItem): string {
  if (entry.dateIso) return entry.dateIso.slice(0, 4);
  if (entry.dateText) {
    const m = /\b(\d{4})\b/.exec(entry.dateText);
    if (m) return m[1];
  }
  return "Undated";
}

function yearOrder(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return nb - na;
  if (Number.isFinite(na)) return -1;
  if (Number.isFinite(nb)) return 1;
  return a.localeCompare(b);
}

function entryMatchesQuery(entry: BlogPostIndexItem, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  if (entry.title.toLowerCase().includes(needle)) return true;
  if ((entry.description ?? "").toLowerCase().includes(needle)) return true;
  if ((entry.dateText ?? "").toLowerCase().includes(needle)) return true;
  return false;
}

export function BlogIndexList({ entries }: { entries: BlogPostIndexItem[] }) {
  const [query, setQuery] = useState("");
  const searchId = useId();

  const filtered = useMemo(
    () => entries.filter((e) => entryMatchesQuery(e, query.trim())),
    [entries, query],
  );

  const groups = useMemo(() => {
    const map = new Map<string, BlogPostIndexItem[]>();
    for (const entry of filtered) {
      const key = yearKey(entry);
      const arr = map.get(key) ?? [];
      arr.push(entry);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort((a, b) => yearOrder(a[0], b[0]));
  }, [filtered]);

  const visible = filtered.length;
  const total = entries.length;

  return (
    <div className="blog-index">
      <div className="blog-index__toolbar" role="search">
        <label className="blog-index__search-label" htmlFor={searchId}>
          Search blog posts
        </label>
        <input
          id={searchId}
          type="search"
          className="blog-index__search-input"
          placeholder="Title, excerpt, or date…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <p className="blog-index__counts" aria-live="polite">
        {visible === total
          ? `${total} post${total === 1 ? "" : "s"}`
          : `${visible} of ${total} post${total === 1 ? "" : "s"}`}
      </p>

      {groups.length === 0 ? (
        <p className="blog-index__empty">No posts match your search.</p>
      ) : (
        groups.map(([year, items]) => (
          <section key={year} className="blog-index__group" aria-label={`Posts from ${year}`}>
            <h2 className="blog-index__year">{year}</h2>
            <ul className="blog-index__items">
              {items.map((entry) => (
                <li key={entry.slug}>
                  <BlogRow entry={entry} currentYear={year} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
