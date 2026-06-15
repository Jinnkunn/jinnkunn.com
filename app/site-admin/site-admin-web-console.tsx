"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusNotice } from "@/components/ui/status-notice";
import type {
  SiteAdminHomeData,
  SiteAdminNowData,
  SiteAdminNowUpdate,
} from "@/lib/site-admin/api-types";
import type { SiteAdminMobileSummary } from "@/lib/site-admin/mobile-summary";
import styles from "./site-admin-dashboard.module.css";

type ApiErrorPayload = {
  ok: false;
  error: string;
  code?: string;
};

type SourceVersion = {
  fileSha: string;
};

type HomePayload = {
  data: SiteAdminHomeData;
  sourceVersion: SourceVersion;
};

type NowPayload = {
  data: SiteAdminNowData;
  sourceVersion: SourceVersion;
};

type SummaryPayload = {
  summary: SiteAdminMobileSummary;
};

type PageListItem = {
  slug: string;
  href: string;
  title: string;
  description?: string;
  updatedIso?: string;
  draft?: boolean;
  wordCount?: number;
  readingMinutes?: number;
  version: string;
};

type PostListItem = {
  slug: string;
  href: string;
  title: string;
  dateIso?: string;
  dateText?: string;
  description?: string;
  draft?: boolean;
  tags?: string[];
  wordCount?: number;
  readingMinutes?: number;
  version: string;
};

type ComponentDefinition = {
  name: string;
  label: string;
  description: string;
  primaryRoute?: string;
  entryLabel?: string;
};

type ComponentSummary = {
  count?: number;
  entryLabel?: string;
};

type PagesPayload = {
  count: number;
  pages: PageListItem[];
};

type PostsPayload = {
  count: number;
  posts: PostListItem[];
};

type ComponentsPayload = {
  components: ComponentDefinition[];
  summaries: Record<string, ComponentSummary>;
  usage: Record<string, unknown[]>;
};

type EditableKind = "posts" | "pages" | "components";

type EditableSummary = {
  id: string;
  title: string;
  href: string;
  meta: string;
  draft?: boolean;
  version?: string;
};

type EditableDetail = {
  kind: EditableKind;
  id: string;
  title: string;
  href: string;
  meta: string;
  version: string;
  source: string;
};

type EditableDetailPayload = {
  slug?: string;
  name?: string;
  href?: string;
  title?: string;
  dateText?: string;
  updatedIso?: string;
  draft?: boolean;
  version: string;
  source: string;
  definition?: ComponentDefinition;
  summary?: ComponentSummary;
};

type CreatePayload = {
  slug: string;
  href?: string;
  title?: string;
  version: string;
};

type MutationPayload = {
  version?: string;
};

type HomePostPayload = {
  sourceVersion: SourceVersion;
};

type Area = "overview" | "content" | "home" | "now";

const DEFAULT_PAGE_SOURCE = `---
title: Untitled Page
description: ""
draft: true
---

Write the page here.
`;

const DEFAULT_POST_SOURCE = `---
title: Untitled Post
date: ${todayInHalifax()}
description: ""
draft: true
---

Write the post here.
`;

function todayInHalifax(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Halifax",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const read = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function dateInputFromIso(value: string | undefined): string {
  if (!value) return todayInHalifax();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return todayInHalifax();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Halifax",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function formatValue(value: string | undefined) {
  const trimmed = String(value || "").trim();
  return trimmed || "Not available";
}

function formatWhen(value: string | undefined) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Halifax",
  }).format(date);
}

function shortSha(value: string | undefined) {
  return String(value || "").slice(0, 7) || "n/a";
}

function encodePathSegments(value: string) {
  return value
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function endpointFor(kind: EditableKind, id: string) {
  if (kind === "pages") return `/api/site-admin/pages/${encodePathSegments(id)}`;
  if (kind === "posts") return `/api/site-admin/posts/${encodeURIComponent(id)}`;
  return `/api/site-admin/components/${encodeURIComponent(id)}`;
}

function titleForKind(kind: EditableKind) {
  if (kind === "pages") return "Pages";
  if (kind === "posts") return "Posts";
  return "Components";
}

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
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
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  const maybeError = payload as Partial<ApiErrorPayload> | null;
  if (!response.ok || maybeError?.ok === false) {
    throw new Error(
      maybeError?.error ||
        `${response.status} ${response.statusText || "Request failed"}`,
    );
  }
  if (
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    (payload as { ok?: unknown }).ok === true &&
    Object.prototype.hasOwnProperty.call(payload, "data")
  ) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

function writeJson<T>(path: string, method: string, body: unknown): Promise<T> {
  return readJson<T>(path, {
    method,
    body: JSON.stringify(body),
  });
}

function toEditableDetail(
  kind: EditableKind,
  id: string,
  payload: EditableDetailPayload,
): EditableDetail {
  const title = payload.definition?.label || payload.title || id;
  const href =
    payload.href ||
    payload.definition?.primaryRoute ||
    (kind === "posts" ? `/blog/${id}` : kind === "pages" ? `/${id}` : "");
  const meta =
    kind === "components"
      ? `${payload.summary?.count ?? 0} ${payload.summary?.entryLabel || "entries"}`
      : payload.dateText || formatWhen(payload.updatedIso);
  return {
    kind,
    id,
    title,
    href,
    meta,
    version: payload.version,
    source: payload.source,
  };
}

function contentItems(input: {
  kind: EditableKind;
  pages: PagesPayload | null;
  posts: PostsPayload | null;
  components: ComponentsPayload | null;
}): EditableSummary[] {
  if (input.kind === "pages") {
    return (input.pages?.pages || []).map((item) => ({
      id: item.slug,
      title: item.title || item.slug,
      href: item.href,
      meta: item.updatedIso ? formatWhen(item.updatedIso) : `${item.wordCount ?? 0} words`,
      draft: item.draft,
      version: item.version,
    }));
  }
  if (input.kind === "posts") {
    return (input.posts?.posts || []).map((item) => ({
      id: item.slug,
      title: item.title || item.slug,
      href: item.href,
      meta: item.dateText || item.dateIso || `${item.wordCount ?? 0} words`,
      draft: item.draft,
      version: item.version,
    }));
  }
  return (input.components?.components || []).map((item) => {
    const summary = input.components?.summaries?.[item.name];
    return {
      id: item.name,
      title: item.label || item.name,
      href: item.primaryRoute || "",
      meta: `${summary?.count ?? 0} ${summary?.entryLabel || item.entryLabel || "entries"}`,
      version: "",
    };
  });
}

function isDeleteSupported(kind: EditableKind) {
  return kind === "pages" || kind === "posts";
}

export function SiteAdminWebConsole({
  actor,
  initialSummary,
  initialSummaryError,
}: {
  actor: string;
  initialSummary: SiteAdminMobileSummary | null;
  initialSummaryError: string;
}) {
  const [area, setArea] = useState<Area>("overview");
  const [summary, setSummary] = useState<SiteAdminMobileSummary | null>(
    initialSummary,
  );
  const [summaryError, setSummaryError] = useState(initialSummaryError);
  const [home, setHome] = useState<HomePayload | null>(null);
  const [homeTitle, setHomeTitle] = useState("");
  const [homeBody, setHomeBody] = useState("");
  const [now, setNow] = useState<NowPayload | null>(null);
  const [nowText, setNowText] = useState("");
  const [nowContext, setNowContext] = useState("");
  const [nowLocation, setNowLocation] = useState("");
  const [nowDate, setNowDate] = useState(todayInHalifax());
  const [editingHistoryId, setEditingHistoryId] = useState("");
  const [historyText, setHistoryText] = useState("");
  const [historyDate, setHistoryDate] = useState(todayInHalifax());
  const [pages, setPages] = useState<PagesPayload | null>(null);
  const [posts, setPosts] = useState<PostsPayload | null>(null);
  const [components, setComponents] = useState<ComponentsPayload | null>(null);
  const [kind, setKind] = useState<EditableKind>("posts");
  const [selected, setSelected] = useState<EditableDetail | null>(null);
  const [sourceDraft, setSourceDraft] = useState("");
  const [createKind, setCreateKind] = useState<"posts" | "pages">("posts");
  const [createSlug, setCreateSlug] = useState("");
  const [createSource, setCreateSource] = useState(DEFAULT_POST_SOURCE);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const currentItems = useMemo(
    () => contentItems({ kind, pages, posts, components }),
    [kind, pages, posts, components],
  );

  async function refreshAll() {
    setLoading(true);
    setError("");
    const results = await Promise.allSettled([
      readJson<SummaryPayload>("/api/site-admin/mobile/summary"),
      readJson<HomePayload>("/api/site-admin/home"),
      readJson<NowPayload>("/api/site-admin/now"),
      readJson<PagesPayload>("/api/site-admin/pages?drafts=1"),
      readJson<PostsPayload>("/api/site-admin/posts?drafts=1"),
      readJson<ComponentsPayload>("/api/site-admin/components"),
    ]);
    const failures: string[] = [];
    const [summaryResult, homeResult, nowResult, pagesResult, postsResult, componentsResult] =
      results;

    if (summaryResult.status === "fulfilled") {
      setSummary(summaryResult.value.summary);
      setSummaryError("");
    } else {
      setSummaryError(summaryResult.reason?.message || "Summary unavailable");
    }

    if (homeResult.status === "fulfilled") {
      setHome(homeResult.value);
      setHomeTitle(homeResult.value.data.title || "");
      setHomeBody(homeResult.value.data.bodyMdx || "");
    } else {
      failures.push(`Home: ${homeResult.reason?.message || "failed"}`);
    }

    if (nowResult.status === "fulfilled") {
      setNow(nowResult.value);
      setNowText(nowResult.value.data.current.text || "");
      setNowContext(nowResult.value.data.current.context || "");
      setNowLocation(nowResult.value.data.current.location || "");
      setNowDate(dateInputFromIso(nowResult.value.data.current.updatedAt));
    } else {
      failures.push(`Now: ${nowResult.reason?.message || "failed"}`);
    }

    if (pagesResult.status === "fulfilled") {
      setPages(pagesResult.value);
    } else {
      failures.push(`Pages: ${pagesResult.reason?.message || "failed"}`);
    }

    if (postsResult.status === "fulfilled") {
      setPosts(postsResult.value);
    } else {
      failures.push(`Posts: ${postsResult.reason?.message || "failed"}`);
    }

    if (componentsResult.status === "fulfilled") {
      setComponents(componentsResult.value);
    } else {
      failures.push(`Components: ${componentsResult.reason?.message || "failed"}`);
    }

    if (failures.length > 0) setError(failures.join(" · "));
    setLoading(false);
  }

  useEffect(() => {
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function selectContent(nextKind: EditableKind, id: string) {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const detail = await readJson<EditableDetailPayload>(
        endpointFor(nextKind, id),
      );
      const next = toEditableDetail(nextKind, id, detail);
      setKind(nextKind);
      setSelected(next);
      setSourceDraft(next.source);
      setArea("content");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function saveSelectedContent() {
    if (!selected) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await writeJson<MutationPayload>(endpointFor(selected.kind, selected.id), "PATCH", {
        source: sourceDraft,
        version: selected.version,
      });
      const detail = await readJson<EditableDetailPayload>(
        endpointFor(selected.kind, selected.id),
      );
      const next = toEditableDetail(selected.kind, selected.id, detail);
      setSelected(next);
      setSourceDraft(next.source);
      await refreshLists();
      setNotice(`${next.title} saved.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function deleteSelectedContent() {
    if (!selected || !isDeleteSupported(selected.kind)) return;
    const confirmed = window.confirm(`Delete ${selected.title}?`);
    if (!confirmed) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await writeJson<{ ok: true }>(endpointFor(selected.kind, selected.id), "DELETE", {
        version: selected.version,
      });
      setSelected(null);
      setSourceDraft("");
      await refreshLists();
      setNotice(`${selected.title} deleted.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function createContent() {
    const slug = createSlug.trim();
    if (!slug) {
      setError("Slug is required.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await writeJson<CreatePayload>(`/api/site-admin/${createKind}`, "POST", {
        slug,
        source: createSource,
      });
      await refreshLists();
      await selectContent(createKind, slug);
      setCreateSlug("");
      setCreateSource(createKind === "posts" ? DEFAULT_POST_SOURCE : DEFAULT_PAGE_SOURCE);
      setNotice(`${slug} created.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function refreshLists() {
    const [nextPages, nextPosts, nextComponents] = await Promise.all([
      readJson<PagesPayload>("/api/site-admin/pages?drafts=1"),
      readJson<PostsPayload>("/api/site-admin/posts?drafts=1"),
      readJson<ComponentsPayload>("/api/site-admin/components"),
    ]);
    setPages(nextPages);
    setPosts(nextPosts);
    setComponents(nextComponents);
  }

  async function saveHome() {
    if (!home) return;
    setSaving(true);
    setError("");
    setNotice("");
  try {
      await writeJson<HomePostPayload>("/api/site-admin/home", "POST", {
        data: {
          ...home.data,
          title: homeTitle,
          bodyMdx: homeBody,
        },
        expectedFileSha: home.sourceVersion.fileSha,
      });
      const next = await readJson<HomePayload>("/api/site-admin/home");
      setHome(next);
      setNotice("Home saved.");
      void refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function saveNow() {
    if (!now) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const next = await writeJson<NowPayload>("/api/site-admin/now", "POST", {
        action: "create",
        text: nowText,
        context: nowContext,
        location: nowLocation,
        date: nowDate,
        expectedFileSha: now.sourceVersion.fileSha,
      });
      setNow(next);
      setNotice("Now saved.");
      void refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function startHistoryEdit(item: SiteAdminNowUpdate) {
    setEditingHistoryId(item.id);
    setHistoryText(item.text);
    setHistoryDate(dateInputFromIso(item.at));
  }

  async function saveHistoryEdit() {
    if (!now || !editingHistoryId) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const next = await writeJson<NowPayload>("/api/site-admin/now", "POST", {
        action: "update-history",
        id: editingHistoryId,
        text: historyText,
        date: historyDate,
        expectedFileSha: now.sourceVersion.fileSha,
      });
      setNow(next);
      setEditingHistoryId("");
      setNotice("Now history updated.");
      void refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function deleteHistory(id: string) {
    if (!now) return;
    const confirmed = window.confirm("Delete this Now update?");
    if (!confirmed) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const next = await writeJson<NowPayload>("/api/site-admin/now", "POST", {
        action: "delete-history",
        id,
        expectedFileSha: now.sourceVersion.fileSha,
      });
      setNow(next);
      setNotice("Now history deleted.");
      void refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const release = summary?.release;
  const source = summary?.source;

  return (
    <main className={styles.shell}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Site Admin</p>
          <h1 className={styles.title}>Dashboard</h1>
          <p className={styles.description}>
            Signed in as <strong>{actor}</strong>. Manage draft website content,
            review release state, and keep the public surface in sync.
          </p>
        </div>
        <div className={styles.heroActions}>
          <Button onClick={() => void refreshAll()} variant="subtle" disabled={loading}>
            {loading ? "Refreshing" : "Refresh"}
          </Button>
          <Button href="/api/site-admin/status" variant="subtle">
            Status
          </Button>
          <Button href="/" variant="ghost">
            Public site
          </Button>
        </div>
      </section>

      {summaryError ? <StatusNotice tone="warning">{summaryError}</StatusNotice> : null}
      {notice ? <StatusNotice tone="success">{notice}</StatusNotice> : null}
      {error ? <StatusNotice tone="danger">{error}</StatusNotice> : null}

      <nav className={styles.adminTabs} aria-label="Site Admin sections">
        {[
          ["overview", "Overview"],
          ["content", "Content"],
          ["home", "Home"],
          ["now", "Now"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={styles.adminTab}
            data-active={area === id}
            onClick={() => setArea(id as Area)}
          >
            {label}
          </button>
        ))}
      </nav>

      {area === "overview" ? (
        <>
          <section className={styles.summaryGrid} aria-label="Site Admin summary">
            <Card className={styles.card}>
              <div className={styles.cardHeader}>
                <p className={styles.cardLabel}>Release</p>
                <span className={styles.statusPill} data-state={release?.recommendedAction.kind}>
                  {release?.recommendedAction.label || "Refresh"}
                </span>
              </div>
              <h2 className={styles.cardTitle}>
                {release?.headline || "Status unavailable"}
              </h2>
              <p className={styles.cardText}>
                {release?.detail || "Refresh release status."}
              </p>
              <div className={styles.cardMeta}>
                <span>Runner</span>
                <strong>{release?.runners?.[0]?.status || "Not seen"}</strong>
              </div>
            </Card>

            <Card className={styles.card}>
              <div className={styles.cardHeader}>
                <p className={styles.cardLabel}>Content</p>
                <span className={styles.muted}>Draft store</span>
              </div>
              <h2 className={styles.cardTitle}>
                {posts?.count ?? summary?.content.posts ?? 0} posts ·{" "}
                {pages?.count ?? summary?.content.pages ?? 0} pages
              </h2>
              <p className={styles.cardText}>
                Create and edit MDX pages, posts, and reusable content components.
              </p>
              <div className={styles.linkRow}>
                <button type="button" onClick={() => setArea("content")}>
                  Manage content
                </button>
                <Link href="/api/site-admin/pages/tree">Pages tree</Link>
              </div>
            </Card>

            <Card className={styles.card}>
              <div className={styles.cardHeader}>
                <p className={styles.cardLabel}>Now</p>
                <span className={styles.muted}>
                  {now?.data.updates.length ?? summary?.now.historyCount ?? 0} updates
                </span>
              </div>
              <h2 className={styles.cardTitle}>
                {formatValue(now?.data.current.text || summary?.now.text)}
              </h2>
              <p className={styles.cardText}>
                {now?.data.current.context ||
                  summary?.now.context ||
                  now?.data.current.location ||
                  summary?.now.location ||
                  "No extra context."}
              </p>
              <div className={styles.cardMeta}>
                <span>Updated</span>
                <strong>
                  {formatWhen(now?.data.current.updatedAt || summary?.now.updatedAt)}
                </strong>
              </div>
            </Card>

            <Card className={styles.card}>
              <div className={styles.cardHeader}>
                <p className={styles.cardLabel}>Calendar</p>
                <span className={styles.muted}>Public projection</span>
              </div>
              <h2 className={styles.cardTitle}>
                {summary?.calendar.eventCount ?? 0} events
              </h2>
              <p className={styles.cardText}>
                Range starts {formatWhen(summary?.calendar.rangeStartsAt)}.
              </p>
              <div className={styles.linkRow}>
                <Link href="/calendar">Calendar</Link>
                <Link href="/api/public/calendar">Public API</Link>
              </div>
            </Card>
          </section>

          <section className={styles.footerGrid}>
            <Card className={styles.wideCard}>
              <p className={styles.cardLabel}>Source</p>
              <dl className={styles.kvGrid}>
                <div>
                  <dt>Branch</dt>
                  <dd>{formatValue(source?.branch)}</dd>
                </div>
                <div>
                  <dt>Code</dt>
                  <dd>{shortSha(source?.codeSha)}</dd>
                </div>
                <div>
                  <dt>Content</dt>
                  <dd>{shortSha(source?.contentSha)}</dd>
                </div>
                <div>
                  <dt>Pending deploy</dt>
                  <dd>{source?.pendingDeploy === true ? "Yes" : "No"}</dd>
                </div>
              </dl>
            </Card>

            <Card className={styles.wideCard}>
              <p className={styles.cardLabel}>Online management</p>
              <p className={styles.cardText}>
                Browser editing writes to the same draft content store as desktop
                and iOS. Publish from the existing Release Center after reviewing
                changes.
              </p>
              <div className={styles.linkRow}>
                <Link href="/api/site-admin/mobile/summary">Mobile summary</Link>
                <Link href="/api/site-admin/release-jobs">Release jobs</Link>
              </div>
            </Card>
          </section>
        </>
      ) : null}

      {area === "content" ? (
        <section className={styles.workspaceGrid}>
          <Card className={styles.sidePanel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.cardLabel}>Content</p>
                <h2 className={styles.panelTitle}>{titleForKind(kind)}</h2>
              </div>
            </div>
            <div className={styles.segmented} role="group" aria-label="Content type">
              {(["posts", "pages", "components"] as EditableKind[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  data-active={kind === value}
                  onClick={() => {
                    setKind(value);
                    setSelected(null);
                    setSourceDraft("");
                  }}
                >
                  {titleForKind(value)}
                </button>
              ))}
            </div>
            <div className={styles.itemList}>
              {currentItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={styles.itemButton}
                  data-active={selected?.kind === kind && selected?.id === item.id}
                  onClick={() => void selectContent(kind, item.id)}
                >
                  <span>{item.title}</span>
                  <small>
                    {item.draft ? "Draft · " : ""}
                    {item.meta}
                  </small>
                </button>
              ))}
            </div>
          </Card>

          <Card className={styles.editorPanel}>
            {selected ? (
              <>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.cardLabel}>{titleForKind(selected.kind)}</p>
                    <h2 className={styles.panelTitle}>{selected.title}</h2>
                    <p className={styles.cardText}>{selected.meta}</p>
                  </div>
                  <div className={styles.panelActions}>
                    {selected.href ? (
                      <Button href={selected.href} variant="ghost" size="sm">
                        Open
                      </Button>
                    ) : null}
                    {isDeleteSupported(selected.kind) ? (
                      <Button
                        onClick={() => void deleteSelectedContent()}
                        variant="subtle"
                        tone="danger"
                        size="sm"
                        disabled={saving}
                      >
                        Delete
                      </Button>
                    ) : null}
                    <Button
                      onClick={() => void saveSelectedContent()}
                      tone="accent"
                      size="sm"
                      disabled={saving || sourceDraft === selected.source}
                    >
                      {saving ? "Saving" : "Save"}
                    </Button>
                  </div>
                </div>
                <textarea
                  className={styles.codeEditor}
                  value={sourceDraft}
                  onChange={(event) => setSourceDraft(event.target.value)}
                  spellCheck={false}
                />
                <p className={styles.editorHint}>
                  Version {shortSha(selected.version)}. Saves use optimistic conflict
                  protection; reload if another client changed this file.
                </p>
              </>
            ) : (
              <div className={styles.emptyEditor}>
                <p className={styles.cardLabel}>Editor</p>
                <h2 className={styles.panelTitle}>Select an item</h2>
                <p className={styles.cardText}>
                  Choose a post, page, or component from the list to edit raw MDX.
                </p>
              </div>
            )}
          </Card>

          <Card className={styles.createPanel}>
            <p className={styles.cardLabel}>New content</p>
            <div className={styles.segmented} role="group" aria-label="New content type">
              {(["posts", "pages"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  data-active={createKind === value}
                  onClick={() => {
                    setCreateKind(value);
                    setCreateSource(value === "posts" ? DEFAULT_POST_SOURCE : DEFAULT_PAGE_SOURCE);
                  }}
                >
                  {titleForKind(value)}
                </button>
              ))}
            </div>
            <label className={styles.fieldLabel}>
              Slug
              <input
                className={styles.textField}
                value={createSlug}
                onChange={(event) => setCreateSlug(event.target.value)}
                placeholder={createKind === "posts" ? "new-post-slug" : "new-page"}
              />
            </label>
            <textarea
              className={styles.createEditor}
              value={createSource}
              onChange={(event) => setCreateSource(event.target.value)}
              spellCheck={false}
            />
            <Button
              onClick={() => void createContent()}
              tone="accent"
              disabled={saving || !createSlug.trim()}
            >
              Create {createKind === "posts" ? "post" : "page"}
            </Button>
          </Card>
        </section>
      ) : null}

      {area === "home" ? (
        <Card className={styles.formPanel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.cardLabel}>Home</p>
              <h2 className={styles.panelTitle}>Landing page MDX</h2>
            </div>
            <Button
              onClick={() => void saveHome()}
              tone="accent"
              disabled={!home || saving}
            >
              {saving ? "Saving" : "Save Home"}
            </Button>
          </div>
          <label className={styles.fieldLabel}>
            Title
            <input
              className={styles.textField}
              value={homeTitle}
              onChange={(event) => setHomeTitle(event.target.value)}
            />
          </label>
          <label className={styles.fieldLabel}>
            Body MDX
            <textarea
              className={styles.largeEditor}
              value={homeBody}
              onChange={(event) => setHomeBody(event.target.value)}
              spellCheck={false}
            />
          </label>
          <p className={styles.editorHint}>
            Source version {shortSha(home?.sourceVersion.fileSha)}. Empty body MDX
            renders the public home shell only.
          </p>
        </Card>
      ) : null}

      {area === "now" ? (
        <section className={styles.nowGrid}>
          <Card className={styles.formPanel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.cardLabel}>Now</p>
                <h2 className={styles.panelTitle}>Current status</h2>
              </div>
              <Button onClick={() => void saveNow()} tone="accent" disabled={!now || saving}>
                {saving ? "Saving" : "Publish draft"}
              </Button>
            </div>
            <label className={styles.fieldLabel}>
              Status
              <textarea
                className={styles.nowEditor}
                value={nowText}
                onChange={(event) => setNowText(event.target.value)}
              />
            </label>
            <div className={styles.fieldGrid}>
              <label className={styles.fieldLabel}>
                Date
                <input
                  className={styles.textField}
                  type="date"
                  value={nowDate}
                  onChange={(event) => setNowDate(event.target.value)}
                />
              </label>
              <label className={styles.fieldLabel}>
                Context
                <input
                  className={styles.textField}
                  value={nowContext}
                  onChange={(event) => setNowContext(event.target.value)}
                />
              </label>
              <label className={styles.fieldLabel}>
                Location
                <input
                  className={styles.textField}
                  value={nowLocation}
                  onChange={(event) => setNowLocation(event.target.value)}
                />
              </label>
            </div>
            <p className={styles.editorHint}>
              Saves update the draft Now file. Publish through Release Center when
              ready for the public site.
            </p>
          </Card>

          <Card className={styles.historyPanel}>
            <p className={styles.cardLabel}>History</p>
            <div className={styles.historyList}>
              {(now?.data.updates || []).map((item) => (
                <div key={item.id} className={styles.historyItem}>
                  {editingHistoryId === item.id ? (
                    <>
                      <textarea
                        className={styles.historyEditor}
                        value={historyText}
                        onChange={(event) => setHistoryText(event.target.value)}
                      />
                      <div className={styles.historyActions}>
                        <input
                          className={styles.textField}
                          type="date"
                          value={historyDate}
                          onChange={(event) => setHistoryDate(event.target.value)}
                        />
                        <Button
                          onClick={() => void saveHistoryEdit()}
                          tone="accent"
                          size="sm"
                          disabled={saving}
                        >
                          Save
                        </Button>
                        <Button
                          onClick={() => setEditingHistoryId("")}
                          variant="ghost"
                          size="sm"
                        >
                          Cancel
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p>{item.text}</p>
                      <small>{formatWhen(item.at)}</small>
                      <div className={styles.historyActions}>
                        <Button
                          onClick={() => startHistoryEdit(item)}
                          variant="subtle"
                          size="sm"
                        >
                          Edit
                        </Button>
                        <Button
                          onClick={() => void deleteHistory(item.id)}
                          variant="ghost"
                          tone="danger"
                          size="sm"
                          disabled={saving}
                        >
                          Delete
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </section>
      ) : null}
    </main>
  );
}
