"use client";

import type { Dispatch, ReactNode, SetStateAction } from "react";

import { Button } from "@/components/ui/button";
import { CheckboxRow } from "@/components/ui/field";
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

function SettingsGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="site-admin-form__section">
      <header className="site-admin-form__section-header">
        <h3>{title}</h3>
        <p>{description}</p>
      </header>
      <div className="site-admin-form__section-fields">{children}</div>
    </section>
  );
}

export function SiteAdminSettingsForm({
  draftSettings,
  busy,
  setDraftSettings,
  onSaveSettings,
}: SiteAdminSettingsFormProps) {
  if (!draftSettings) {
    return (
      <p className="notion-text notion-text__content notion-semantic-string">
        No Site Settings row found. Create one from the Tauri workspace Site Admin surface.
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
      <SettingsGroup
        title="Basic"
        description="Identity and default assets used across the public site."
      >
        <SiteAdminTextFieldRow
          label="Site name"
          value={draftSettings.siteName}
          onChange={(next) => updateField("siteName", next)}
          placeholder="Jinkun Chen."
        />
        <SiteAdminTextFieldRow
          label="Language"
          value={draftSettings.lang}
          onChange={(next) => updateField("lang", next)}
          placeholder="en"
          mono
        />
        <SiteAdminTextFieldRow
          label="Favicon"
          value={draftSettings.favicon}
          onChange={(next) => updateField("favicon", next)}
          placeholder="/favicon.ico"
        />
        <SiteAdminTextFieldRow
          label="Default social image"
          value={draftSettings.ogImage}
          onChange={(next) => updateField("ogImage", next)}
          placeholder="/assets/profile.png"
        />
      </SettingsGroup>

      <SettingsGroup
        title="Search and sharing"
        description="Default title and description shown by search engines and link previews."
      >
        <SiteAdminTextFieldRow
          label="SEO title"
          value={draftSettings.seoTitle}
          onChange={(next) => updateField("seoTitle", next)}
          placeholder="Jinkun Chen"
        />
        <SiteAdminTextAreaRow
          label="SEO description"
          value={draftSettings.seoDescription}
          onChange={(next) => updateField("seoDescription", next)}
          placeholder="Short description for search engines."
        />
        <SiteAdminTextFieldRow
          label="Google Analytics ID"
          value={draftSettings.googleAnalyticsId}
          onChange={(next) => updateField("googleAnalyticsId", next)}
          placeholder="G-XXXXXXXXXX"
          mono
        />
      </SettingsGroup>

      <details className="site-admin-form__advanced">
        <summary>
          <span>Advanced</span>
          <small>Routing, sitemap policy, and raw overrides</small>
        </summary>
        <div className="site-admin-form__advanced-body">
          <SiteAdminTextAreaRow
            label="SEO page overrides (JSON)"
            value={draftSettings.seoPageOverrides}
            onChange={(next) => updateField("seoPageOverrides", next)}
            placeholder={'{"/blog": {"title": "Blog", "description": "Latest posts"}}'}
            mono
          />
          <SiteAdminTextAreaRow
            label="Content GitHub users"
            value={draftSettings.contentGithubUsers}
            onChange={(next) => updateField("contentGithubUsers", next)}
            placeholder="Comma-separated GitHub usernames"
            mono
          />
          <SiteAdminTextAreaRow
            label="Sitemap excludes"
            value={draftSettings.sitemapExcludes}
            onChange={(next) => updateField("sitemapExcludes", next)}
            placeholder={"/private\n/teaching/archive"}
            mono
          />
          <SiteAdminSwitchRow
            label="Sitemap automation"
            checked={Boolean(draftSettings.sitemapAutoExcludeEnabled)}
            onChange={(next) => updateField("sitemapAutoExcludeEnabled", next)}
            text="Automatically exclude configured sections"
          />
          <SiteAdminFormRow label="Sitemap sections">
            <div
              className="site-admin-form__checks"
              role="group"
              aria-label="Sitemap auto-exclude sections"
            >
              {SITEMAP_SECTIONS.map((section) => (
                <CheckboxRow
                  key={section}
                  className="site-admin-form__check"
                  checked={selectedSections.has(section)}
                  onChange={(e) => toggleSection(section, e.target.checked)}
                >
                  {section}
                </CheckboxRow>
              ))}
            </div>
          </SiteAdminFormRow>
          <SiteAdminDepthGridRow
            label="Sitemap max depth"
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
            label="Root page ID"
            value={draftSettings.rootPageId}
            onChange={(next) => updateField("rootPageId", next)}
            placeholder="Page ID"
            mono
          />
          <SiteAdminTextFieldRow
            label="Home page ID"
            value={draftSettings.homePageId}
            onChange={(next) => updateField("homePageId", next)}
            placeholder="Page ID"
            mono
          />
        </div>
      </details>

      <div className="site-admin-form__actions">
        <Button
          type="button"
          className="site-admin-form__btn"
          disabled={busy}
          onClick={onSaveSettings}
        >
          Save settings
        </Button>
      </div>
    </div>
  );
}
