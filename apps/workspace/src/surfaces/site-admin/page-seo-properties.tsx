import { useCallback, useEffect, useState } from "react";

import { useSiteAdmin } from "./state";
import { normalizeString } from "./utils";
import {
  WorkspaceCheckboxField,
  WorkspaceInspectorSection,
  WorkspaceTextareaField,
  WorkspaceTextField,
} from "../../ui/primitives";

interface PageSeoPropertiesProps {
  /** Canonical URL path this page renders at (e.g. `/pages/about`).
   * Used as the key into `settings.seoPageOverrides`. */
  pathname: string;
}

interface SeoDraft {
  title: string;
  description: string;
  ogImage: string;
  noindex: boolean;
}

interface SeoPageOverride {
  title?: string;
  description?: string;
  ogImage?: string;
  canonicalPath?: string;
  noindex?: boolean;
}

const BLANK_DRAFT: SeoDraft = {
  title: "",
  description: "",
  ogImage: "",
  noindex: false,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseOverridesString(raw: unknown): Record<string, SeoPageOverride> {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return isObject(parsed)
      ? (parsed as Record<string, SeoPageOverride>)
      : {};
  } catch {
    return {};
  }
}

function pickEntry(
  map: Record<string, SeoPageOverride>,
  pathname: string,
): SeoPageOverride | null {
  const entry = map[pathname];
  return isObject(entry) ? entry : null;
}

function entryToDraft(entry: SeoPageOverride | null): SeoDraft {
  if (!entry) return { ...BLANK_DRAFT };
  return {
    title: typeof entry.title === "string" ? entry.title : "",
    description: typeof entry.description === "string" ? entry.description : "",
    ogImage: typeof entry.ogImage === "string" ? entry.ogImage : "",
    noindex: entry.noindex === true,
  };
}

function draftToEntry(draft: SeoDraft): SeoPageOverride | null {
  const out: SeoPageOverride = {};
  const title = normalizeString(draft.title);
  const description = normalizeString(draft.description);
  const ogImage = normalizeString(draft.ogImage);
  if (title) out.title = title;
  if (description) out.description = description;
  if (ogImage) out.ogImage = ogImage;
  if (draft.noindex) out.noindex = true;
  return Object.keys(out).length > 0 ? out : null;
}

/** Per-page SEO override drawer. Reads `settings.seoPageOverrides`
 * (a JSON map keyed by canonical pathname), exposes the entry for
 * this page as editable fields, and writes back through the existing
 * `kind: "settings"` patch shape on /api/site-admin/config. Saving
 * empties of every field clears the entry from the map (so the page
 * inherits site-level SEO defaults again). */
export function PageSeoProperties({ pathname }: PageSeoPropertiesProps) {
  const { request, setMessage } = useSiteAdmin();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<SeoDraft>(BLANK_DRAFT);
  const [hasOverride, setHasOverride] = useState(false);
  const [siteConfigSha, setSiteConfigSha] = useState("");

  const load = useCallback(async () => {
    if (!pathname) return;
    setLoading(true);
    const response = await request("/api/site-admin/config", "GET");
    setLoading(false);
    if (!response.ok) {
      setMessage(
        "error",
        `Load page SEO failed: ${response.code}: ${response.error}`,
      );
      return;
    }
    const payload = (response.data ?? {}) as Record<string, unknown>;
    const settings = (payload.settings ?? {}) as Record<string, unknown>;
    const sourceVersion = (payload.sourceVersion ?? {}) as {
      siteConfigSha?: string;
    };
    setSiteConfigSha(sourceVersion.siteConfigSha ?? "");
    const overrides = parseOverridesString(settings.seoPageOverrides);
    const entry = pickEntry(overrides, pathname);
    setDraft(entryToDraft(entry));
    setHasOverride(entry !== null);
  }, [pathname, request, setMessage]);

  /* eslint-disable react-hooks/set-state-in-effect -- SEO override state is initialized from the admin config API for this pathname. */
  useEffect(() => {
    void load();
  }, [load]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const save = useCallback(async () => {
    if (!pathname || !siteConfigSha) return;
    setSaving(true);
    // Re-fetch the latest map so we don't clobber unrelated entries
    // edited concurrently. The siteConfigSha on the GET we use here
    // is what we'll send back, so a save that races a sibling write
    // surfaces SOURCE_CONFLICT cleanly.
    const fresh = await request("/api/site-admin/config", "GET");
    if (!fresh.ok) {
      setSaving(false);
      setMessage(
        "error",
        `Refresh failed: ${fresh.code}: ${fresh.error}`,
      );
      return;
    }
    const freshPayload = (fresh.data ?? {}) as Record<string, unknown>;
    const freshSettings = (freshPayload.settings ?? {}) as Record<string, unknown>;
    const freshVersion = (freshPayload.sourceVersion ?? {}) as {
      siteConfigSha?: string;
    };
    const map = parseOverridesString(freshSettings.seoPageOverrides);

    const entry = draftToEntry(draft);
    if (entry) {
      map[pathname] = entry;
    } else {
      delete map[pathname];
    }

    const next = Object.keys(map).length > 0 ? JSON.stringify(map) : "";
    const response = await request("/api/site-admin/config", "POST", {
      kind: "settings",
      patch: { seoPageOverrides: next },
      expectedSiteConfigSha:
        freshVersion.siteConfigSha ?? siteConfigSha,
    });
    setSaving(false);
    if (!response.ok) {
      if (response.code === "SOURCE_CONFLICT" || response.status === 409) {
        setMessage(
          "warn",
          "Site config changed on the server. Reload the editor to pick up the latest.",
        );
        return;
      }
      setMessage(
        "error",
        `Save SEO failed: ${response.code}: ${response.error}`,
      );
      return;
    }
    setMessage(
      "success",
      entry
        ? `SEO override saved for ${pathname}.`
        : `SEO override cleared for ${pathname}.`,
    );
    await load();
  }, [pathname, siteConfigSha, draft, request, setMessage, load]);

  if (!pathname) return null;

  return (
    <WorkspaceInspectorSection heading="SEO">
      <p className="page-routing-properties__hint">
        Per-page overrides for the canonical URL <code>{pathname}</code>.
        Empty fields fall back to the site-wide defaults (Settings →
        Site & Navigation). Clearing every field removes the override.
      </p>
      <WorkspaceTextField
        label="SEO title"
        value={draft.title}
        placeholder="(default: page title)"
        disabled={loading}
        onChange={(event) =>
          setDraft((prev) => ({ ...prev, title: event.target.value }))
        }
      />
      <WorkspaceTextareaField
        label="Description"
        rows={3}
        value={draft.description}
        placeholder="Short summary for search results + link previews."
        disabled={loading}
        onChange={(event) =>
          setDraft((prev) => ({ ...prev, description: event.target.value }))
        }
      />
      <WorkspaceTextField
        label="OG image URL"
        value={draft.ogImage}
        placeholder="https://… or /og/page.png"
        spellCheck={false}
        disabled={loading}
        onChange={(event) =>
          setDraft((prev) => ({ ...prev, ogImage: event.target.value }))
        }
      />
      <WorkspaceCheckboxField
        checked={draft.noindex}
        disabled={loading}
        onChange={(event) =>
          setDraft((prev) => ({ ...prev, noindex: event.target.checked }))
        }
      >
        Hide from search engines (<code>noindex</code>)
      </WorkspaceCheckboxField>
      <div className="flex gap-2 pt-2">
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => void save()}
          disabled={loading || saving || !siteConfigSha}
        >
          {saving
            ? "Saving…"
            : hasOverride
              ? "Update SEO override"
              : "Save SEO override"}
        </button>
      </div>
    </WorkspaceInspectorSection>
  );
}
