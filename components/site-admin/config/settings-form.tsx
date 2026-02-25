"use client";

import type { Dispatch, SetStateAction } from "react";

import type { SiteSettings } from "./types";
import { asString } from "./utils";

const SITEMAP_SECTIONS = ["pages", "blog", "publications", "teaching"] as const;

function parseSectionList(raw: string): Set<string> {
  const out = new Set<string>();
  const list = String(raw || "")
    .split(/[\s,\n]+/g)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const it of list) {
    if (SITEMAP_SECTIONS.includes(it as (typeof SITEMAP_SECTIONS)[number])) {
      out.add(it);
    }
  }
  return out;
}

function asDepth(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "";
  return String(Math.max(0, Math.min(20, Math.floor(n))));
}

type SiteAdminSettingsFormProps = {
  draftSettings: SiteSettings | null;
  busy: boolean;
  setDraftSettings: Dispatch<SetStateAction<SiteSettings | null>>;
  onSaveSettings: () => void;
};

export function SiteAdminSettingsForm({
  draftSettings,
  busy,
  setDraftSettings,
  onSaveSettings,
}: SiteAdminSettingsFormProps) {
  if (!draftSettings) {
    return (
      <p className="notion-text notion-text__content notion-semantic-string">
        No Site Settings row found. Run `scripts/provision-site-admin.mjs` once to create the databases.
      </p>
    );
  }

  const updateField = <K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) => {
    setDraftSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  };
  const selectedSections = parseSectionList(draftSettings.sitemapAutoExcludeSections);

  const toggleSection = (section: (typeof SITEMAP_SECTIONS)[number], checked: boolean) => {
    const next = new Set(selectedSections);
    if (checked) next.add(section);
    else next.delete(section);
    updateField("sitemapAutoExcludeSections", Array.from(next).join(", "));
  };

  return (
    <div className="site-admin-form" role="form" aria-label="Site settings">
      <div className="site-admin-form__row">
        <label className="site-admin-form__label">Site Name</label>
        <input
          className="site-admin-form__input"
          value={asString(draftSettings.siteName)}
          onChange={(e) => updateField("siteName", e.target.value)}
          placeholder="Jinkun Chen."
        />
      </div>

      <div className="site-admin-form__row">
        <label className="site-admin-form__label">Lang</label>
        <input
          className="site-admin-form__input site-admin-form__input--mono"
          value={asString(draftSettings.lang)}
          onChange={(e) => updateField("lang", e.target.value)}
          placeholder="en"
        />
      </div>

      <div className="site-admin-form__row">
        <label className="site-admin-form__label">SEO Title</label>
        <input
          className="site-admin-form__input"
          value={asString(draftSettings.seoTitle)}
          onChange={(e) => updateField("seoTitle", e.target.value)}
          placeholder="Jinkun Chen"
        />
      </div>

      <div className="site-admin-form__row">
        <label className="site-admin-form__label">SEO Description</label>
        <textarea
          className="site-admin-form__textarea"
          value={asString(draftSettings.seoDescription)}
          onChange={(e) => updateField("seoDescription", e.target.value)}
          placeholder="Short description for search engines."
        />
      </div>

      <div className="site-admin-form__row">
        <label className="site-admin-form__label">Favicon</label>
        <input
          className="site-admin-form__input"
          value={asString(draftSettings.favicon)}
          onChange={(e) => updateField("favicon", e.target.value)}
          placeholder="/favicon.ico"
        />
      </div>

      <div className="site-admin-form__row">
        <label className="site-admin-form__label">OG Image</label>
        <input
          className="site-admin-form__input"
          value={asString(draftSettings.ogImage)}
          onChange={(e) => updateField("ogImage", e.target.value)}
          placeholder="/assets/profile.png"
        />
      </div>

      <div className="site-admin-form__row">
        <label className="site-admin-form__label">Google Analytics ID</label>
        <input
          className="site-admin-form__input site-admin-form__input--mono"
          value={asString(draftSettings.googleAnalyticsId)}
          onChange={(e) => updateField("googleAnalyticsId", e.target.value)}
          placeholder="G-XXXXXXXXXX"
        />
      </div>

      <div className="site-admin-form__row">
        <label className="site-admin-form__label">Content GitHub Users</label>
        <textarea
          className="site-admin-form__textarea site-admin-form__textarea--mono"
          value={asString(draftSettings.contentGithubUsers)}
          onChange={(e) => updateField("contentGithubUsers", e.target.value)}
          placeholder="comma-separated GitHub usernames (e.g. jinnkunn, alice, bob)"
        />
      </div>

      <div className="site-admin-form__row">
        <label className="site-admin-form__label">Sitemap Excludes</label>
        <textarea
          className="site-admin-form__textarea site-admin-form__textarea--mono"
          value={asString(draftSettings.sitemapExcludes)}
          onChange={(e) => updateField("sitemapExcludes", e.target.value)}
          placeholder={"/private\n/teaching/archive\n21040d70fdf580019476fa3c2ec769f2"}
        />
      </div>

      <div className="site-admin-form__row">
        <label className="site-admin-form__label">Sitemap Auto Exclude</label>
        <label className="site-admin-form__switch">
          <input
            type="checkbox"
            checked={Boolean(draftSettings.sitemapAutoExcludeEnabled)}
            onChange={(e) => updateField("sitemapAutoExcludeEnabled", e.target.checked)}
          />
          <span>Enable automatic exclusions</span>
        </label>
      </div>

      <div className="site-admin-form__row">
        <label className="site-admin-form__label">Sitemap Sections</label>
        <div className="site-admin-form__checks" role="group" aria-label="Sitemap auto-exclude sections">
          {SITEMAP_SECTIONS.map((section) => (
            <label key={section} className="site-admin-form__check">
              <input
                type="checkbox"
                checked={selectedSections.has(section)}
                onChange={(e) => toggleSection(section, e.target.checked)}
              />
              <span>{section}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="site-admin-form__row">
        <label className="site-admin-form__label">Sitemap Max Depth</label>
        <div className="site-admin-form__depth-grid">
          <label className="site-admin-form__depth-item">
            <span>pages</span>
            <input
              className="site-admin-form__input site-admin-form__input--mono"
              inputMode="numeric"
              value={asString(draftSettings.sitemapAutoExcludeDepthPages)}
              onChange={(e) =>
                updateField(
                  "sitemapAutoExcludeDepthPages",
                  asDepth(e.target.value),
                )
              }
              placeholder="-"
            />
          </label>
          <label className="site-admin-form__depth-item">
            <span>blog</span>
            <input
              className="site-admin-form__input site-admin-form__input--mono"
              inputMode="numeric"
              value={asString(draftSettings.sitemapAutoExcludeDepthBlog)}
              onChange={(e) =>
                updateField("sitemapAutoExcludeDepthBlog", asDepth(e.target.value))
              }
              placeholder="-"
            />
          </label>
          <label className="site-admin-form__depth-item">
            <span>publications</span>
            <input
              className="site-admin-form__input site-admin-form__input--mono"
              inputMode="numeric"
              value={asString(draftSettings.sitemapAutoExcludeDepthPublications)}
              onChange={(e) =>
                updateField(
                  "sitemapAutoExcludeDepthPublications",
                  asDepth(e.target.value),
                )
              }
              placeholder="-"
            />
          </label>
          <label className="site-admin-form__depth-item">
            <span>teaching</span>
            <input
              className="site-admin-form__input site-admin-form__input--mono"
              inputMode="numeric"
              value={asString(draftSettings.sitemapAutoExcludeDepthTeaching)}
              onChange={(e) =>
                updateField(
                  "sitemapAutoExcludeDepthTeaching",
                  asDepth(e.target.value),
                )
              }
              placeholder="-"
            />
          </label>
        </div>
      </div>

      <div className="site-admin-form__row">
        <label className="site-admin-form__label">Root Page ID</label>
        <input
          className="site-admin-form__input site-admin-form__input--mono"
          value={asString(draftSettings.rootPageId)}
          onChange={(e) => updateField("rootPageId", e.target.value)}
          placeholder="Page ID"
        />
      </div>

      <div className="site-admin-form__row">
        <label className="site-admin-form__label">Home Page ID</label>
        <input
          className="site-admin-form__input site-admin-form__input--mono"
          value={asString(draftSettings.homePageId)}
          onChange={(e) => updateField("homePageId", e.target.value)}
          placeholder="Page ID"
        />
      </div>

      <div className="site-admin-form__actions">
        <button type="button" className="site-admin-form__btn" disabled={busy} onClick={onSaveSettings}>
          Save Settings
        </button>
      </div>
    </div>
  );
}
