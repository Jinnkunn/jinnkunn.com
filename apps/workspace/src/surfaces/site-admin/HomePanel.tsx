import { useCallback, useEffect, useMemo, useState } from "react";

import { useSiteAdmin } from "./state";
import type { HomeData } from "./types";

const BLANK_DATA: HomeData = {
  title: "Hi there!",
  body: "",
};

function clone(value: HomeData): HomeData {
  return JSON.parse(JSON.stringify(value)) as HomeData;
}

function sameData(a: HomeData, b: HomeData): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function HomePanel() {
  const { connection, request, setMessage } = useSiteAdmin();
  const [baseData, setBaseData] = useState<HomeData>(BLANK_DATA);
  const [draft, setDraft] = useState<HomeData>(BLANK_DATA);
  const [fileSha, setFileSha] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);

  const ready = Boolean(connection.baseUrl) && Boolean(connection.authToken);
  const dirty = useMemo(() => !sameData(baseData, draft), [baseData, draft]);

  const loadData = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!ready) return;
      setLoading(true);
      setError("");
      const response = await request("/api/site-admin/home", "GET");
      setLoading(false);
      if (!response.ok) {
        const msg = `${response.code}: ${response.error}`;
        setError(msg);
        if (!options.silent) setMessage("error", `Load home failed: ${msg}`);
        return;
      }
      const data = (response.data ?? {}) as Record<string, unknown>;
      const payload = (data.data ?? {}) as Partial<HomeData>;
      const version = (data.sourceVersion ?? {}) as { fileSha?: string };
      const normalized: HomeData = {
        title: payload.title || "Hi there!",
        profileImageUrl: payload.profileImageUrl,
        profileImageAlt: payload.profileImageAlt,
        body: typeof payload.body === "string" ? payload.body : "",
      };
      setBaseData(normalized);
      setDraft(clone(normalized));
      setFileSha(version.fileSha || "");
      setConflict(false);
      if (!options.silent) setMessage("success", "Home loaded.");
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
    const response = await request("/api/site-admin/home", "POST", {
      data: draft,
      expectedFileSha: fileSha,
    });
    setSaving(false);
    if (!response.ok) {
      const msg = `${response.code}: ${response.error}`;
      if (response.code === "SOURCE_CONFLICT" || response.status === 409) {
        setConflict(true);
        setMessage("warn", "Home changed on the server. Reload + re-apply.");
        return;
      }
      setError(msg);
      setMessage("error", `Save home failed: ${msg}`);
      return;
    }
    const data = (response.data ?? {}) as Record<string, unknown>;
    const version = (data.sourceVersion ?? {}) as { fileSha?: string };
    setBaseData(clone(draft));
    setFileSha(version.fileSha || "");
    setConflict(false);
    setMessage("success", "Home saved.");
  }, [ready, saving, request, draft, fileSha, setMessage]);

  const stateNote = loading
    ? "Loading…"
    : conflict
      ? "Conflict detected. Reload before saving."
      : dirty
        ? "Unsaved changes."
        : "In sync.";

  return (
    <section className="surface-card">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="m-0 text-[20px] font-semibold text-text-primary tracking-[-0.01em]">
            Home
          </h1>
          <p className="m-0 mt-0.5 text-[12.5px] text-text-muted">
            Landing page hero at <code>/</code>. Writes to{" "}
            <code>content/home.json</code>. Body supports markdown.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            className="btn btn--secondary"
            type="button"
            onClick={() => void loadData()}
            disabled={!ready || loading}
          >
            {loading ? "Loading…" : "Reload"}
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

      <label className="flex flex-col gap-1 text-[12.5px]">
        <span className="text-text-muted">Title</span>
        <input
          className="pubs-entry-title-input"
          value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-[12.5px]">
          <span className="text-text-muted">Profile image URL</span>
          <input
            value={draft.profileImageUrl || ""}
            placeholder="/notion-assets/...png or https://..."
            spellCheck={false}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                profileImageUrl: e.target.value || undefined,
              }))
            }
          />
        </label>
        <label className="flex flex-col gap-1 text-[12.5px]">
          <span className="text-text-muted">Image alt text</span>
          <input
            value={draft.profileImageAlt || ""}
            placeholder="Jinkun Chen"
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                profileImageAlt: e.target.value || undefined,
              }))
            }
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-[12.5px]">
        <span className="text-text-muted">Body (markdown)</span>
        <textarea
          className="news-entry-body"
          rows={16}
          value={draft.body}
          onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
          spellCheck={false}
        />
      </label>
    </section>
  );
}
