import { useCallback, useEffect, useMemo, useState } from "react";

import { EntriesSection } from "./publications/EntriesSection";
import { ProfileLinksSection } from "./publications/ProfileLinksSection";
import { useSiteAdmin } from "./state";
import type { PublicationsData } from "./types";

const BLANK_DATA: PublicationsData = {
  title: "Publications",
  profileLinks: [],
  entries: [],
};

function clone(value: PublicationsData): PublicationsData {
  return JSON.parse(JSON.stringify(value)) as PublicationsData;
}

function shallowEqual(a: PublicationsData, b: PublicationsData): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function PublicationsPanel() {
  const { connection, request, setMessage } = useSiteAdmin();
  const [baseData, setBaseData] = useState<PublicationsData>(BLANK_DATA);
  const [draft, setDraft] = useState<PublicationsData>(BLANK_DATA);
  const [fileSha, setFileSha] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);

  const ready = Boolean(connection.baseUrl) && Boolean(connection.authToken);
  const dirty = useMemo(() => !shallowEqual(baseData, draft), [baseData, draft]);

  const loadData = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!ready) return;
      setLoading(true);
      setError("");
      const response = await request("/api/site-admin/publications", "GET");
      setLoading(false);
      if (!response.ok) {
        const msg = `${response.code}: ${response.error}`;
        setError(msg);
        if (!options.silent) {
          setMessage("error", `Load publications failed: ${msg}`);
        }
        return;
      }
      const data = (response.data ?? {}) as Record<string, unknown>;
      const payload = (data.data ?? {}) as PublicationsData;
      const version = (data.sourceVersion ?? {}) as { fileSha?: string };
      const normalized: PublicationsData = {
        title: payload.title || "Publications",
        description: payload.description,
        profileLinks: Array.isArray(payload.profileLinks)
          ? payload.profileLinks
          : [],
        entries: Array.isArray(payload.entries) ? payload.entries : [],
      };
      setBaseData(normalized);
      setDraft(clone(normalized));
      setFileSha(version.fileSha || "");
      setConflict(false);
      if (!options.silent) {
        setMessage(
          "success",
          `Loaded ${normalized.entries.length} publication${normalized.entries.length === 1 ? "" : "s"}.`,
        );
      }
    },
    [ready, request, setMessage],
  );

  useEffect(() => {
    if (!ready) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData({ silent: true });
  }, [ready, loadData]);

  const save = useCallback(async () => {
    if (!ready || saving) return;
    setSaving(true);
    setError("");
    const response = await request("/api/site-admin/publications", "POST", {
      data: draft,
      expectedFileSha: fileSha,
    });
    setSaving(false);
    if (!response.ok) {
      const msg = `${response.code}: ${response.error}`;
      if (response.code === "SOURCE_CONFLICT" || response.status === 409) {
        setConflict(true);
        setMessage(
          "warn",
          "Publications changed on the server. Reload latest and re-apply your edits.",
        );
        return;
      }
      setError(msg);
      setMessage("error", `Save publications failed: ${msg}`);
      return;
    }
    const data = (response.data ?? {}) as Record<string, unknown>;
    const version = (data.sourceVersion ?? {}) as { fileSha?: string };
    setBaseData(clone(draft));
    setFileSha(version.fileSha || "");
    setConflict(false);
    setMessage("success", "Publications saved.");
  }, [ready, saving, request, draft, fileSha, setMessage]);

  const stateNote = loading
    ? "Loading…"
    : conflict
      ? "Conflict detected. Reload latest before saving."
      : dirty
        ? "Unsaved changes."
        : "In sync.";

  return (
    <section className="surface-card">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="m-0 text-[20px] font-semibold text-text-primary tracking-[-0.01em]">
            Publications
          </h1>
          <p className="m-0 mt-0.5 text-[12.5px] text-text-muted">
            Structured list rendered at <code>/publications</code>. Writes to{" "}
            <code>content/publications.json</code>; saves trigger an
            auto-deploy.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            className="btn btn--secondary"
            type="button"
            onClick={() => void loadData()}
            disabled={!ready || loading}
          >
            {loading ? "Loading…" : "Reload Latest"}
          </button>
          <button
            className="btn btn--primary"
            type="button"
            onClick={() => void save()}
            disabled={!ready || saving || !dirty || conflict}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      {error && (
        <p className="m-0 text-[12px] text-[color:var(--color-danger)]">{error}</p>
      )}
      <p className="m-0 text-[12px] text-text-muted">{stateNote}</p>

      <ProfileLinksSection
        links={draft.profileLinks}
        onChange={(next) => setDraft((d) => ({ ...d, profileLinks: next }))}
      />
      <EntriesSection
        entries={draft.entries}
        onChange={(next) => setDraft((d) => ({ ...d, entries: next }))}
      />
    </section>
  );
}
