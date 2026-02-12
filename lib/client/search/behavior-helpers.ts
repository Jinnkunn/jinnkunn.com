import type { SearchMeta, SearchType } from "./types";
import type { SearchOverlayElements } from "./overlay";

const STORAGE_KEY = "notion-search-state:v1";

export function loadSearchState(): { filterType: SearchType; scopeEnabled: boolean } {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY) || "";
    if (!raw) return { filterType: "all", scopeEnabled: false };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const ft = String(parsed.filterType || "all") as SearchType;
    const scope = Boolean(parsed.scopeEnabled);
    const filterType =
      (["all", "pages", "blog", "databases"].includes(ft) ? ft : "all") as SearchType;
    return { filterType, scopeEnabled: scope };
  } catch {
    return { filterType: "all", scopeEnabled: false };
  }
}

export function saveSearchState(filterType: SearchType, scopeEnabled: boolean) {
  try {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ filterType, scopeEnabled }),
    );
  } catch {
    // ignore
  }
}

export function groupCountsFromMeta(meta: SearchMeta | null): Record<string, number> | undefined {
  const arr = meta?.groups;
  if (!arr || !Array.isArray(arr) || !arr.length) return undefined;
  const out: Record<string, number> = {};
  for (const g of arr) {
    if (!g?.label) continue;
    const n = Number(g.count);
    if (!Number.isFinite(n)) continue;
    out[g.label] = n;
  }
  return out;
}

export function computeScopeFromPathname(pathname: string): { prefix: string; label: string } {
  const p = String(pathname || "/");
  if (!p || p === "/" || p.startsWith("/site-admin")) return { prefix: "", label: "" };
  if (p === "/blog" || p.startsWith("/blog/")) return { prefix: "/blog", label: "Blog" };
  const seg = p.split("/").filter(Boolean)[0] || "";
  if (!seg) return { prefix: "", label: "" };
  const prefix = `/${seg}`;
  const label = seg.charAt(0).toUpperCase() + seg.slice(1);
  return { prefix, label };
}

export function setFilterPillState({
  elements,
  filterType,
  scopeEnabled,
  scopePrefix,
  scopeLabel,
}: {
  elements: Pick<
    SearchOverlayElements,
    "filterAll" | "filterPages" | "filterBlog" | "filterDatabases" | "scopeBtn"
  >;
  filterType: SearchType;
  scopeEnabled: boolean;
  scopePrefix: string;
  scopeLabel: string;
}) {
  const set = (btn: HTMLButtonElement, on: boolean) => {
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  };
  set(elements.filterAll, filterType === "all");
  set(elements.filterPages, filterType === "pages");
  set(elements.filterBlog, filterType === "blog");
  set(elements.filterDatabases, filterType === "databases");

  if (scopePrefix && scopeLabel) {
    elements.scopeBtn.classList.remove("is-hidden");
    elements.scopeBtn.textContent = scopeEnabled ? `In ${scopeLabel}` : `This section: ${scopeLabel}`;
    elements.scopeBtn.setAttribute("aria-pressed", scopeEnabled ? "true" : "false");
    elements.scopeBtn.classList.toggle("is-active", scopeEnabled);
  } else {
    elements.scopeBtn.classList.add("is-hidden");
    elements.scopeBtn.setAttribute("aria-pressed", "false");
    elements.scopeBtn.classList.remove("is-active");
  }
}

export function setClearButtonState(input: HTMLInputElement, clearBtn: HTMLButtonElement) {
  const has = Boolean(input.value.trim());
  clearBtn.classList.toggle("is-hidden", !has);
  clearBtn.setAttribute("aria-hidden", has ? "false" : "true");
  clearBtn.tabIndex = has ? 0 : -1;
}

export function getVisibleResultItems(list: HTMLElement): HTMLAnchorElement[] {
  return Array.from(list.querySelectorAll<HTMLAnchorElement>(".notion-search__result-item")).filter((el) => {
    const parent = el.closest<HTMLElement>(".notion-search__group-items");
    if (!parent) return true;
    return !parent.classList.contains("is-collapsed");
  });
}

export function setActiveResult(list: HTMLElement, idx: number): number {
  const items = getVisibleResultItems(list);
  if (!items.length) return -1;
  const next = Math.max(0, Math.min(idx, items.length - 1));
  for (let i = 0; i < items.length; i += 1) {
    const el = items[i]!;
    const on = i === next;
    el.classList.toggle("is-active", on);
    el.setAttribute("aria-selected", on ? "true" : "false");
  }
  items[next]!.scrollIntoView({ block: "nearest" });
  return next;
}

export function renderFooterHint(footer: HTMLElement, mode: "idle" | "results") {
  if (mode === "idle") {
    footer.innerHTML = `<div class="notion-search__result-footer-shortcut">Esc</div> to close`;
    return;
  }
  footer.innerHTML =
    `<div class="notion-search__result-footer-shortcut">Esc</div> close` +
    `<span class="notion-search__result-footer-dot">·</span>` +
    `<div class="notion-search__result-footer-shortcut">↑</div>` +
    `<div class="notion-search__result-footer-shortcut">↓</div> navigate` +
    `<span class="notion-search__result-footer-dot">·</span>` +
    `<div class="notion-search__result-footer-shortcut">↵</div> open`;
}
