"use client";

import type { OverrideConflict, RouteTreeItem } from "@/lib/site-admin/route-explorer-model";
import { normalizeAccessMode, type AccessMode } from "@/lib/shared/access";
import { normalizeRoutePath } from "@/lib/shared/route-utils";

export function RouteRowAdminPanel({
  it,
  overrideValue,
  overrideDirty,
  selectedAccess,
  passwordValue,
  accessDirty,
  inheritedProtected,
  effectiveProtected,
  protectedSource,
  busy,
  conflictLocked,
  overrideConflict,
  onSetOverrideValue,
  onSetAccessChoice,
  onSetPasswordValue,
  onSaveOverride,
  onSaveAccess,
}: {
  it: RouteTreeItem;
  overrideValue: string;
  overrideDirty: boolean;
  selectedAccess: AccessMode;
  passwordValue: string;
  accessDirty: boolean;
  inheritedProtected: boolean;
  effectiveProtected: boolean;
  protectedSource: string;
  busy: boolean;
  conflictLocked: boolean;
  overrideConflict: OverrideConflict | null;
  onSetOverrideValue: (id: string, value: string) => void;
  onSetAccessChoice: (id: string, v: AccessMode) => void;
  onSetPasswordValue: (id: string, value: string) => void;
  onSaveOverride: (id: string) => void;
  onSaveAccess: (input: {
    pageId: string;
    path: string;
  }) => void;
}) {
  const normalizedOverrideInput = normalizeRoutePath(overrideValue);
  const hasOverrideConflict = Boolean(normalizedOverrideInput && overrideConflict);

  const saveAccess = () => {
    onSaveAccess({ pageId: it.id, path: it.routePath });
  };

  return (
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
              value={overrideValue}
              placeholder="e.g. /my-page"
              disabled={busy || conflictLocked}
              onChange={(e) => onSetOverrideValue(it.id, e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                if (!overrideDirty || overrideConflict || conflictLocked) return;
                onSaveOverride(it.id);
              }}
            />
          </div>

          <div className="routes-tree__panel-actions">
            <button
              type="button"
              className="routes-explorer__admin-btn"
              disabled={busy || conflictLocked || !overrideDirty || hasOverrideConflict}
              title={overrideConflict ? `Conflicts with ${overrideConflict.path}` : "Save override"}
              onClick={() => onSaveOverride(it.id)}
            >
              Save
            </button>
            <button
              type="button"
              className="routes-explorer__admin-btn"
              disabled={busy || conflictLocked || !overrideValue}
              onClick={() => onSetOverrideValue(it.id, "")}
            >
              Use auto URL
            </button>
          </div>

          {overrideConflict ? (
            <div className="routes-tree__panel-note routes-tree__panel-note--warn">
              URL conflict on <code className="routes-explorer__admin-note-code">{overrideConflict.path}</code>.{" "}
              Already used by{" "}
              {overrideConflict.others
                .slice(0, 3)
                .map((x) => x.title || x.id)
                .join(", ")}
              {overrideConflict.count > 3 ? ` and ${overrideConflict.count - 3} more` : ""}.
            </div>
          ) : null}
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
              disabled={inheritedProtected || busy || conflictLocked}
              onChange={(e) => {
                const nextAccess = normalizeAccessMode(e.target.value, "public");
                onSetAccessChoice(it.id, nextAccess);
              }}
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
              disabled={busy || conflictLocked || inheritedProtected || selectedAccess !== "password"}
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
              value={passwordValue}
              onChange={(e) => onSetPasswordValue(it.id, e.target.value)}
              onKeyDown={(e) => {
                if (inheritedProtected) return;
                if (e.key !== "Enter") return;
                if (!accessDirty || conflictLocked) return;
                saveAccess();
              }}
            />
          </div>

          <div className="routes-tree__panel-actions">
            <button
              type="button"
              className="routes-explorer__admin-btn"
              disabled={busy || inheritedProtected || conflictLocked || !accessDirty}
              onClick={() => {
                if (inheritedProtected) return;
                saveAccess();
              }}
            >
              Save
            </button>
            <button
              type="button"
              className="routes-explorer__admin-btn"
              disabled={busy || inheritedProtected || conflictLocked}
              onClick={() => {
                onSetAccessChoice(it.id, "public");
              }}
              title={
                inheritedProtected
                  ? "Inherited protection must be managed on the parent route."
                  : "Set access to public"
              }
            >
              Set public
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
  );
}
