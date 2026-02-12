"use client";

import type { Dispatch, SetStateAction } from "react";

import type { SiteSettings } from "./types";
import { asString } from "./utils";

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

  const updateField = <K extends keyof SiteSettings>(key: K, value: string) => {
    setDraftSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
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
