import { useCallback, useEffect, useMemo, useState } from "react";

import { JsonDraftRestoreBanner } from "./JsonDraftRestoreBanner";
import { BlocksEditor } from "./LazyBlocksEditor";
import { useSiteAdmin } from "./state";
import { useJsonDraft } from "./use-json-draft";
import { clone, normalizeHomeData, sameData } from "./home-builder/schema";
import type { HomeData } from "./types";

const BLANK_DATA: HomeData = normalizeHomeData({});

/** Home is a single Notion-style MDX document. The section-builder UI
 * (and the underlying `sections` schema) was removed in this refactor;
 * everything Home renders now flows through `bodyMdx` and the same
 * MDX block primitives every other page uses (HeroBlock / Columns /
 * LinkListBlock / FeaturedPagesBlock / paragraphs / headings / …). */
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

  // Restore unsaved drafts across reloads. Snapshot is the whole HomeData
  // (just title + bodyMdx now), so the restore round-trips losslessly.
  const { restorable, clearDraft, dismissRestore } = useJsonDraft<HomeData>(
    "home",
    draft,
    dirty && !loading && !saving,
  );

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
      const payload = data.data ?? {};
      const version = (data.sourceVersion ?? {}) as { fileSha?: string };
      const normalized = normalizeHomeData(payload);
      setBaseData(clone(normalized));
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
    clearDraft();
    setMessage("success", "Home saved.");
  }, [ready, saving, request, draft, fileSha, clearDraft, setMessage]);

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
            Edit Home as a Notion page. Use <code>/</code> for blocks —
            Hero, Columns, Link list, Featured pages, plus regular
            paragraphs / headings / images. Saves to{" "}
            <code>content/home.json</code>.
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
        <span className="text-text-muted">Page title</span>
        <input
          value={draft.title}
          placeholder="Hi there!"
          onChange={(event) =>
            setDraft((current) => ({ ...current, title: event.target.value }))
          }
        />
      </label>

      {restorable && (
        <JsonDraftRestoreBanner
          savedAt={restorable.savedAt}
          onDismiss={dismissRestore}
          onRestore={() => {
            setDraft(clone(restorable.value));
            dismissRestore();
          }}
        />
      )}

      <BlocksEditor
        value={draft.bodyMdx ?? ""}
        onChange={(next) =>
          setDraft((current) => ({
            ...current,
            bodyMdx: next.trim() ? next : undefined,
          }))
        }
        minHeight={520}
      />
    </section>
  );
}
