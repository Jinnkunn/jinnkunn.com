import { fetchSearchResults } from "@/lib/client/search/api";
import { groupCountsFromMeta } from "@/lib/client/search/behavior-helpers";
import { renderEmpty, renderLoader, renderResults } from "@/lib/client/search/overlay";
import type { SearchType } from "@/lib/client/search/types";

import {
  parseEmptySwitchType,
  type SearchRootElement,
  type SearchRuntimeState,
} from "./behavior-runtime-types";

type SharedDeps = {
  state: SearchRuntimeState;
  rootEl: SearchRootElement;
  list: HTMLElement;
  input: HTMLInputElement;
  pageLimit: number;
  applyMetaCounts: (meta: SearchRuntimeState["lastMeta"]) => void;
  setFooterHint: (mode: "idle" | "results") => void;
  setActive: (idx: number) => void;
  syncPillState: () => void;
  persistState: () => void;
};

function renderCurrentResults(deps: SharedDeps): void {
  const { state } = deps;
  const showMore = Boolean(state.lastMeta?.hasMore);
  const remaining = state.lastMeta
    ? Math.max(0, state.lastMeta.filteredTotal - state.currentItems.length)
    : 0;
  renderResults(deps.list, state.currentItems, state.currentQuery, {
    collapsedGroups: state.collapsedGroups,
    showMore,
    remaining,
    groupCounts: groupCountsFromMeta(state.lastMeta),
  });
}

export function runSearchQuery(deps: SharedDeps, q: string): void {
  const { state } = deps;
  const query = q.trim();
  state.currentQuery = query;

  if (!query) {
    state.aborter?.abort();
    state.aborter = null;
    deps.applyMetaCounts(null);
    renderEmpty(deps.list);
    state.currentItems = [];
    state.collapsedGroups.clear();
    state.activeIndex = -1;
    deps.setFooterHint("idle");
    return;
  }

  state.aborter?.abort();
  state.aborter = new AbortController();
  state.currentItems = [];
  state.collapsedGroups.clear();
  renderLoader(deps.list);
  state.activeIndex = -1;

  void (async () => {
    const { items, meta } = await fetchSearchResults(
      query,
      {
        type: state.filterType,
        scope: state.scopeEnabled ? state.scopePrefix : "",
        offset: 0,
        limit: deps.pageLimit,
      },
      state.aborter!.signal,
    ).catch(() => ({ items: [], meta: null }));
    if (state.aborter?.signal.aborted) return;
    deps.applyMetaCounts(meta);
    state.currentItems = items;

    if (!state.currentItems.length) {
      const actions: Array<{ id: string; label: string; hint?: string }> = [];
      const counts = meta?.counts || null;

      if (state.filterType !== "all" && counts && Number(counts.all) > 0) {
        const candidates: Array<[SearchType, number]> = [
          ["pages", Number(counts.pages) || 0],
          ["blog", Number(counts.blog) || 0],
          ["databases", Number(counts.databases) || 0],
        ];
        candidates.sort((a, b) => b[1] - a[1]);
        const best = candidates.find(([, n]) => n > 0) || null;
        if (best) {
          const [t, n] = best;
          const label = t === "pages" ? "Show Pages" : t === "blog" ? "Show Blog" : "Show Databases";
          actions.push({
            id: "notion-search-empty-switch-type",
            label,
            hint: `(${n})`,
          });
          deps.rootEl.__emptySwitchType = t;
        } else {
          actions.push({
            id: "notion-search-empty-switch-all",
            label: "Show all types",
          });
        }
      }

      if (state.scopeEnabled && state.scopePrefix) {
        const outOfScope = await fetchSearchResults(
          query,
          { type: state.filterType, scope: "", offset: 0, limit: 1 },
          state.aborter!.signal,
        ).catch(() => ({ items: [], meta: null }));
        if (!state.aborter?.signal.aborted && Number(outOfScope.meta?.total || 0) > 0) {
          actions.push({
            id: "notion-search-empty-disable-scope",
            label: "Search all sections",
          });
        }
      }

      renderEmpty(deps.list, { actions });
      deps.setFooterHint("results");
      state.activeIndex = -1;
      return;
    }

    renderCurrentResults(deps);
    deps.setActive(0);
    deps.setFooterHint("results");
  })();
}

export function handleSearchResultsClick(deps: SharedDeps, e: MouseEvent): void {
  const t = e.target instanceof Element ? e.target : null;
  if (!t) return;
  const { state } = deps;

  const emptyAction = t.closest<HTMLButtonElement>("button.notion-search__empty-action");
  if (emptyAction) {
    e.preventDefault();
    const id = emptyAction.id;
    if (id === "notion-search-empty-disable-scope") {
      state.scopeEnabled = false;
      deps.persistState();
      deps.syncPillState();
      runSearchQuery(deps, deps.input.value);
      return;
    }
    if (id === "notion-search-empty-switch-all") {
      state.filterType = "all";
      deps.persistState();
      deps.syncPillState();
      runSearchQuery(deps, deps.input.value);
      return;
    }
    if (id === "notion-search-empty-switch-type") {
      const targetType = parseEmptySwitchType(deps.rootEl.__emptySwitchType);
      if (targetType) {
        state.filterType = targetType;
        deps.persistState();
        deps.syncPillState();
        runSearchQuery(deps, deps.input.value);
        return;
      }
    }
  }

  const groupBtn = t.closest<HTMLButtonElement>("button.notion-search__group");
  if (groupBtn) {
    e.preventDefault();
    const g = String(groupBtn.getAttribute("data-group") || "").trim();
    if (!g) return;
    if (state.collapsedGroups.has(g)) state.collapsedGroups.delete(g);
    else state.collapsedGroups.add(g);
    renderCurrentResults(deps);
    state.activeIndex = -1;
    return;
  }

  const moreBtn = t.closest<HTMLButtonElement>("#notion-search-more");
  if (!moreBtn) return;
  e.preventDefault();
  if (!state.open) return;
  if (!state.currentQuery.trim()) return;
  if (!state.lastMeta?.hasMore) return;

  state.aborter?.abort();
  state.aborter = new AbortController();
  moreBtn.disabled = true;
  moreBtn.textContent = "Loading...";

  void (async () => {
    const { items: nextItems, meta } = await fetchSearchResults(
      state.currentQuery,
      {
        type: state.filterType,
        scope: state.scopeEnabled ? state.scopePrefix : "",
        offset: state.currentItems.length,
        limit: deps.pageLimit,
      },
      state.aborter!.signal,
    ).catch(() => ({ items: [], meta: null }));
    if (state.aborter?.signal.aborted) return;
    deps.applyMetaCounts(meta);
    const seen = new Set(state.currentItems.map((x) => x.routePath));
    for (const it of nextItems) {
      if (!seen.has(it.routePath)) state.currentItems.push(it);
    }
    renderCurrentResults(deps);
  })();
}
