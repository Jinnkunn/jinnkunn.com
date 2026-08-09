import { fetchSearchResults } from "@/lib/client/search/api";
import { groupCountsFromMeta } from "@/lib/client/search/behavior-helpers";
import {
  renderEmpty,
  renderLoader,
  renderResults,
  SEARCH_EMPTY_ERROR_TITLE,
  SEARCH_EMPTY_IDLE_TITLE,
  SEARCH_RETRY_ACTION_ID,
} from "@/lib/client/search/overlay";
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
    renderEmpty(deps.list, { title: SEARCH_EMPTY_IDLE_TITLE });
    state.currentItems = [];
    state.collapsedGroups.clear();
    state.activeIndex = -1;
    deps.setFooterHint("idle");
    return;
  }

  state.aborter?.abort();
  const aborter = new AbortController();
  state.aborter = aborter;
  state.currentItems = [];
  state.collapsedGroups.clear();
  renderLoader(deps.list);
  state.activeIndex = -1;

  // A superseded request must not paint over a newer one. The next keystroke *replaces*
  // `state.aborter` after aborting it, so identity has to be compared as well as the signal.
  const isStale = () => aborter.signal.aborted || state.aborter !== aborter;

  void (async () => {
    let failed = false;
    const { items, meta } = await fetchSearchResults(
      query,
      {
        type: state.filterType,
        scope: state.scopeEnabled ? state.scopePrefix : "",
        offset: 0,
        limit: deps.pageLimit,
      },
      aborter.signal,
    ).catch(() => {
      failed = true;
      return { items: [], meta: null };
    });
    if (isStale()) return;

    if (failed) {
      // A dead network / 5xx used to be indistinguishable from a genuine empty result, i.e.
      // the overlay confidently claimed "No results" during an outage. Say what happened and
      // give the user a way back in.
      deps.applyMetaCounts(null);
      state.currentItems = [];
      state.activeIndex = -1;
      renderEmpty(deps.list, {
        title: SEARCH_EMPTY_ERROR_TITLE,
        actions: [{ id: SEARCH_RETRY_ACTION_ID, label: "Retry" }],
      });
      deps.setFooterHint("results");
      return;
    }

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
        // Best-effort probe for "are there matches outside this section?". A failure here is
        // deliberately *not* escalated to the error state: the primary request already
        // succeeded, so "No results" is the truthful answer — we just cannot offer the
        // cross-section shortcut on top of it.
        let probeFailed = false;
        const outOfScope = await fetchSearchResults(
          query,
          { type: state.filterType, scope: "", offset: 0, limit: 1 },
          aborter.signal,
        ).catch(() => {
          probeFailed = true;
          return { items: [], meta: null };
        });
        if (isStale()) return;
        if (!probeFailed && Number(outOfScope.meta?.total || 0) > 0) {
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
    if (id === SEARCH_RETRY_ACTION_ID) {
      // Re-run the query exactly as typed; the input is the single source of truth here.
      runSearchQuery(deps, deps.input.value);
      return;
    }
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
  const aborter = new AbortController();
  state.aborter = aborter;
  moreBtn.disabled = true;
  moreBtn.textContent = "Loading...";

  void (async () => {
    let failed = false;
    const { items: nextItems, meta } = await fetchSearchResults(
      state.currentQuery,
      {
        type: state.filterType,
        scope: state.scopeEnabled ? state.scopePrefix : "",
        offset: state.currentItems.length,
        limit: deps.pageLimit,
      },
      aborter.signal,
    ).catch(() => {
      failed = true;
      return { items: [], meta: null };
    });
    if (aborter.signal.aborted || state.aborter !== aborter) return;

    if (failed) {
      // Keep the page we already have *and* the affordance itself. Falling through would
      // apply a null meta, which silently drops the button and makes a failed page fetch
      // look like the end of the result list.
      moreBtn.disabled = false;
      moreBtn.textContent = "Retry";
      return;
    }

    deps.applyMetaCounts(meta);
    const seen = new Set(state.currentItems.map((x) => x.routePath));
    for (const it of nextItems) {
      if (!seen.has(it.routePath)) state.currentItems.push(it);
    }
    renderCurrentResults(deps);
  })();
}
