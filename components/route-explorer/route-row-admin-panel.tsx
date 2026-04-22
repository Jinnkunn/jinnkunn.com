"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { StatusNotice } from "@/components/ui/status-notice";
import type { OverrideConflict, RouteTreeItem } from "@/lib/site-admin/route-explorer-model";
import { normalizeAccessMode, type AccessMode } from "@/lib/shared/access";
import { normalizeRoutePath } from "@/lib/shared/route-utils";

export function RouteRowAdminPanel({
  it,
  overrideValue,
  selectedAccess,
  inheritedProtected,
  effectiveProtected,
  protectedSource,
  busy,
  getOverrideConflict,
  onSetAccessChoice,
  onSaveOverride,
  onSaveAccess,
}: {
  it: RouteTreeItem;
  overrideValue: string;
  selectedAccess: AccessMode;
  inheritedProtected: boolean;
  effectiveProtected: boolean;
  protectedSource: string;
  busy: boolean;
  getOverrideConflict: (candidatePath: string) => OverrideConflict | null;
  onSetAccessChoice: (id: string, v: AccessMode) => void;
  onSaveOverride: (id: string, v: string) => void;
  onSaveAccess: (input: {
    pageId: string;
    path: string;
    access: AccessMode;
    password?: string;
  }) => void;
}) {
  const [overrideInput, setOverrideInput] = useState(overrideValue);
  const [passwordInput, setPasswordInput] = useState("");
  const normalizedOverrideInput = normalizeRoutePath(overrideInput);
  const overrideConflict = normalizedOverrideInput
    ? getOverrideConflict(normalizedOverrideInput)
    : null;

  const saveAccess = () => {
    onSaveAccess({
      pageId: it.id,
      path: it.routePath,
      access: selectedAccess,
      password: passwordInput,
    });
    setPasswordInput("");
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
            <Field
              className="routes-explorer__admin-input"
              value={overrideInput}
              placeholder="e.g. /my-page"
              onChange={(e) => setOverrideInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                onSaveOverride(it.id, overrideInput);
              }}
            />
          </div>

          <div className="routes-tree__panel-actions">
            <Button
              type="button"
              className="routes-explorer__admin-btn"
              disabled={busy || Boolean(overrideConflict)}
              title={overrideConflict ? `Conflicts with ${overrideConflict.path}` : "Save override"}
              onClick={() => onSaveOverride(it.id, overrideInput)}
            >
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="routes-explorer__admin-btn"
              disabled={busy}
              onClick={() => {
                setOverrideInput("");
                onSaveOverride(it.id, "");
              }}
            >
              Clear
            </Button>
          </div>

          {overrideConflict ? (
            <StatusNotice className="routes-tree__panel-note routes-tree__panel-note--warn" tone="danger">
              URL conflict on <code className="routes-explorer__admin-note-code">{overrideConflict.path}</code>.{" "}
              Already used by{" "}
              {overrideConflict.others
                .slice(0, 3)
                .map((x) => x.title || x.id)
                .join(", ")}
              {overrideConflict.count > 3 ? ` and ${overrideConflict.count - 3} more` : ""}.
            </StatusNotice>
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
              disabled={inheritedProtected}
              onChange={(e) => {
                const nextAccess = normalizeAccessMode(e.target.value, "public");
                onSetAccessChoice(it.id, nextAccess);
                if (nextAccess !== "password" || inheritedProtected) setPasswordInput("");
              }}
            >
              <option value="public">public</option>
              <option value="password">password</option>
              <option value="github">github</option>
            </select>
          </div>

          <div className="routes-tree__panel-row">
            <label className="routes-tree__panel-label">Password</label>
            <Field
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
              value={inheritedProtected || selectedAccess !== "password" ? "" : passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              onKeyDown={(e) => {
                if (inheritedProtected) return;
                if (e.key !== "Enter") return;
                saveAccess();
              }}
            />
          </div>

          <div className="routes-tree__panel-actions">
            <Button
              type="button"
              className="routes-explorer__admin-btn"
              disabled={busy || inheritedProtected}
              onClick={() => {
                if (inheritedProtected) return;
                saveAccess();
              }}
            >
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="routes-explorer__admin-btn"
              disabled={busy || inheritedProtected}
              onClick={() => onSaveAccess({ pageId: it.id, path: it.routePath, access: "public" })}
              title={inheritedProtected ? "Inherited protection must be managed on the parent route." : "Make this page public"}
            >
              Public
            </Button>
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
