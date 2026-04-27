import { SeoOverridesEditor } from "../SeoOverridesEditor";
import type { SiteSettings } from "../types";
import {
  isGoogleAnalyticsIdDraftValid,
  normalizeGoogleAnalyticsIdDraft,
} from "../utils";

/** The raw list of text/textarea settings fields. Boolean fields and the
 * SEO-override JSON editor are rendered separately below. Extracted as a
 * constant so the shape + ordering are easy to read at a glance. */
const TEXT_FIELDS: readonly {
  key: keyof SiteSettings;
  label: string;
  wide?: boolean;
  textarea?: boolean;
}[] = [
  { key: "siteName", label: "Site Name" },
  { key: "lang", label: "Language" },
  { key: "seoTitle", label: "SEO Title" },
  { key: "seoDescription", label: "SEO Description", textarea: true },
  { key: "favicon", label: "Favicon URL" },
  { key: "ogImage", label: "OG Image URL" },
  { key: "googleAnalyticsId", label: "Google Analytics ID" },
  { key: "contentGithubUsers", label: "Content GitHub Users", textarea: true },
  { key: "rootPageId", label: "Root Page ID" },
  { key: "homePageId", label: "Home Page ID" },
  { key: "seoPageOverrides", label: "SEO Page Overrides (JSON)", wide: true, textarea: true },
  { key: "sitemapExcludes", label: "Sitemap Excludes", wide: true, textarea: true },
  { key: "sitemapAutoExcludeSections", label: "Sitemap Auto Exclude Sections" },
  { key: "sitemapAutoExcludeDepthPages", label: "Sitemap Auto Exclude Depth Pages" },
  { key: "sitemapAutoExcludeDepthBlog", label: "Sitemap Auto Exclude Depth Blog" },
  { key: "sitemapAutoExcludeDepthPublications", label: "Sitemap Auto Exclude Depth Publications" },
  { key: "sitemapAutoExcludeDepthTeaching", label: "Sitemap Auto Exclude Depth Teaching" },
];

export interface SettingsSectionProps {
  settingsDraft: SiteSettings;
  onUpdate: <K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) => void;
  readOnly?: boolean;
}

export function SettingsSection({
  settingsDraft,
  onUpdate,
  readOnly = false,
}: SettingsSectionProps) {
  return (
    <details className="surface-details" open>
      <summary>Site Settings</summary>
      <div
        className="grid gap-2.5"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}
      >
        {TEXT_FIELDS.map((field) => (
          <SettingsTextField
            key={field.key}
            field={field}
            settingsDraft={settingsDraft}
            onUpdate={onUpdate}
            readOnly={readOnly}
          />
        ))}
        <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
          Sitemap Auto Exclude Enabled
          <select
            disabled={readOnly}
            value={settingsDraft.sitemapAutoExcludeEnabled ? "true" : "false"}
            onChange={(e) =>
              onUpdate("sitemapAutoExcludeEnabled", e.target.value === "true")
            }
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </label>
      </div>

      <div style={{ marginTop: 16 }}>
        <SeoOverridesEditor
          value={settingsDraft.seoPageOverrides}
          onChange={(next) => onUpdate("seoPageOverrides", next as never)}
          readOnly={readOnly}
        />
      </div>
    </details>
  );
}

function SettingsTextField({
  field,
  settingsDraft,
  onUpdate,
  readOnly,
}: {
  field: (typeof TEXT_FIELDS)[number];
  settingsDraft: SiteSettings;
  onUpdate: <K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) => void;
  readOnly: boolean;
}) {
  const value = settingsDraft[field.key] as string;
  const isGoogleAnalyticsField = field.key === "googleAnalyticsId";
  const invalidGoogleAnalyticsId =
    isGoogleAnalyticsField && !isGoogleAnalyticsIdDraftValid(value);
  const normalizeOnBlur = () => {
    if (!isGoogleAnalyticsField) return;
    const normalized = normalizeGoogleAnalyticsIdDraft(value);
    if (normalized !== value) onUpdate(field.key, normalized as never);
  };

  return (
    <label
      className="flex flex-col gap-1 text-[12px] text-text-secondary"
      style={field.wide ? { gridColumn: "1 / -1" } : undefined}
    >
      {field.label}
      {field.textarea ? (
        <textarea
          disabled={readOnly}
          rows={3}
          value={value}
          onChange={(e) => onUpdate(field.key, e.target.value as never)}
        />
      ) : (
        <input
          aria-invalid={invalidGoogleAnalyticsId || undefined}
          className={isGoogleAnalyticsField ? "font-mono" : undefined}
          disabled={readOnly}
          placeholder={isGoogleAnalyticsField ? "G-XXXXXXXXXX" : undefined}
          value={value}
          onBlur={normalizeOnBlur}
          onChange={(e) => onUpdate(field.key, e.target.value as never)}
        />
      )}
      {invalidGoogleAnalyticsId ? (
        <span className="text-[11px] text-red-700">
          Use a GA4 measurement ID like G-XXXXXXXXXX, or leave blank.
        </span>
      ) : null}
    </label>
  );
}
