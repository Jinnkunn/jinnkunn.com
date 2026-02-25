"use client";

import type { Dispatch, SetStateAction } from "react";

import { normalizeDepthString } from "@/lib/shared/depth";
import {
  parseSitemapSectionList,
  SITEMAP_SECTIONS,
} from "@/lib/shared/sitemap-policy";
import {
  SiteAdminDepthGridRow,
  SiteAdminFormRow,
  SiteAdminSwitchRow,
  SiteAdminTextAreaRow,
  SiteAdminTextFieldRow,
  type DepthFieldKey,
} from "./settings-fields";
import type { SiteSettings } from "./types";

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
  const selectedSections = new Set(
    parseSitemapSectionList(draftSettings.sitemapAutoExcludeSections),
  );

  const toggleSection = (section: (typeof SITEMAP_SECTIONS)[number], checked: boolean) => {
    const next = new Set(selectedSections);
    if (checked) next.add(section);
    else next.delete(section);
    updateField("sitemapAutoExcludeSections", Array.from(next).join(", "));
  };

  return (
    <div className="site-admin-form" role="form" aria-label="Site settings">
      <SiteAdminTextFieldRow
        label="Site Name"
        value={draftSettings.siteName}
        onChange={(next) => updateField("siteName", next)}
        placeholder="Jinkun Chen."
      />
      <SiteAdminTextFieldRow
        label="Lang"
        value={draftSettings.lang}
        onChange={(next) => updateField("lang", next)}
        placeholder="en"
        mono
      />
      <SiteAdminTextFieldRow
        label="SEO Title"
        value={draftSettings.seoTitle}
        onChange={(next) => updateField("seoTitle", next)}
        placeholder="Jinkun Chen"
      />
      <SiteAdminTextAreaRow
        label="SEO Description"
        value={draftSettings.seoDescription}
        onChange={(next) => updateField("seoDescription", next)}
        placeholder="Short description for search engines."
      />
      <SiteAdminTextFieldRow
        label="Favicon"
        value={draftSettings.favicon}
        onChange={(next) => updateField("favicon", next)}
        placeholder="/favicon.ico"
      />
      <SiteAdminTextFieldRow
        label="OG Image"
        value={draftSettings.ogImage}
        onChange={(next) => updateField("ogImage", next)}
        placeholder="/assets/profile.png"
      />
      <SiteAdminTextFieldRow
        label="Google Analytics ID"
        value={draftSettings.googleAnalyticsId}
        onChange={(next) => updateField("googleAnalyticsId", next)}
        placeholder="G-XXXXXXXXXX"
        mono
      />
      <SiteAdminTextAreaRow
        label="Content GitHub Users"
        value={draftSettings.contentGithubUsers}
        onChange={(next) => updateField("contentGithubUsers", next)}
        placeholder="comma-separated GitHub usernames (e.g. jinnkunn, alice, bob)"
        mono
      />
      <SiteAdminTextAreaRow
        label="Sitemap Excludes"
        value={draftSettings.sitemapExcludes}
        onChange={(next) => updateField("sitemapExcludes", next)}
        placeholder={"/private\n/teaching/archive\n21040d70fdf580019476fa3c2ec769f2"}
        mono
      />
      <SiteAdminSwitchRow
        label="Sitemap Auto Exclude"
        checked={Boolean(draftSettings.sitemapAutoExcludeEnabled)}
        onChange={(next) => updateField("sitemapAutoExcludeEnabled", next)}
        text="Enable automatic exclusions"
      />

      <SiteAdminFormRow label="Sitemap Sections">
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
      </SiteAdminFormRow>
      <SiteAdminDepthGridRow
        label="Sitemap Max Depth"
        fields={[
          { key: "pages", value: draftSettings.sitemapAutoExcludeDepthPages },
          { key: "blog", value: draftSettings.sitemapAutoExcludeDepthBlog },
          { key: "publications", value: draftSettings.sitemapAutoExcludeDepthPublications },
          { key: "teaching", value: draftSettings.sitemapAutoExcludeDepthTeaching },
        ]}
        onChange={(key: DepthFieldKey, value: string) => {
          const next = normalizeDepthString(value);
          if (key === "pages") updateField("sitemapAutoExcludeDepthPages", next);
          if (key === "blog") updateField("sitemapAutoExcludeDepthBlog", next);
          if (key === "publications") updateField("sitemapAutoExcludeDepthPublications", next);
          if (key === "teaching") updateField("sitemapAutoExcludeDepthTeaching", next);
        }}
      />
      <SiteAdminTextFieldRow
        label="Root Page ID"
        value={draftSettings.rootPageId}
        onChange={(next) => updateField("rootPageId", next)}
        placeholder="Page ID"
        mono
      />
      <SiteAdminTextFieldRow
        label="Home Page ID"
        value={draftSettings.homePageId}
        onChange={(next) => updateField("homePageId", next)}
        placeholder="Page ID"
        mono
      />

      <div className="site-admin-form__actions">
        <button type="button" className="site-admin-form__btn" disabled={busy} onClick={onSaveSettings}>
          Save Settings
        </button>
      </div>
    </div>
  );
}
