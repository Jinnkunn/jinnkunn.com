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

function LockIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2Z" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function normalizeRoutePath(p: string): string {
  const raw = String(p || "").trim();
  if (!raw) return "";
  let out = raw.startsWith("/") ? raw : `/${raw}`;
  out = out.replace(/\/+$/g, "");
  return out || "/";
}

function buildTree(
  items: RouteManifestItem[],
): {
  ordered: Array<RouteManifestItem & { depth: number; hasChildren: boolean }>;
  parentById: Map<string, string>; // id -> effective parent id
  childrenById: Map<string, string[]>; // id -> child ids
} {
  const byId = new Map<string, RouteManifestItem>();
  for (const it of items) byId.set(it.id, it);

  // Defensive parent resolution:
  // - Prefer Notion parentId when present and resolvable.
  // - Otherwise derive parent from the longest routePath prefix in the set.
  const byRoute = new Map<string, RouteManifestItem>();
  for (const it of items) byRoute.set(it.routePath, it);

  const parentById = new Map<string, string>(); // id -> effective parentId
  for (const it of items) {
    const pid = it.parentId || "";
    if (pid && byId.has(pid)) {
      parentById.set(it.id, pid);
      continue;
    }
    const p = normalizeRoutePath(it.routePath);
    if (p === "/") {
      parentById.set(it.id, "");
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
    parentById.set(it.id, parent?.id || "");
  }

  const kids = new Map<string, string[]>(); // parentId -> childIds
  for (const it of items) {
    const pid = parentById.get(it.id) || "";
    const arr = kids.get(pid) || [];
    arr.push(it.id);
    kids.set(pid, arr);
  }

  const sortChildIds = (parentId: string, childIds: string[]) => {
    childIds.sort((a, b) => {
      const aa = byId.get(a);
      const bb = byId.get(b);
      return String(aa?.routePath || "").localeCompare(String(bb?.routePath || ""));
    });
    kids.set(parentId, childIds);
    return childIds;
  };

  // Deterministic roots: use effective parent mapping, then sort by route path.
  const roots = items
    .filter((it) => !(parentById.get(it.id) || ""))
    .slice()
    .sort((a, b) => a.routePath.localeCompare(b.routePath));

  // Deterministic children ordering.
  for (const [pid, childIds] of kids.entries()) sortChildIds(pid, childIds);

  const ordered: Array<RouteManifestItem & { depth: number; hasChildren: boolean }> = [];
  const seen = new Set<string>();

  const dfs = (node: RouteManifestItem, depth: number) => {
    if (!node?.id || seen.has(node.id)) return;
    seen.add(node.id);
    ordered.push({
      ...node,
      depth,
      hasChildren: (kids.get(node.id) || []).length > 0,
    });
    const childIds = kids.get(node.id) || [];
    for (const cid of childIds) {
      const c = byId.get(cid);
      if (c) dfs(c, depth + 1);
    }
  };

  for (const r of roots) dfs(r, 0);
  // Include any remaining nodes (defensive: broken parent pointers).
  for (const it of items) if (!seen.has(it.id)) dfs(it, 0);

  return { ordered, parentById, childrenById: kids };
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

  const tree = useMemo(() => buildTree(items), [items]);
  const ordered = tree.ordered;

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

  const descendantsOf = useMemo(() => {
    const memo = new Map<string, string[]>();
    const kids = tree.childrenById;

    const walk = (id: string): string[] => {
      if (memo.has(id)) return memo.get(id)!;
      const out: string[] = [];
      const childIds = kids.get(id) || [];
      for (const cid of childIds) {
        out.push(cid);
        out.push(...walk(cid));
      }
      memo.set(id, out);
      return out;
    };

    return walk;
  }, [tree.childrenById]);

  const visible = useMemo(() => {
    // When searching, don't hide nodes via collapse (users need to see matches).
    const query = normalizeQuery(q);
    if (query) return filtered;

    const collapsedSet = new Set(
      Object.entries(collapsed)
        .filter(([, v]) => v)
        .map(([k]) => k),
    );

    const isHiddenByCollapsedAncestor = (id: string): boolean => {
      let pid = tree.parentById.get(id) || "";
      let guard = 0;
      while (pid && guard++ < 200) {
        if (collapsedSet.has(pid)) return true;
        pid = tree.parentById.get(pid) || "";
      }
      return false;
    };

    return filtered.filter((it) => !isHiddenByCollapsedAncestor(it.id));
  }, [filtered, collapsed, q, tree.parentById]);

  const toggleCollapsed = (id: string) => {
    setCollapsed((prev) => {
      const next = { ...prev };
      const currentlyCollapsed = Boolean(prev[id]);
      if (currentlyCollapsed) {
        // Expand: only expand this node (leave descendants collapsed).
        delete next[id];
        return next;
      }

      // Collapse: collapse this node AND its subtree so re-expanding doesn't
      // unexpectedly show deep levels (Super-like).
      next[id] = true;
      for (const d of descendantsOf(id)) next[d] = true;
      return next;
    });
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

  const findEffectiveProtection = (
    routePath: string,
  ): { sourcePath: string; mode: "exact" | "prefix" } | null => {
    const p = normalizeRoutePath(routePath);
    let best: { sourcePath: string; mode: "exact" | "prefix" } | null = null;
    for (const [k, v] of Object.entries(cfg.protectedByPath || {})) {
      const kp = normalizeRoutePath(k);
      if (!kp || kp === "/") continue;
      // Product decision: any protection applies to a subtree. Choose the most specific match.
      if (p === kp || p.startsWith(`${kp}/`)) {
        if (!best || kp.length > best.sourcePath.length) best = { sourcePath: kp, mode: v.mode };
      }
    }
    return best;
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
          const match = findEffectiveProtection(it.routePath);
          const directProtected = Boolean(cfg.protectedByPath[p]);
          const effectiveProtected = Boolean(match);
          const inheritedProtected = effectiveProtected && !directProtected;
          const protectedState = directProtected
            ? "direct"
            : inheritedProtected
              ? "inherited"
              : "0";
          const protectedSource = match?.sourcePath || "";

          return (
            <div
              key={it.id}
              className="routes-explorer__row"
              role="row"
              data-nav={it.navGroup ? "1" : "0"}
              data-overridden={it.overridden ? "1" : "0"}
              data-protected={protectedState}
              data-protected-source={protectedSource || ""}
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
                        <LockIcon className="routes-explorer__pill-icon" /> Password
                      </span>
                    ) : inheritedProtected ? (
                      <span
                        className="routes-explorer__pill routes-explorer__pill--protected routes-explorer__pill--protected-inherited"
                        title={
                          protectedSource
                            ? `Inherited from ${protectedSource}`
                            : "Inherited from a protected parent route"
                        }
                      >
                        <LockIcon className="routes-explorer__pill-icon" /> Password{" "}
                        <span className="routes-explorer__pill-suffix">inherited</span>
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
                        disabled={inheritedProtected}
                        placeholder={
                          inheritedProtected
                            ? protectedSource
                              ? `Inherited from ${protectedSource}`
                              : "Inherited from parent route"
                            : effectiveProtected
                              ? "Set new password (blank = disable)"
                              : "Set password (blank = disabled)"
                        }
                        onKeyDown={(e) => {
                          if (inheritedProtected) return;
                          if (e.key !== "Enter") return;
                          const pwd = (e.target as HTMLInputElement).value;
                          void saveProtection(it.routePath, "prefix", pwd);
                          (e.target as HTMLInputElement).value = "";
                        }}
                      />
                      <button
                        type="button"
                        className="routes-explorer__admin-btn"
                        disabled={busyId === it.routePath || inheritedProtected}
                        onClick={(e) => {
                          if (inheritedProtected) return;
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
                        disabled={busyId === it.routePath || inheritedProtected}
                        onClick={() => void saveProtection(it.routePath, "exact", "")}
                        title={
                          inheritedProtected
                            ? "Inherited protection must be managed on the parent route."
                            : "Disable password protection for this route"
                        }
                      >
                        Disable
                      </button>
                    </div>
                    {inheritedProtected ? (
                      <div className="routes-explorer__admin-note">
                        This route is protected by a parent rule{" "}
                        {protectedSource ? (
                          <>
                            (
                            <code className="routes-explorer__admin-note-code">
                              {protectedSource}
                            </code>
                            )
                          </>
                        ) : null}
                        . To change protection, edit that parent route.
                      </div>
                    ) : null}
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
