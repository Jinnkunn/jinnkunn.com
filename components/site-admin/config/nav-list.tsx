"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckboxRow, Field } from "@/components/ui/field";
import { asNumber, asString, cn, copyToClipboard } from "./utils";
import type { NavItemRow } from "./types";

export function SiteAdminNavList({
  rows,
  group,
  busy,
  openNav,
  navDraft,
  onToggleOpenNav,
  onUpdateNavDraftField,
  onSaveNavRow,
  onClearNavDraft,
}: {
  rows: NavItemRow[];
  group: "top" | "more";
  busy: boolean;
  openNav: Record<string, boolean>;
  navDraft: Record<string, Partial<NavItemRow>>;
  onToggleOpenNav: (rowId: string) => void;
  onUpdateNavDraftField: (rowId: string, patch: Partial<NavItemRow>) => void;
  onSaveNavRow: (row: NavItemRow) => void;
  onClearNavDraft: (rowId: string) => void;
}) {
  return (
    <div className="site-admin-nav" role="list" aria-label={`Navigation (${group})`}>
      {rows.map((it) => {
        const open = Boolean(openNav[it.rowId]);
        const d = navDraft[it.rowId] || {};
        const dirty = Object.keys(d).length > 0;
        const label = asString(d.label ?? it.label);
        const href = asString(d.href ?? it.href);
        const order = asNumber(d.order ?? it.order);
        const enabled = Boolean(d.enabled ?? it.enabled);

        return (
          <div key={it.rowId} className="site-admin-nav__row" role="listitem" data-open={open ? "1" : "0"}>
            <div className="site-admin-nav__row-top">
              <div className="site-admin-nav__left">
                <button
                  type="button"
                  className="site-admin-nav__expander"
                  aria-label={open ? "Collapse item" : "Expand item"}
                  aria-expanded={open}
                  onClick={() => onToggleOpenNav(it.rowId)}
                  title={open ? "Collapse" : "Expand"}
                >
                  <svg className="site-admin-nav__chev" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M9 6l6 6-6 6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>

                <div className="site-admin-nav__text">
                  <div className="site-admin-nav__headline">
                    <span className="site-admin-nav__label">{label || "Untitled"}</span>
                    <span className="site-admin-nav__href">{href || "(missing href)"}</span>
                  </div>
                  <div className="site-admin-nav__subline">
                    <code className="site-admin-nav__id">{it.rowId}</code>
                    <button
                      type="button"
                      className="site-admin-nav__copy"
                      onClick={() => copyToClipboard(it.rowId)}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              </div>

              <div className="site-admin-nav__right">
                <Badge className="routes-explorer__pill routes-explorer__pill--nav">#{order}</Badge>
                <CheckboxRow
                  className="site-admin-nav__switch"
                  checked={enabled}
                  onChange={(e) =>
                    onUpdateNavDraftField(it.rowId, {
                      enabled: e.target.checked,
                    })
                  }
                  aria-label="Enabled"
                >
                  Enabled
                </CheckboxRow>
              </div>
            </div>

            {open ? (
              <div className="site-admin-nav__panel">
                <div className="site-admin-form site-admin-form--compact" role="group" aria-label="Edit item">
                  <div className="site-admin-form__row">
                    <label className="site-admin-form__label">Label</label>
                    <Field
                      className="site-admin-form__input"
                      value={label}
                      onChange={(e) => onUpdateNavDraftField(it.rowId, { label: e.target.value })}
                      placeholder="Home"
                    />
                  </div>

                  <div className="site-admin-form__row">
                    <label className="site-admin-form__label">Href</label>
                    <Field
                      className="site-admin-form__input site-admin-form__input--mono"
                      mono
                      value={href}
                      onChange={(e) => onUpdateNavDraftField(it.rowId, { href: e.target.value })}
                      placeholder="/blog"
                    />
                  </div>

                  <div className="site-admin-form__row">
                    <label className="site-admin-form__label">Order</label>
                    <Field
                      className="site-admin-form__input site-admin-form__input--mono"
                      mono
                      inputMode="numeric"
                      value={String(order)}
                      onChange={(e) => onUpdateNavDraftField(it.rowId, { order: asNumber(e.target.value) })}
                    />
                  </div>

                  <div className="site-admin-form__actions">
                    <Button
                      type="button"
                      className="site-admin-form__btn"
                      disabled={busy || !dirty}
                      onClick={() => onSaveNavRow(it)}
                      title={dirty ? "Save changes" : "No changes"}
                    >
                      Save
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className={cn("site-admin-form__btn", dirty ? "" : "is-muted")}
                      disabled={busy || !dirty}
                      onClick={() => onClearNavDraft(it.rowId)}
                      title="Discard local edits"
                    >
                      Revert
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="site-admin-form__btn"
                      disabled={busy}
                      onClick={() => onToggleOpenNav(it.rowId)}
                    >
                      Close
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
