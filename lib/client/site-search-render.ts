import { escapeHtml, tokenizeQuery } from "@/lib/shared/text-utils";

export type SearchItem = {
  title: string;
  routePath: string;
  kind: string;
  snippet?: string;
  breadcrumb?: string;
};

type Range = { start: number; end: number };

function escapeAndHighlight(raw: string, terms: string[]): string {
  const s = String(raw || "");
  if (!s) return "";
  if (!terms.length) return escapeHtml(s);

  const hay = s.toLowerCase();
  const ranges: Range[] = [];

  for (const t of terms) {
    if (!t) continue;
    let from = 0;
    for (;;) {
      const i = hay.indexOf(t, from);
      if (i < 0) break;
      ranges.push({ start: i, end: i + t.length });
      from = i + Math.max(1, t.length);
      if (ranges.length > 60) break;
    }
    if (ranges.length > 60) break;
  }

  if (!ranges.length) return escapeHtml(s);

  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Range[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (!last || r.start > last.end) {
      merged.push({ start: r.start, end: r.end });
      continue;
    }
    last.end = Math.max(last.end, r.end);
  }

  let out = "";
  let cur = 0;
  for (const r of merged) {
    if (r.start > cur) out += escapeHtml(s.slice(cur, r.start));
    out += `<span class="notion-search__hl">${escapeHtml(s.slice(r.start, r.end))}</span>`;
    cur = r.end;
  }
  if (cur < s.length) out += escapeHtml(s.slice(cur));
  return out;
}

function groupLabelFor(it: SearchItem): string {
  const p = String(it.routePath || "/").trim() || "/";
  if (p === "/") return "Home";
  if (p === "/blog" || p.startsWith("/blog/")) return "Blog";
  const seg = p.split("/").filter(Boolean)[0] || "";
  if (!seg) return "Home";
  return seg.charAt(0).toUpperCase() + seg.slice(1);
}

export function renderSearchResultsHtml(
  items: SearchItem[],
  query: string,
  opts?: { collapsedGroups?: Set<string>; showMore?: boolean; remaining?: number },
): string {
  const terms = tokenizeQuery(query);
  const collapsed = opts?.collapsedGroups || new Set<string>();

  const groups = new Map<string, SearchItem[]>();
  const groupOrder: string[] = [];
  for (const it of items) {
    const g = groupLabelFor(it);
    if (!groups.has(g)) {
      groups.set(g, []);
      groupOrder.push(g);
    }
    groups.get(g)!.push(it);
  }

  const renderItem = (it: SearchItem, { last }: { last: boolean }) => {
    const titleHtml = escapeAndHighlight(it.title || "Untitled", terms);
    const route = escapeHtml(it.routePath || "/");
    const kind = escapeHtml(it.kind || "page");
    const snippetHtml = escapeAndHighlight(it.snippet || "", terms);
    const crumbRaw = String(it.breadcrumb || "").trim();
    const crumbHtml = crumbRaw ? escapeHtml(crumbRaw) : "";

    return `
      <div class="notion-search__result-item-wrapper${last ? " last" : ""}">
        <a class="notion-search__result-item ${kind}" href="${route}" role="option" aria-selected="false">
          <div class="notion-search__result-item-content">
            <div class="notion-search__result-item-title">
              <span class="notion-semantic-string">${titleHtml}</span>
            </div>
            ${
              snippetHtml
                ? `<div class="notion-search__result-item-text">${snippetHtml}</div><div class="notion-search__result-item-meta">${crumbHtml || route}</div>`
                : `<div class="notion-search__result-item-text">${crumbHtml || route}</div>`
            }
          </div>
          <div class="notion-search__result-item-enter-icon" aria-hidden="true">↵</div>
        </a>
      </div>
    `.trim();
  };

  const total = items.length;
  const out: string[] = [];
  let i = 0;
  for (const g of groupOrder) {
    const arr = groups.get(g) || [];
    if (!arr.length) continue;
    const isCollapsed = collapsed.has(g);
    out.push(
      `<button class="notion-search__group" type="button" data-group="${escapeHtml(
        g,
      )}" aria-expanded="${isCollapsed ? "false" : "true"}">` +
        `<span class="notion-search__group-caret" aria-hidden="true">▾</span>` +
        `<span class="notion-search__group-title">${escapeHtml(g)}</span>` +
        `<span class="notion-search__group-count" aria-hidden="true">${arr.length}</span>` +
      `</button>`,
    );
    out.push(
      `<div class="notion-search__group-items${isCollapsed ? " is-collapsed" : ""}" data-group-items="${escapeHtml(
        g,
      )}">`,
    );
    for (const it of arr) {
      i += 1;
      out.push(renderItem(it, { last: i === total }));
    }
    out.push(`</div>`);
  }

  if (opts?.showMore) {
    const remaining = Math.max(0, Number(opts.remaining || 0));
    out.push(
      `<div class="notion-search__more">` +
        `<button class="notion-search__more-btn" id="notion-search-more" type="button">Show more${remaining ? ` (${remaining})` : ""}</button>` +
      `</div>`,
    );
  }

  return out.join("");
}
