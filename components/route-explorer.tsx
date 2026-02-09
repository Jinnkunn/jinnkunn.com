"use client";

import { useEffect, useMemo, useState } from "react";

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

type AdminConfig = {
  overrides: Record<string, string>; // pageId -> routePath
  protectedByPath: Record<string, { mode: "exact" | "prefix" }>; // path -> mode
};

function normalizeRoutePath(p: string): string {
  const raw = String(p || "").trim();
  if (!raw) return "";
  let out = raw.startsWith("/") ? raw : `/${raw}`;
  out = out.replace(/\/+$/g, "");
  return out || "/";
}

function buildTreeOrder(
  items: RouteManifestItem[],
): Array<RouteManifestItem & { depth: number; hasChildren: boolean }> {
  const byId = new Map<string, RouteManifestItem>();
  for (const it of items) byId.set(it.id, it);

  // Defensive parent resolution:
  // - Prefer Notion parentId when present and resolvable.
  // - Otherwise derive parent from the longest routePath prefix in the set.
  const byRoute = new Map<string, RouteManifestItem>();
  for (const it of items) byRoute.set(it.routePath, it);

  const effectiveParentId = new Map<string, string>(); // id -> parentId
  for (const it of items) {
    const pid = it.parentId || "";
    if (pid && byId.has(pid)) {
      effectiveParentId.set(it.id, pid);
      continue;
    }
    const p = normalizeRoutePath(it.routePath);
    if (p === "/") {
      effectiveParentId.set(it.id, "");
      continue;
    }
    const segs = p.split("/").filter(Boolean);
    let parent: RouteManifestItem | null = null;
    for (let i = segs.length - 1; i >= 1; i--) {
      const prefix = `/${segs.slice(0, i).join("/")}`;
      const hit = byRoute.get(prefix) || null;
      if (hit) {
        parent = hit;
        break;
      }
    }
    effectiveParentId.set(it.id, parent?.id || "");
  }

  const kids = new Map<string, RouteManifestItem[]>();
  for (const it of items) {
    const pid = effectiveParentId.get(it.id) || "";
    const arr = kids.get(pid) || [];
    arr.push(it);
    kids.set(pid, arr);
  }

  const sortChildren = (arr: RouteManifestItem[]) => {
    // URL sort is predictable and matches the Super-like "path list" mental model.
    arr.sort((a, b) => a.routePath.localeCompare(b.routePath));
    return arr;
  };

  const roots = items.filter((it) => !(effectiveParentId.get(it.id) || ""));
  sortChildren(roots);

  const out: Array<RouteManifestItem & { depth: number; hasChildren: boolean }> = [];
  const seen = new Set<string>();

  const dfs = (node: RouteManifestItem, depth: number) => {
    if (!node?.id || seen.has(node.id)) return;
    seen.add(node.id);
    out.push({ ...node, depth, hasChildren: (kids.get(node.id) || []).length > 0 });
    const children = kids.get(node.id) || [];
    sortChildren(children);
    for (const c of children) dfs(c, depth + 1);
  };

  for (const r of roots) dfs(r, 0);
  // Include any remaining nodes (defensive: broken parent pointers).
  for (const it of items) if (!seen.has(it.id)) dfs(it, 0);
  return out;
}

export default function RouteExplorer({
  items,
}: {
  items: RouteManifestItem[];
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "nav" | "overrides">("all");
  const [cfg, setCfg] = useState<AdminConfig>({ overrides: {}, protectedByPath: {} });
  const [busyId, setBusyId] = useState<string>("");
  const [err, setErr] = useState<string>("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch("/api/site-admin/routes", { cache: "no-store" });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        const overrides: Record<string, string> = {};
        for (const it of data.overrides || []) {
          if (!it?.pageId || !it?.routePath) continue;
          overrides[String(it.pageId)] = String(it.routePath);
        }
        const protectedByPath: Record<string, { mode: "exact" | "prefix" }> = {};
        for (const it of data.protectedRoutes || []) {
          if (!it?.path || !it?.mode) continue;
          const p = normalizeRoutePath(String(it.path));
          if (!p) continue;
          protectedByPath[p] = { mode: it.mode === "prefix" ? "prefix" : "exact" };
        }
        if (!cancelled) setCfg({ overrides, protectedByPath });
      } catch (e: any) {
        if (!cancelled) setErr(String(e?.message || e));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const ordered = useMemo(() => buildTreeOrder(items), [items]);

  // Default: only show root + one level (Super-like). Deeper folders start collapsed.
  useEffect(() => {
    if (Object.keys(collapsed).length > 0) return;
    const next: Record<string, boolean> = {};
    for (const it of ordered) {
      if (it.hasChildren && it.depth >= 1) next[it.id] = true;
    }
    setCollapsed(next);
  }, [ordered, collapsed]);

  const filtered = useMemo(() => {
    const query = normalizeQuery(q);
    const out = ordered.filter((it) => {
      if (filter === "nav" && !it.navGroup) return false;
      if (filter === "overrides" && !it.overridden) return false;
      if (!query) return true;
      return (
        it.routePath.toLowerCase().includes(query) ||
        it.title.toLowerCase().includes(query) ||
        it.id.toLowerCase().includes(query)
      );
    });
    return out;
  }, [ordered, q, filter]);

  const visible = useMemo(() => {
    // When searching, don't hide nodes via collapse (users need to see matches).
    const query = normalizeQuery(q);
    if (query) return filtered;

    const collapsedSet = new Set<string>(
      Object.entries(collapsed)
        .filter(([, v]) => v)
        .map(([k]) => k)
    );
    const byId = new Map<string, RouteManifestItem>();
    for (const it of items) byId.set(it.id, it);

    const collapsedPrefixes: Array<string> = [];
    for (const it of items) {
      if (!collapsedSet.has(it.id)) continue;
      const p = normalizeRoutePath(it.routePath);
      if (p) collapsedPrefixes.push(p);
    }

    const isHidden = (node: RouteManifestItem) => {
      // Prefix fallback: even if parent pointers are missing, hide descendants of collapsed route paths.
      const rp = normalizeRoutePath(node.routePath);
      for (const cp of collapsedPrefixes) {
        if (cp === "/") continue;
        if (rp !== cp && (rp === cp || rp.startsWith(`${cp}/`))) return true;
      }

      let pid = node.parentId || "";
      while (pid) {
        if (collapsedSet.has(pid)) return true;
        const p = byId.get(pid);
        pid = p?.parentId || "";
      }
      return false;
    };

    return filtered.filter((it) => !isHidden(it));
  }, [filtered, collapsed, q, items]);

  const toggleCollapsed = (id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const collapseAll = () => {
    const next: Record<string, boolean> = {};
    for (const it of ordered) if (it.hasChildren) next[it.id] = true;
    setCollapsed(next);
  };

  const expandAll = () => setCollapsed({});

  const saveOverride = async (pageId: string, routePath: string) => {
    setBusyId(pageId);
    setErr("");
    try {
      const res = await fetch("/api/site-admin/routes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "override",
          pageId,
          routePath: routePath.trim(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);

      setCfg((prev) => {
        const next = { ...prev, overrides: { ...prev.overrides } };
        const normalized = normalizeRoutePath(routePath);
        if (!normalized) delete next.overrides[pageId];
        else next.overrides[pageId] = normalized;
        return next;
      });
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusyId("");
    }
  };

  const saveProtection = async (path: string, _mode: "exact" | "prefix", password: string) => {
    setBusyId(path);
    setErr("");
    try {
      // Product decision: protecting a page must protect its subtree (Super-like).
      const mode: "prefix" = "prefix";
      const res = await fetch("/api/site-admin/routes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "protected",
          path,
          mode,
          password: password.trim(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);

      setCfg((prev) => {
        const next = { ...prev, protectedByPath: { ...prev.protectedByPath } };
        const p = normalizeRoutePath(path);
        if (!password.trim()) delete next.protectedByPath[p];
        else next.protectedByPath[p] = { mode };
        return next;
      });
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusyId("");
    }
  };

  const isEffectivelyProtected = (routePath: string): boolean => {
    const p = normalizeRoutePath(routePath);
    for (const [k, v] of Object.entries(cfg.protectedByPath || {})) {
      const kp = normalizeRoutePath(k);
      if (!kp || kp === "/") continue;
      if (v?.mode === "prefix") {
        if (p === kp || p.startsWith(`${kp}/`)) return true;
      } else {
        if (p === kp) return true;
      }
    }
    return false;
  };

  return (
    <div className="routes-explorer">
      <div className="routes-explorer__header">
        <div className="routes-explorer__title">
          <h1 className="routes-explorer__h1">Routes</h1>
          <p className="routes-explorer__sub">
            Auto-generated from Notion on deploy. Edit overrides/protection here, then Deploy.
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

          <div className="routes-explorer__filter" role="group" aria-label="Route filters">
            {(
              [
                { id: "all", label: "All" },
                { id: "nav", label: "Nav" },
                { id: "overrides", label: "Overrides" },
              ] as const
            ).map((it) => (
              <button
                key={it.id}
                type="button"
                className={cn(
                  "routes-explorer__filter-btn",
                  filter === it.id ? "is-active" : "",
                )}
                onClick={() => setFilter(it.id)}
              >
                {it.label}
              </button>
            ))}
          </div>

          <div className="routes-explorer__filter" role="group" aria-label="Tree controls">
            <button
              type="button"
              className="routes-explorer__filter-btn"
              onClick={expandAll}
              disabled={Boolean(normalizeQuery(q))}
              title={normalizeQuery(q) ? "Clear search to use tree folding" : "Expand all"}
            >
              Expand
            </button>
            <button
              type="button"
              className="routes-explorer__filter-btn"
              onClick={collapseAll}
              disabled={Boolean(normalizeQuery(q))}
              title={normalizeQuery(q) ? "Clear search to use tree folding" : "Collapse all"}
            >
              Collapse
            </button>
          </div>
        </div>
      </div>

      {err ? <div className="routes-explorer__error">{err}</div> : null}

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
            Admin
          </div>
        </div>

        {visible.map((it) => {
          const p = normalizeRoutePath(it.routePath);
          const directProtected = Boolean(cfg.protectedByPath[p]);
          const effectiveProtected = isEffectivelyProtected(it.routePath);
          const inheritedProtected = effectiveProtected && !directProtected;
          const protectedState = directProtected
            ? "direct"
            : inheritedProtected
              ? "inherited"
              : "0";

          return (
            <div
              key={it.id}
              className="routes-explorer__row"
              role="row"
              data-nav={it.navGroup ? "1" : "0"}
              data-overridden={it.overridden ? "1" : "0"}
              data-protected={protectedState}
            >
              <div className="routes-explorer__cell routes-explorer__cell--title" role="cell">
                <div
                  className="routes-explorer__tree"
                  style={{ paddingLeft: Math.min(56, it.depth * 16) }}
                >
                  {it.hasChildren ? (
                    <button
                      type="button"
                      className="routes-explorer__expander"
                      data-open={collapsed[it.id] ? "false" : "true"}
                      aria-label={collapsed[it.id] ? "Expand" : "Collapse"}
                      onClick={() => toggleCollapsed(it.id)}
                      title={collapsed[it.id] ? "Expand" : "Collapse"}
                    >
                      <svg
                        className="routes-explorer__chev"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>
                  ) : (
                    <span style={{ width: 22, height: 22, flex: "0 0 auto" }} />
                  )}

                  <div className="routes-explorer__title-main">{it.title || "Untitled"}</div>
                </div>
                <div className="routes-explorer__id">
                  {it.id}{" "}
                  <button
                    type="button"
                    className="routes-explorer__copy"
                    onClick={() => copyToClipboard(it.id)}
                    aria-label={`Copy page id ${it.id}`}
                  >
                    Copy
                  </button>
                </div>
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
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
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
                    {directProtected ? (
                      <span className="routes-explorer__pill routes-explorer__pill--protected">
                        protected
                      </span>
                    ) : inheritedProtected ? (
                      <span
                        className="routes-explorer__pill routes-explorer__pill--protected routes-explorer__pill--protected-inherited"
                        title="Inherited from a protected parent route"
                      >
                        protected
                      </span>
                    ) : null}
                  </div>

                  <div className="routes-explorer__admin">
                    <div className="routes-explorer__admin-row">
                      <label className="routes-explorer__admin-label">Override URL</label>
                      <input
                        className="routes-explorer__admin-input"
                        key={`ov:${it.id}:${cfg.overrides[it.id] || ""}`}
                        defaultValue={cfg.overrides[it.id] || ""}
                        placeholder="e.g. /my-page (blank = auto)"
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          const v = (e.target as HTMLInputElement).value;
                          void saveOverride(it.id, v);
                        }}
                      />
                      <button
                        type="button"
                        className="routes-explorer__admin-btn"
                        disabled={busyId === it.id}
                        onClick={(e) => {
                          const input = (e.currentTarget.parentElement?.querySelector("input") ||
                            null) as HTMLInputElement | null;
                          void saveOverride(it.id, input?.value || "");
                        }}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="routes-explorer__admin-btn"
                        disabled={busyId === it.id}
                        onClick={(e) => {
                          const input = (e.currentTarget.parentElement?.querySelector("input") ||
                            null) as HTMLInputElement | null;
                          if (input) input.value = "";
                          void saveOverride(it.id, "");
                        }}
                      >
                        Clear
                      </button>
                    </div>

                    <div className="routes-explorer__admin-row">
                      <label className="routes-explorer__admin-label">Password</label>
                      <input
                        className="routes-explorer__admin-input"
                        type="password"
                        placeholder={
                          effectiveProtected
                            ? "Set new password (blank = disable)"
                            : "Set password (blank = disabled)"
                        }
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          const pwd = (e.target as HTMLInputElement).value;
                          void saveProtection(it.routePath, "prefix", pwd);
                          (e.target as HTMLInputElement).value = "";
                        }}
                      />
                      <button
                        type="button"
                        className="routes-explorer__admin-btn"
                        disabled={busyId === it.routePath}
                        onClick={(e) => {
                          const row = e.currentTarget.closest(
                            ".routes-explorer__admin-row",
                          ) as HTMLElement | null;
                          const input = row?.querySelector("input") as HTMLInputElement | null;
                          const pwd = input?.value || "";
                          void saveProtection(it.routePath, "prefix", pwd);
                          if (input) input.value = "";
                        }}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="routes-explorer__admin-btn"
                        disabled={busyId === it.routePath}
                        onClick={() => void saveProtection(it.routePath, "exact", "")}
                      >
                        Disable
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
