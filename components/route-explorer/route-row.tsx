"use client";

import { useMemo } from "react";

import type { RouteTreeItem, EffectiveAccess, AdminConfig } from "@/lib/site-admin/route-explorer-model";
import { compactId, normalizeRoutePath } from "@/lib/shared/route-utils.mjs";

import { IconButton } from "./icon-button";
import { LockIcon, RouteKindIcon } from "./icons";
import { cn, copyToClipboard } from "./utils";

export function RouteRow({
  it,
  cfg,
  collapsed,
  adminOpen,
  busy,
  accessChoice,
  effectiveAccess,
  inheritedProtected,
  directProtected,
  overrideValue,
  overridePending,
  onToggleCollapsed,
  onToggleAdmin,
  onSetAccessChoice,
  onSaveOverride,
  onSaveAccess,
}: {
  it: RouteTreeItem;
  cfg: AdminConfig;
  collapsed: Record<string, boolean>;
  adminOpen: boolean;
  busy: boolean;
  accessChoice: Record<string, "public" | "password" | "github">;
  effectiveAccess: EffectiveAccess | null;
  inheritedProtected: boolean;
  directProtected: boolean;
  overrideValue: string;
  overridePending: boolean;
  onToggleCollapsed: (id: string) => void;
  onToggleAdmin: (id: string) => void;
  onSetAccessChoice: (id: string, v: "public" | "password" | "github") => void;
  onSaveOverride: (id: string, v: string) => void;
  onSaveAccess: (input: { pageId: string; path: string; access: "public" | "password" | "github"; password?: string }) => void;
}) {
  const p = normalizeRoutePath(it.routePath);
  const isHome = p === "/";
  const match = effectiveAccess;
  const effectiveProtected = Boolean(match);
  const protectedSource = match?.sourcePath || "";

  const protectedState = directProtected ? "direct" : inheritedProtected ? "inherited" : "0";

  const indent = Math.min(56, it.depth * 16);

  const directAccess: "public" | "password" | "github" = directProtected
    ? cfg.protectedByPageId[compactId(it.id)]?.auth === "github"
      ? "github"
      : "password"
    : "public";

  const selectedAccess =
    accessChoice[it.id] ||
    (inheritedProtected ? (match?.auth === "github" ? "github" : "password") : directAccess);

  // Keep expensive DOM lookups out of event handlers; re-used within panel actions.
  const panelKey = useMemo(() => `ov:${it.id}:${overrideValue}`, [it.id, overrideValue]);

  return (
    <div
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
              onClick={() => onToggleCollapsed(it.id)}
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
              className={cn("routes-explorer__pill", it.navGroup ? "routes-explorer__pill--nav" : "")}
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
                title={protectedSource ? `Inherited from ${protectedSource}` : "Inherited from a protected parent route"}
              >
                <LockIcon className="routes-explorer__pill-icon" />{" "}
                {match?.auth === "github" ? "GitHub" : "Password"}{" "}
                <span className="routes-explorer__pill-suffix">inherited</span>
              </span>
            ) : null}
          </div>

          <div className="routes-tree__actions">
            <IconButton href={it.routePath} label={`Open ${it.routePath}`} title="Open page">
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

            <IconButton label={`Copy page id ${it.id}`} onClick={() => void copyToClipboard(it.id)} title="Copy page id">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="routes-tree__icon">
                <path
                  d="M4 7.5A3.5 3.5 0 0 1 7.5 4h7A3.5 3.5 0 0 1 18 7.5v9A3.5 3.5 0 0 1 14.5 20h-7A3.5 3.5 0 0 1 4 16.5v-9Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
                <path d="M8 9h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M8 13h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </IconButton>

            <IconButton
              label={adminOpen ? "Close settings" : "Open settings"}
              onClick={() => onToggleAdmin(it.id)}
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
                  key={panelKey}
                  defaultValue={overrideValue}
                  placeholder="e.g. /my-page"
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    const v = (e.target as HTMLInputElement).value;
                    onSaveOverride(it.id, v);
                  }}
                />
              </div>

              <div className="routes-tree__panel-actions">
                <button
                  type="button"
                  className="routes-explorer__admin-btn"
                  disabled={busy}
                  onClick={(e) => {
                    const root = e.currentTarget.closest(".routes-tree__panel-card") as HTMLElement | null;
                    const input = root?.querySelector("input") as HTMLInputElement | null;
                    onSaveOverride(it.id, input?.value || "");
                  }}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="routes-explorer__admin-btn"
                  disabled={busy}
                  onClick={(e) => {
                    const root = e.currentTarget.closest(".routes-tree__panel-card") as HTMLElement | null;
                    const input = root?.querySelector("input") as HTMLInputElement | null;
                    if (input) input.value = "";
                    onSaveOverride(it.id, "");
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
                  onChange={(e) => onSetAccessChoice(it.id, ((e.target.value as any) || "public") as any)}
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
                    const root = e.currentTarget.closest(".routes-tree__panel-card") as HTMLElement | null;
                    const pwd = (root?.querySelector('input[type="password"]') as HTMLInputElement | null)?.value;
                    onSaveAccess({ pageId: it.id, path: it.routePath, access: selectedAccess, password: pwd || "" });
                    (e.target as HTMLInputElement).value = "";
                  }}
                />
              </div>

              <div className="routes-tree__panel-actions">
                <button
                  type="button"
                  className="routes-explorer__admin-btn"
                  disabled={busy || inheritedProtected}
                  onClick={(e) => {
                    if (inheritedProtected) return;
                    const root = e.currentTarget.closest(".routes-tree__panel-card") as HTMLElement | null;
                    const input = root?.querySelector('input[type="password"]') as HTMLInputElement | null;
                    const pwd = input?.value || "";
                    onSaveAccess({ pageId: it.id, path: it.routePath, access: selectedAccess, password: pwd });
                    if (input) input.value = "";
                  }}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="routes-explorer__admin-btn"
                  disabled={busy || inheritedProtected}
                  onClick={() => onSaveAccess({ pageId: it.id, path: it.routePath, access: "public" })}
                  title={inheritedProtected ? "Inherited protection must be managed on the parent route." : "Make this page public"}
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
                      <code className="routes-explorer__admin-note-code">{protectedSource}</code>)
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
}
