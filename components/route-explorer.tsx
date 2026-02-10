"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";

import type { RouteManifestItem } from "@/lib/routes-manifest";
import { compactId, normalizeRoutePath } from "@/lib/shared/route-utils.mjs";
import {
  type AdminConfig,
  buildDescendantsGetter,
  buildRouteTree,
  computeVisibleRoutes,
  createEffectiveAccessFinder,
  filterOrderedRoutes,
  getDefaultCollapsed,
  normalizeSearchQuery,
  parseAdminRoutesPayload,
} from "@/lib/site-admin/route-explorer-model";

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

function IconButton({
  children,
  className,
  label,
  onClick,
  disabled,
  href,
  title,
}: {
  children: ReactNode;
  className?: string;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  href?: string;
  title?: string;
}) {
  const cls = cn("routes-tree__icon-btn", className || "");
  if (href) {
    return (
      <a
        className={cls}
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label={label}
        title={title || label}
      >
        {children}
      </a>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title || label}
    >
      {children}
    </button>
  );
}

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

function RouteKindIcon({
  className,
  kind,
  hasChildren,
  isHome,
}: {
  className?: string;
  kind: string;
  hasChildren: boolean;
  isHome: boolean;
}) {
  if (isHome) {
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
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5 9.75V21h14V9.75" />
      </svg>
    );
  }

  if (kind === "database") {
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
        <path d="M4 6.5h16" />
        <path d="M4 10.5h16" />
        <path d="M4 14.5h16" />
        <path d="M4 18.5h16" />
        <path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Z" />
      </svg>
    );
  }

  if (hasChildren) {
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
        <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v9A2.5 2.5 0 0 1 18.5 21h-13A2.5 2.5 0 0 1 3 18.5v-11Z" />
      </svg>
    );
  }

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
      <path d="M7 3h7l3 3v15a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z" />
      <path d="M14 3v4a2 2 0 0 0 2 2h4" />
    </svg>
  );
}

export default function RouteExplorer({
  items,
}: {
  items: RouteManifestItem[];
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "nav" | "overrides">("all");
  const [cfg, setCfg] = useState<AdminConfig>({
    overrides: {},
    protectedByPageId: {},
    protectedByPath: {},
  });
  const [busyId, setBusyId] = useState<string>("");
  const [err, setErr] = useState<string>("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [openAdmin, setOpenAdmin] = useState<Record<string, boolean>>({});
  const [accessChoice, setAccessChoice] = useState<Record<string, "public" | "password" | "github">>(
    {},
  );

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch("/api/site-admin/routes", { cache: "no-store" });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        const parsed = parseAdminRoutesPayload(data, items);
        if (!cancelled) setCfg(parsed);
      } catch (e: any) {
        if (!cancelled) setErr(String(e?.message || e));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [items]);

  const tree = useMemo(() => buildRouteTree(items), [items]);
  const ordered = tree.ordered;

  // Default: only show root + one level (Super-like). Deeper folders start collapsed.
  useEffect(() => {
    if (Object.keys(collapsed).length > 0) return;
    setCollapsed(getDefaultCollapsed(ordered));
  }, [ordered, collapsed]);

  const filtered = useMemo(() => {
    return filterOrderedRoutes(ordered, q, filter);
  }, [ordered, q, filter]);

  const descendantsOf = useMemo(() => {
    return buildDescendantsGetter(tree.childrenById);
  }, [tree.childrenById]);

  const visible = useMemo(() => {
    return computeVisibleRoutes({
      filtered,
      collapsed,
      q,
      parentById: tree.parentById,
    });
  }, [filtered, collapsed, q, tree.parentById]);

  const toggleOpenAdmin = (id: string) =>
    setOpenAdmin((prev) => ({ ...prev, [id]: !prev[id] }));

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

  const saveAccess = async ({
    pageId,
    path,
    access,
    password,
  }: {
    pageId: string;
    path: string;
    access: "public" | "password" | "github";
    password?: string;
  }) => {
    setBusyId(pageId);
    setErr("");
    try {
      const res = await fetch("/api/site-admin/routes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "protected",
          pageId,
          path,
          auth: access,
          password: String(password || "").trim(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);

      setCfg((prev) => {
        const next: AdminConfig = {
          overrides: prev.overrides,
          protectedByPageId: { ...prev.protectedByPageId },
          protectedByPath: { ...prev.protectedByPath },
        };
        const pid = compactId(pageId);
        const p = normalizeRoutePath(path);

        // Public means remove any direct protection for this page.
        if (access === "public") {
          delete next.protectedByPageId[pid];
          if (p) delete next.protectedByPath[p];
          return next;
        }

        if (!pid) return next;
        const auth: "password" | "github" = access === "github" ? "github" : "password";
        next.protectedByPageId[pid] = { auth, mode: "prefix", path: p };
        if (p) delete next.protectedByPath[p];
        return next;
      });
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusyId("");
    }
  };

  const byId = useMemo(() => {
    const m = new Map<string, RouteManifestItem>();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);

  const findEffectiveAccess = useMemo(() => {
    return createEffectiveAccessFinder({ cfg, tree, items });
  }, [cfg, tree, items]);

  return (
    <div className="routes-explorer">
      <div className="routes-explorer__header">
        <div className="routes-explorer__title">
          <h1 className="routes-explorer__h1">Routes</h1>
          <p className="routes-explorer__sub">
            Auto-generated from your content source on deploy. Edit overrides/protection here, then Deploy.
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
              disabled={Boolean(normalizeSearchQuery(q))}
              title={
                normalizeSearchQuery(q) ? "Clear search to use tree folding" : "Expand all"
              }
            >
              Expand
            </button>
            <button
              type="button"
              className="routes-explorer__filter-btn"
              onClick={collapseAll}
              disabled={Boolean(normalizeSearchQuery(q))}
              title={
                normalizeSearchQuery(q) ? "Clear search to use tree folding" : "Collapse all"
              }
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

      <div className="routes-tree" role="list" aria-label="Routes">
        {visible.map((it) => {
          const p = normalizeRoutePath(it.routePath);
          const match = findEffectiveAccess(it.id, it.routePath);
          const directProtected = Boolean(cfg.protectedByPageId[compactId(it.id)]);
          const effectiveProtected = Boolean(match);
          const inheritedProtected = effectiveProtected && !directProtected;
          const protectedState = directProtected
            ? "direct"
            : inheritedProtected
              ? "inherited"
              : "0";
          const protectedSource = match?.sourcePath || "";
          const isHome = p === "/";
          const adminOpen = Boolean(openAdmin[it.id]);
          const overrideValue = cfg.overrides[it.id] || "";
          const overridePending =
            Boolean(overrideValue) && normalizeRoutePath(overrideValue) !== normalizeRoutePath(it.routePath);
          const indent = Math.min(56, it.depth * 16);
          const directAccess: "public" | "password" | "github" = directProtected
            ? cfg.protectedByPageId[compactId(it.id)]?.auth === "github"
              ? "github"
              : "password"
            : "public";
          const selectedAccess =
            accessChoice[it.id] ||
            (inheritedProtected
              ? match?.auth === "github"
                ? "github"
                : "password"
              : directAccess);

          return (
            <div
              key={it.id}
              className="routes-tree__row"
              role="listitem"
              data-nav={it.navGroup ? "1" : "0"}
              data-overridden={it.overridden ? "1" : "0"}
              data-protected={protectedState}
              data-protected-source={protectedSource || ""}
              data-depth={String(it.depth)}
              data-admin-open={adminOpen ? "1" : "0"}
              style={{ ["--indent" as any]: `${indent}px` }}
            >
              <div className="routes-tree__row-top">
                <div className="routes-tree__left">
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

                  <RouteKindIcon
                    className="routes-tree__kind-icon"
                    kind={it.kind}
                    hasChildren={it.hasChildren}
                    isHome={isHome}
                  />

                  <div className="routes-tree__text">
                    <div className="routes-tree__pathline">
                      <code className="routes-tree__path">{it.routePath}</code>
                      {isHome ? <span className="routes-tree__home">(home)</span> : null}
                    </div>
                    <div className="routes-tree__subline">
                      <span className="routes-tree__title">{it.title || "Untitled"}</span>
                      <span className="routes-tree__dot" aria-hidden="true">
                        ·
                      </span>
                      <span className="routes-tree__id">{it.id}</span>
                    </div>
                  </div>
                </div>
                <div className="routes-tree__right">
                  <div className="routes-tree__badges">
                    <span
                      className={cn(
                        "routes-explorer__pill",
                        it.navGroup ? "routes-explorer__pill--nav" : "",
                      )}
                    >
                      {it.navGroup ? `nav:${it.navGroup}` : it.kind}
                    </span>
                    {it.overridden || overridePending ? (
                      <span className="routes-explorer__pill routes-explorer__pill--override">
                        {overridePending ? "override (pending)" : "overridden"}
                      </span>
                    ) : null}
                    {directProtected ? (
                      <span className="routes-explorer__pill routes-explorer__pill--protected">
                        <LockIcon className="routes-explorer__pill-icon" />{" "}
                        {match?.auth === "github" ? "GitHub" : "Password"}
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
                        <LockIcon className="routes-explorer__pill-icon" />{" "}
                        {match?.auth === "github" ? "GitHub" : "Password"}{" "}
                        <span className="routes-explorer__pill-suffix">inherited</span>
                      </span>
                    ) : null}
                  </div>

                  <div className="routes-tree__actions">
                    <IconButton
                      href={it.routePath}
                      label={`Open ${it.routePath}`}
                      title="Open page"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" className="routes-tree__icon">
                        <path
                          d="M14 4h6v6"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M10 14 20 4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M20 14v6H4V4h6"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </IconButton>

                    <IconButton
                      label={`Copy URL ${it.routePath}`}
                      onClick={() => void copyToClipboard(it.routePath)}
                      title="Copy URL"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" className="routes-tree__icon">
                        <path
                          d="M8 8h10v12H8z"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </IconButton>

                    <IconButton
                      label={`Copy page id ${it.id}`}
                      onClick={() => void copyToClipboard(it.id)}
                      title="Copy page id"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" className="routes-tree__icon">
                        <path
                          d="M4 7.5A3.5 3.5 0 0 1 7.5 4h7A3.5 3.5 0 0 1 18 7.5v9A3.5 3.5 0 0 1 14.5 20h-7A3.5 3.5 0 0 1 4 16.5v-9Z"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M8 9h6"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                        <path
                          d="M8 13h6"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </IconButton>

                    <IconButton
                      label={adminOpen ? "Close settings" : "Open settings"}
                      onClick={() => toggleOpenAdmin(it.id)}
                      className={adminOpen ? "is-active" : ""}
                      title={adminOpen ? "Close settings" : "Settings"}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" className="routes-tree__icon">
                        <path
                          d="M12 15.4a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8Z"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M19.4 15a8.9 8.9 0 0 0 .1-1 8.9 8.9 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a8.2 8.2 0 0 0-1.7-1l-.4-2.6H11l-.4 2.6a8.2 8.2 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a8.9 8.9 0 0 0-.1 1 8.9 8.9 0 0 0 .1 1l-2 1.6 2 3.4 2.4-1a8.2 8.2 0 0 0 1.7 1l.4 2.6h4l.4-2.6a8.2 8.2 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6Z"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </IconButton>
                  </div>
                </div>
              </div>

              {adminOpen ? (
                <div className="routes-tree__panel">
                  <div className="routes-tree__panel-grid">
                    <section className="routes-tree__panel-card">
                      <div className="routes-tree__panel-head">
                        <div>
                          <div className="routes-tree__panel-title">URL Override</div>
                          <div className="routes-tree__panel-sub">
                            Blank uses auto-generated URL from the page hierarchy.
                          </div>
                        </div>
                      </div>

                      <div className="routes-tree__panel-row">
                        <label className="routes-tree__panel-label">Override URL</label>
                        <input
                          className="routes-explorer__admin-input"
                          key={`ov:${it.id}:${overrideValue}`}
                          defaultValue={overrideValue}
                          placeholder="e.g. /my-page"
                          onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            const v = (e.target as HTMLInputElement).value;
                            void saveOverride(it.id, v);
                          }}
                        />
                      </div>

                      <div className="routes-tree__panel-actions">
                        <button
                          type="button"
                          className="routes-explorer__admin-btn"
                          disabled={busyId === it.id}
                          onClick={(e) => {
                            const root = e.currentTarget.closest(
                              ".routes-tree__panel-card",
                            ) as HTMLElement | null;
                            const input = root?.querySelector("input") as HTMLInputElement | null;
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
                            const root = e.currentTarget.closest(
                              ".routes-tree__panel-card",
                            ) as HTMLElement | null;
                            const input = root?.querySelector("input") as HTMLInputElement | null;
                            if (input) input.value = "";
                            void saveOverride(it.id, "");
                          }}
                        >
                          Clear
                        </button>
                      </div>
                    </section>

                    <section className="routes-tree__panel-card">
                      <div className="routes-tree__panel-head">
                        <div>
                          <div className="routes-tree__panel-title">Access</div>
                          <div className="routes-tree__panel-sub">
                            Protects this page and all children, based on the page hierarchy.
                          </div>
                        </div>
                      </div>

                      <div className="routes-tree__panel-row">
                        <label className="routes-tree__panel-label">Type</label>
                        <select
                          className="routes-explorer__admin-select"
                          value={selectedAccess}
                          disabled={inheritedProtected}
                          onChange={(e) =>
                            setAccessChoice((prev) => ({
                              ...prev,
                              [it.id]: (e.target.value as any) || "public",
                            }))
                          }
                        >
                          <option value="public">public</option>
                          <option value="password">password</option>
                          <option value="github">github</option>
                        </select>
                      </div>

                      <div className="routes-tree__panel-row">
                        <label className="routes-tree__panel-label">Password</label>
                        <input
                          className="routes-explorer__admin-input"
                          type="password"
                          disabled={inheritedProtected || selectedAccess !== "password"}
                          placeholder={
                            inheritedProtected
                              ? protectedSource
                                ? `Inherited from ${protectedSource}`
                                : "Inherited from parent route"
                              : selectedAccess === "password"
                                ? effectiveProtected
                                  ? "Set new password (blank = disable)"
                                  : "Set password"
                                : selectedAccess === "github"
                                  ? "No password for GitHub"
                                  : "Public"
                          }
                          onKeyDown={(e) => {
                            if (inheritedProtected) return;
                            if (e.key !== "Enter") return;
                            const root = e.currentTarget.closest(
                              ".routes-tree__panel-card",
                            ) as HTMLElement | null;
                            const pwd = (root?.querySelector('input[type="password"]') as HTMLInputElement | null)
                              ?.value;
                            void saveAccess({
                              pageId: it.id,
                              path: it.routePath,
                              access: selectedAccess,
                              password: pwd || "",
                            });
                            (e.target as HTMLInputElement).value = "";
                          }}
                        />
                      </div>

                      <div className="routes-tree__panel-actions">
                        <button
                          type="button"
                          className="routes-explorer__admin-btn"
                          disabled={busyId === it.id || inheritedProtected}
                          onClick={(e) => {
                            if (inheritedProtected) return;
                            const root = e.currentTarget.closest(
                              ".routes-tree__panel-card",
                            ) as HTMLElement | null;
                            const input = root?.querySelector('input[type="password"]') as HTMLInputElement | null;
                            const pwd = input?.value || "";
                            void saveAccess({
                              pageId: it.id,
                              path: it.routePath,
                              access: selectedAccess,
                              password: pwd,
                            });
                            if (input) input.value = "";
                          }}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="routes-explorer__admin-btn"
                          disabled={busyId === it.id || inheritedProtected}
                          onClick={() =>
                            void saveAccess({
                              pageId: it.id,
                              path: it.routePath,
                              access: "public",
                            })
                          }
                          title={
                            inheritedProtected
                              ? "Inherited protection must be managed on the parent route."
                              : "Make this page public"
                          }
                        >
                          Public
                        </button>
                      </div>

                      {inheritedProtected ? (
                        <div className="routes-tree__panel-note">
                          This page is protected by a parent rule{" "}
                          {protectedSource ? (
                            <>
                              (
                              <code className="routes-explorer__admin-note-code">
                                {protectedSource}
                              </code>
                              )
                            </>
                          ) : null}
                          . To change access, edit that parent page.
                        </div>
                      ) : selectedAccess === "github" ? (
                        <div className="routes-tree__panel-note">
                          GitHub-protected pages require signing in with an allowed GitHub account.
                        </div>
                      ) : null}
                    </section>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
