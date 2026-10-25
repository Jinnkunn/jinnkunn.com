"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/loading-state";
import { StatusNotice } from "@/components/ui/status-notice";
import {
  normalizeAnnouncement,
  announcementProblems,
  type AnnouncementsDocument,
  type SiteAnnouncement,
} from "@/lib/shared/announcements";
import { SiteAdminMarkdownEditor } from "./site-admin-markdown-editor";
import { useSiteAdminSingletonDraft } from "./use-site-admin-singleton-draft";
import { SiteAdminDraftStatus } from "./site-admin-draft-status";
import { SiteAdminConflictDialog } from "./site-admin-conflict-dialog";
import { SiteAdminPagePreview } from "./site-admin-page-preview";
import styles from "./site-admin-announcements-panel.module.css";

type AnnouncementsPayload = {
  data: AnnouncementsDocument;
  sourceVersion: { fileSha: string };
};

function freshAnnouncement(): SiteAnnouncement {
  const now = new Date();
  return {
    id: `announcement-${now.getTime()}`,
    title: "Untitled announcement",
    status: "draft",
    scope: "all-public",
    routes: [],
    layout: "prose",
    initialState: "route-aware",
    collapsible: true,
    compactMdx: "A short announcement",
    bodyMdx: "## Announcement\n\nWrite the announcement here.",
    startsAt: "",
    endsAt: "",
    updatedAt: now.toISOString(),
  };
}

function fingerprint(value: SiteAnnouncement | null) {
  return value ? JSON.stringify(value) : "";
}

function routesFromText(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((route) => route.trim())
        .filter(Boolean)
        .map((route) => (route.startsWith("/") ? route : `/${route}`)),
    ),
  );
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    throw Object.assign(new Error(payload?.error || `${response.status} ${response.statusText}`), { status: response.status });
  }
  return (payload?.data ?? payload) as T;
}

export function SiteAdminAnnouncementsPanel({
  actor,
  pending,
  live,
  onReview,
  onDirtyChange,
  onSavingChange,
  onSaved,
}: {
  actor: string;
  pending: boolean;
  live: boolean;
  onReview: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
  onSaved?: (action: "save" | "delete") => void;
}) {
  const [payload, setPayload] = useState<AnnouncementsPayload | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<SiteAnnouncement | null>(null);
  const [baseline, setBaseline] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState<AnnouncementsPayload | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [bodyFocusRequest, setBodyFocusRequest] = useState(0);
  const issues = draft ? announcementProblems(draft) : [];
  const dirty = Boolean(draft && fingerprint(draft) !== baseline);
  const routesText = useMemo(() => (draft?.routes || []).join("\n"), [draft?.routes]);
  const draftRef = useRef(draft); draftRef.current = draft;
  const persistence = useSiteAdminSingletonDraft({
    kind: `${actor}:announcements`, id: "active", ready: Boolean(payload) && !loading,
    dirty, source: fingerprint(draft), form: draft, baseVersion: payload?.sourceVersion.fileSha || "",
    enabled: !loading && !saving && Boolean(draft) && !conflict,
    onSave: () => save(),
    onRestore: (restored) => {
      if (!restored) return;
      setDraft(restored); setSelectedId(restored.id);
      setBaseline(fingerprint(payload?.data.items.find((item) => item.id === restored.id) || null));
    },
  });

  async function load(preferredId?: string) {
    setLoading(true);
    setError("");
    try {
      const next = await requestJson<AnnouncementsPayload>("/api/site-admin/announcements");
      setPayload(next);
      const selected =
        next.data.items.find((item) => item.id === preferredId) || next.data.items[0] || null;
      setSelectedId(selected?.id || "");
      setDraft(selected ? structuredClone(selected) : null);
      setBaseline(fingerprint(selected));
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    onSavingChange?.(saving);
    return () => onSavingChange?.(false);
  }, [saving, onSavingChange]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      if (!dirty || saving) return;
      event.preventDefault();
      void persistence.save();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  function update<K extends keyof SiteAnnouncement>(key: K, value: SiteAnnouncement[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setNotice("");
  }

  function select(id: string) {
    if (saving) return;
    if (id === selectedId) return;
    if (dirty && !window.confirm("Discard unsaved announcement edits?")) return;
    persistence.dismiss(); persistence.resume();
    const selected = payload?.data.items.find((item) => item.id === id) || null;
    setSelectedId(selected?.id || "");
    setDraft(selected ? structuredClone(selected) : null);
    setBaseline(fingerprint(selected));
    setError("");
    setNotice("");
  }

  function createAnnouncement() {
    if (saving) return;
    if (dirty && !window.confirm("Discard unsaved announcement edits?")) return;
    persistence.dismiss(); persistence.resume();
    const next = freshAnnouncement();
    setSelectedId(next.id);
    setDraft(next);
    setBaseline("");
    setError("");
    setNotice("");
  }

  async function save(expectedVersion?: string): Promise<boolean> {
    if (!draft || !payload || saving) return false;
    const captured = draft;
    const normalized = normalizeAnnouncement(captured, captured.id);
    if (!normalized) return false;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const next = await requestJson<AnnouncementsPayload>("/api/site-admin/announcements", {
        method: "POST",
        body: JSON.stringify({
          action: "upsert",
          announcement: normalized,
          expectedFileSha: expectedVersion ?? payload.sourceVersion.fileSha,
        }),
      });
      const saved = next.data.items.find((item) => item.id === normalized.id) || normalized;
      setPayload(next);
      setSelectedId(saved.id);
      setBaseline(fingerprint(captured));
      setNotice(
        saved.status === "published"
          ? "Announcement saved. Publish the content update when ready."
          : "Draft announcement saved.",
      );
      onSaved?.("save");
      return true;
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      if ((nextError as { status?: number })?.status === 409) {
        const remote = await requestJson<AnnouncementsPayload>("/api/site-admin/announcements").catch(() => null);
        if (remote) setConflict(remote);
      }
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!draft || !payload || saving) return;
    if (!window.confirm(`Delete “${draft.title}”?`)) return;
    setSaving(true);
    setError("");
    try {
      const next = await requestJson<AnnouncementsPayload>("/api/site-admin/announcements", {
        method: "POST",
        body: JSON.stringify({
          action: "delete",
          id: draft.id,
          expectedFileSha: payload.sourceVersion.fileSha,
        }),
      });
      setPayload(next);
      const selected = next.data.items[0] || null;
      setSelectedId(selected?.id || "");
      setDraft(selected ? structuredClone(selected) : null);
      setBaseline(fingerprint(selected));
      setNotice("Announcement deleted.");
      persistence.dismiss(); persistence.resume();
      onSaved?.("delete");
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState label="Loading announcements…" />;

  function focusIssue(field: string) {
    if (field === "bodyMdx") setBodyFocusRequest((value) => value + 1);
    const element = document.querySelector<HTMLElement>(`[data-announcement-field="${field}"]`);
    element?.scrollIntoView({ block: "center" });
    if (element?.matches("input,textarea")) element.focus({ preventScroll: true });
  }

  return (
    <div className={styles.workspace}>
      {error ? <StatusNotice tone="danger">{error}</StatusNotice> : null}
      {notice ? <StatusNotice tone="success">{notice}</StatusNotice> : null}
      {!draft && persistence.recovery ? <SiteAdminDraftStatus {...persistence} dirty={false} saving={saving} pending={pending} live={live} onRetry={() => void persistence.save()} onRestore={persistence.restore} onDismiss={persistence.dismiss} /> : null}
      <Card className={styles.panel}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Site announcements</p>
            <h2>Notices and banners</h2>
            <p>Publish flexible MDX above the public site without changing its color treatment.</p>
          </div>
          <Button onClick={createAnnouncement} variant="subtle" size="sm" disabled={saving}>
            New
          </Button>
        </header>

        {payload?.data.items.length ? (
          <div className={styles.list} aria-label="Announcements">
            {payload.data.items.map((item) => (
              <button
                type="button"
                key={item.id}
                data-active={item.id === selectedId}
                disabled={saving}
                onClick={() => select(item.id)}
              >
                <span>
                  <strong>{item.title || "Untitled announcement"}</strong>
                  <small>{item.scope === "all-public" ? "All public pages" : item.scope === "home" ? "Home" : item.routes.join(", ")}</small>
                </span>
                <em data-status={item.status}>{item.status}</em>
              </button>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            <p>No announcements yet.</p>
            <Button onClick={createAnnouncement} tone="accent" size="sm">Create announcement</Button>
          </div>
        )}
      </Card>

      {draft ? (
        <Card className={styles.editor}>
          <header className={styles.header}>
            <div>
              <p className={styles.eyebrow}>Announcement</p>
              <h2>{draft.title}</h2>
              <p>{dirty ? "Unsaved changes" : `Saved ${draft.updatedAt ? new Date(draft.updatedAt).toLocaleString() : ""}`}</p>
            </div>
            <div className={styles.actions}>
              <Button variant="subtle" size="sm" onClick={() => setPreviewOpen(true)}>Page preview</Button>
              <Button onClick={() => void remove()} variant="ghost" size="sm" disabled={saving}>Delete</Button>
              <Button onClick={() => void persistence.save()} tone="accent" size="sm" disabled={saving || !dirty}>
                {saving ? "Saving draft" : "Save draft"}
              </Button>
            </div>
          </header>

          <SiteAdminDraftStatus {...persistence} dirty={dirty} saving={saving} pending={pending} live={live} onRetry={() => void persistence.save()} onRestore={persistence.restore} onDismiss={persistence.dismiss} onReview={onReview} />
          {issues.length ? <section><p>Drafts can be saved. Review these fields before publication.</p><ul aria-label="Announcement fields needing attention" className={styles.issues}>{issues.map((issue) => <li key={issue.field}><button type="button" onClick={() => focusIssue(issue.field)}>{issue.message}</button></li>)}</ul></section> : null}
          <div className={styles.fieldGrid}>
            <label>
              Title
              <input data-announcement-field="title" aria-invalid={issues.some((issue) => issue.field === "title")} value={draft.title} onChange={(event) => update("title", event.target.value)} />
            </label>
            <label>
              Visibility on publish
              <select value={draft.status} onChange={(event) => update("status", event.target.value as SiteAnnouncement["status"])}>
                <option value="draft">Hidden</option>
                <option value="published">Visible</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <label>
              Scope
              <select value={draft.scope} onChange={(event) => update("scope", event.target.value as SiteAnnouncement["scope"])}>
                <option value="all-public">All public pages</option>
                <option value="home">Home only</option>
                <option value="paths">Selected paths</option>
              </select>
            </label>
            <label>
              Layout
              <select value={draft.layout} onChange={(event) => update("layout", event.target.value as SiteAnnouncement["layout"])}>
                <option value="prose">Single flexible flow</option>
                <option value="columns">Two columns</option>
              </select>
            </label>
            <label>
              Initial display
              <select value={draft.initialState} onChange={(event) => update("initialState", event.target.value as SiteAnnouncement["initialState"])}>
                <option value="route-aware">Expanded on home, compact elsewhere</option>
                <option value="expanded">Always expanded</option>
                <option value="compact">Always compact</option>
              </select>
            </label>
            <label className={styles.checkbox}>
              <input type="checkbox" checked={draft.collapsible} onChange={(event) => update("collapsible", event.target.checked)} />
              Allow visitors to collapse it
            </label>
            <label>
              Starts
              <input type="date" data-announcement-field="startsAt" aria-invalid={issues.some((issue) => issue.field === "startsAt")} value={draft.startsAt} onChange={(event) => update("startsAt", event.target.value)} />
            </label>
            <label>
              Ends (optional)
              <input type="date" data-announcement-field="endsAt" aria-invalid={issues.some((issue) => issue.field === "endsAt")} value={draft.endsAt} onChange={(event) => update("endsAt", event.target.value)} />
            </label>
          </div>

          {draft.scope === "paths" ? (
            <label className={styles.field}>
              Paths
              <textarea
                data-announcement-field="routes"
                aria-invalid={issues.some((issue) => issue.field === "routes")}
                value={routesText}
                onChange={(event) => update("routes", routesFromText(event.target.value))}
                placeholder={"/news\n/blog"}
                rows={3}
              />
            </label>
          ) : null}

          <section className={styles.editorSection}>
            <div>
              <h3>Compact banner</h3>
              <p>Shown when the announcement is collapsed. Links and inline formatting are supported.</p>
            </div>
            <SiteAdminMarkdownEditor
              label="Compact announcement"
              value={draft.compactMdx}
              onChange={(next) => update("compactMdx", next)}
              minHeight={180}
              size="compact"
              allowImageUpload={false}
            />
          </section>

          <section className={styles.editorSection} data-announcement-field="bodyMdx">
            <div>
              <h3>Expanded content</h3>
              <p>
                Write in any language or order. Links and images are inline; in two-column mode, the first horizontal rule separates the columns.
              </p>
            </div>
            <SiteAdminMarkdownEditor
              label="Announcement content"
              focusRequest={bodyFocusRequest}
              value={draft.bodyMdx}
              onChange={(next) => update("bodyMdx", next)}
              minHeight={620}
              size="large"
              allowImageUpload
            />
          </section>
        </Card>
      ) : null}
      {previewOpen && draft ? <SiteAdminPagePreview title={draft.title} source="" announcement={draft} home={draft.scope !== "paths" || draft.routes[0] === "/"} routePath={draft.scope === "paths" ? draft.routes[0] || "/" : "/"} onClose={() => setPreviewOpen(false)} /> : null}
      {conflict ? <SiteAdminConflictDialog busy={saving} conflict={{
        title: draft?.title || "Announcement", localSource: JSON.stringify(draftRef.current, null, 2),
        remoteSource: JSON.stringify(conflict.data.items.find((item) => item.id === selectedId) || null, null, 2),
      }} onClose={() => setConflict(null)}
        onReload={() => { void load(selectedId).then(() => { setConflict(null); persistence.dismiss(); persistence.resume(); }); }}
        onKeepMine={() => { void save(conflict.sourceVersion.fileSha).then((saved) => { if (saved) { setConflict(null); persistence.resume(); } }); }} /> : null}
    </div>
  );
}
