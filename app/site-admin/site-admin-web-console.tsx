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
import { SiteAdminMarkdownEditor } from "./site-admin-markdown-editor";
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
  dateIso?: string;
  dateText?: string;
  description?: string | null;
  updatedIso?: string;
  draft?: boolean;
  version: string;
  source: string;
  body?: string;
  frontmatter?: EditableFrontmatterPayload;
  frontmatterKeys?: string[];
  definition?: ComponentDefinition;
  summary?: ComponentSummary;
};

type EditableFrontmatterPayload = {
  title?: string;
  description?: string;
  date?: string;
  updated?: string;
  draft?: boolean;
  tags?: string[];
  cover?: string;
  ogImage?: string;
};

type EditableContentForm = {
  title: string;
  description: string;
  date: string;
  updated: string;
  draft: boolean;
  tags: string;
  cover: string;
  ogImage: string;
  body: string;
  frontmatterKeys: string[];
};

type LocalDraftSnapshot = {
  key: string;
  source: string;
  form?: EditableContentForm;
  savedAt: string;
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
type ContentMode = "browse" | "edit" | "create";

const DEFAULT_CREATE_BODY = "Write the post here.";

const EMPTY_CONTENT_FORM: EditableContentForm = {
  title: "",
  description: "",
  date: "",
  updated: "",
  draft: false,
  tags: "",
  cover: "",
  ogImage: "",
  body: "",
  frontmatterKeys: [],
};

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

function isUnauthorizedMessage(value: string) {
  return /\b(401|unauthorized)\b/i.test(value);
}

function slugFromTitle(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/['"]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "untitled"
  );
}

function frontmatterString(value: string) {
  return JSON.stringify(value.trim());
}

function frontmatterLine(key: string, value: string) {
  const trimmed = value.trim();
  return trimmed ? [`${key}: ${frontmatterString(trimmed)}`] : [];
}

function tagArrayFromText(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function tagTextFromArray(value: string[] | undefined) {
  return (value || []).join(", ");
}

function sourceForNewContent(input: {
  kind: "posts" | "pages";
  title: string;
  description: string;
  date: string;
  body: string;
}) {
  const title = input.title.trim() || (input.kind === "posts" ? "Untitled Post" : "Untitled Page");
  const description = input.description.trim();
  const body = input.body.trim() || (input.kind === "posts" ? "Write the post here." : "Write the page here.");
  const lines = [
    "---",
    `title: ${frontmatterString(title)}`,
    ...(input.kind === "posts" ? [`date: ${input.date || todayInHalifax()}`] : []),
    `description: ${frontmatterString(description)}`,
    "draft: true",
    "---",
    "",
    body,
    "",
  ];
  return lines.join("\n");
}

function sourceForEditedContent(kind: EditableKind, form: EditableContentForm) {
  if (kind === "components") return form.body;
  const title = form.title.trim() || (kind === "posts" ? "Untitled Post" : "Untitled Page");
  const tags = tagArrayFromText(form.tags);
  const hasKey = (key: string) => form.frontmatterKeys.includes(key);
  const lines = [
    "---",
    `title: ${frontmatterString(title)}`,
    ...(kind === "posts" ? [`date: ${form.date || todayInHalifax()}`] : []),
    ...(hasKey("description") || form.description.trim()
      ? [`description: ${frontmatterString(form.description)}`]
      : []),
    ...(kind === "pages" && (hasKey("updated") || form.updated) && form.updated
      ? [`updated: ${form.updated}`]
      : []),
    ...(kind === "posts" && (hasKey("tags") || tags.length > 0) && tags.length > 0
      ? ["tags:", ...tags.map((tag) => `  - ${frontmatterString(tag)}`)]
      : []),
    ...(hasKey("cover") || form.cover.trim() ? frontmatterLine("cover", form.cover) : []),
    ...(hasKey("ogImage") || form.ogImage.trim() ? frontmatterLine("ogImage", form.ogImage) : []),
    ...(hasKey("draft") || form.draft ? [`draft: ${form.draft ? "true" : "false"}`] : []),
    "---",
    "",
    form.body.trimEnd(),
    "",
  ];
  return lines.join("\n");
}

function formFromEditablePayload(
  kind: EditableKind,
  id: string,
  payload: EditableDetailPayload,
): EditableContentForm {
  if (kind === "components") {
    return { ...EMPTY_CONTENT_FORM, title: payload.title || id, body: payload.source || "" };
  }
  const frontmatter = payload.frontmatter || {};
  return {
    title: frontmatter.title || payload.title || id,
    description: frontmatter.description || payload.description || "",
    date: frontmatter.date || payload.dateIso || todayInHalifax(),
    updated: frontmatter.updated || (payload.updatedIso ? dateInputFromIso(payload.updatedIso) : ""),
    draft: Boolean(frontmatter.draft ?? payload.draft),
    tags: tagTextFromArray(frontmatter.tags),
    cover: frontmatter.cover || "",
    ogImage: frontmatter.ogImage || "",
    body: payload.body ?? payload.source ?? "",
    frontmatterKeys: payload.frontmatterKeys || [],
  };
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

function localDraftKey(kind: EditableKind, id: string) {
  return `site-admin-content-draft:${kind}:${id}`;
}

function readLocalDraft(kind: EditableKind, id: string): LocalDraftSnapshot | null {
  if (typeof window === "undefined") return null;
  const key = localDraftKey(kind, id);
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalDraftSnapshot>;
    if (typeof parsed.source !== "string" || typeof parsed.savedAt !== "string") return null;
    return {
      key,
      source: parsed.source,
      form: parsed.form,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

function clearLocalDraft(kind: EditableKind, id: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(localDraftKey(kind, id));
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
  const [contentMode, setContentMode] = useState<ContentMode>("browse");
  const [selected, setSelected] = useState<EditableDetail | null>(null);
  const [sourceDraft, setSourceDraft] = useState("");
  const [contentForm, setContentForm] =
    useState<EditableContentForm>(EMPTY_CONTENT_FORM);
  const [contentFormBaseline, setContentFormBaseline] = useState("");
  const [slugDraft, setSlugDraft] = useState("");
  const [localAutosaveAt, setLocalAutosaveAt] = useState("");
  const [contentSavedAt, setContentSavedAt] = useState("");
  const [localDraftSnapshot, setLocalDraftSnapshot] =
    useState<LocalDraftSnapshot | null>(null);
  const [createKind, setCreateKind] = useState<"posts" | "pages">("posts");
  const [createSlug, setCreateSlug] = useState("");
  const [createTitle, setCreateTitle] = useState("Untitled Post");
  const [createDescription, setCreateDescription] = useState("");
  const [createDate, setCreateDate] = useState(todayInHalifax());
  const [createBody, setCreateBody] = useState(DEFAULT_CREATE_BODY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [releaseSaving, setReleaseSaving] = useState(false);
  const [releaseWatchUntil, setReleaseWatchUntil] = useState(0);
  const [notice, setNotice] = useState("");
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");

  const currentItems = useMemo(
    () => contentItems({ kind, pages, posts, components }),
    [kind, pages, posts, components],
  );
  const release = summary?.release;
  const source = summary?.source;
  const selectedIsStructured = selected?.kind === "posts" || selected?.kind === "pages";
  const selectedSourceDraft = selected
    ? selectedIsStructured
      ? sourceForEditedContent(selected.kind, contentForm)
      : sourceDraft
    : "";
  const selectedDirty = Boolean(
    selected &&
      (selectedIsStructured
        ? selectedSourceDraft !== contentFormBaseline
        : selectedSourceDraft !== selected.source),
  );
  const slugDirty = Boolean(
    selected &&
      (selected.kind === "posts" || selected.kind === "pages") &&
      slugDraft.trim() &&
      slugDraft.trim() !== selected.id,
  );
  const releaseActionKind = release?.recommendedAction.kind;
  const releaseNeedsPublish = releaseActionKind === "smart-release";
  const releaseIsRunning = releaseActionKind === "watch-release";
  const releaseUnavailable = releaseActionKind === "refresh" || !release?.recommendedAction;
  const draftStatusState = saving
    ? "saving"
    : selectedDirty
      ? "smart-release"
      : "noop";
  const draftStatusLabel = saving
    ? "Saving draft"
    : selectedDirty
      ? "Unsaved edits"
      : contentSavedAt
        ? "Saved to Draft"
        : "Saved draft";
  const liveStatusState = selectedDirty
    ? "blocked"
    : releaseIsRunning
      ? "saving"
      : releaseNeedsPublish
        ? "smart-release"
        : releaseActionKind === "noop"
          ? "noop"
          : "blocked";
  const liveStatusLabel = selectedDirty
    ? "Save before publishing"
    : releaseIsRunning
      ? "Release running"
      : releaseNeedsPublish
        ? "Ready to publish"
        : releaseActionKind === "noop"
          ? "Live current"
          : "Release unavailable";
  const editorStatusHint = selectedDirty
    ? localAutosaveAt
      ? `Local recovery saved ${formatWhen(localAutosaveAt)}. Save to Draft before publishing.`
      : "Unsaved edits are only in this browser until saved to Draft."
    : releaseNeedsPublish
      ? release?.detail || "Saved Draft is ahead of the live site."
      : contentSavedAt
        ? `Saved to Draft ${formatWhen(contentSavedAt)}. ${release?.detail || ""}`.trim()
        : release?.headline || "Release status unavailable";
  const publishButtonLabel = releaseSaving
    ? "Starting"
    : selectedDirty
      ? "Save first"
      : releaseActionKind === "noop"
        ? "Live current"
        : releaseUnavailable
          ? "Refresh status"
          : "Publish draft";

  async function refreshAll() {
    setLoading(true);
    setError("");
    setWarning("");
    const results = await Promise.allSettled([
      readJson<SummaryPayload>("/api/site-admin/mobile/summary"),
      readJson<HomePayload>("/api/site-admin/home"),
      readJson<NowPayload>("/api/site-admin/now"),
      readJson<PagesPayload>("/api/site-admin/pages?drafts=1"),
      readJson<PostsPayload>("/api/site-admin/posts?drafts=1"),
      readJson<ComponentsPayload>("/api/site-admin/components"),
    ]);
    const failures: { scope: string; message: string }[] = [];
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
      failures.push({ scope: "Home", message: homeResult.reason?.message || "failed" });
    }

    if (nowResult.status === "fulfilled") {
      setNow(nowResult.value);
      setNowText(nowResult.value.data.current.text || "");
      setNowContext(nowResult.value.data.current.context || "");
      setNowLocation(nowResult.value.data.current.location || "");
      setNowDate(dateInputFromIso(nowResult.value.data.current.updatedAt));
    } else {
      failures.push({ scope: "Now", message: nowResult.reason?.message || "failed" });
    }

    if (pagesResult.status === "fulfilled") {
      setPages(pagesResult.value);
    } else {
      failures.push({ scope: "Pages", message: pagesResult.reason?.message || "failed" });
    }

    if (postsResult.status === "fulfilled") {
      setPosts(postsResult.value);
    } else {
      failures.push({ scope: "Posts", message: postsResult.reason?.message || "failed" });
    }

    if (componentsResult.status === "fulfilled") {
      setComponents(componentsResult.value);
    } else {
      failures.push({
        scope: "Components",
        message: componentsResult.reason?.message || "failed",
      });
    }

    if (failures.length > 0) {
      const authFailures = failures.filter((failure) =>
        isUnauthorizedMessage(failure.message),
      );
      const blockingFailures = failures.filter(
        (failure) => !isUnauthorizedMessage(failure.message),
      );
      if (authFailures.length > 0) {
        setWarning(
          authFailures.length === failures.length
            ? "Your browser session is signed in, but admin API access needs a fresh sign-in. Refresh the session if content does not load."
            : `Some admin data needs a fresh sign-in: ${authFailures
                .map((failure) => failure.scope)
                .join(", ")}.`,
        );
      }
      if (blockingFailures.length > 0) {
        setError(
          blockingFailures
            .map((failure) => `${failure.scope}: ${failure.message}`)
            .join(" · "),
        );
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    if (!selected || !selectedDirty) return;
    const key = localDraftKey(selected.kind, selected.id);
    const source = selectedSourceDraft;
    const form = selectedIsStructured ? contentForm : undefined;
    const timer = window.setTimeout(() => {
      const savedAt = new Date().toISOString();
      window.sessionStorage.setItem(
        key,
        JSON.stringify({
          source,
          form,
          savedAt,
        }),
      );
      setLocalAutosaveAt(savedAt);
      setLocalDraftSnapshot(null);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [
    contentForm,
    selected,
    selectedDirty,
    selectedIsStructured,
    selectedSourceDraft,
  ]);

  useEffect(() => {
    if (!releaseWatchUntil) return;
    if (Date.now() >= releaseWatchUntil) {
      setReleaseWatchUntil(0);
      return;
    }
    const timer = window.setTimeout(() => {
      void refreshSummaryOnly();
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [releaseWatchUntil, summary?.release.recommendedAction.kind]);

  async function refreshSummaryOnly() {
    try {
      const next = await readJson<SummaryPayload>("/api/site-admin/mobile/summary");
      setSummary(next.summary);
      setSummaryError("");
      const action = next.summary.release.recommendedAction.kind;
      if (action === "noop" || action === "smart-release") {
        setReleaseWatchUntil(0);
      }
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : String(err));
    }
  }

  async function selectContent(nextKind: EditableKind, id: string) {
    setLoading(true);
    setError("");
    setWarning("");
    setNotice("");
    try {
      const detail = await readJson<EditableDetailPayload>(
        endpointFor(nextKind, id),
      );
      const next = toEditableDetail(nextKind, id, detail);
      setKind(nextKind);
      setContentMode("edit");
      setSelected(next);
      setSourceDraft(next.source);
      setSlugDraft(id);
      const form = formFromEditablePayload(nextKind, id, detail);
      setContentForm(form);
      const baseline =
        nextKind === "posts" || nextKind === "pages"
          ? sourceForEditedContent(nextKind, form)
          : next.source;
      setContentFormBaseline(baseline);
      setLocalAutosaveAt("");
      setContentSavedAt("");
      const localDraft = readLocalDraft(nextKind, id);
      setLocalDraftSnapshot(
        localDraft && localDraft.source !== baseline ? localDraft : null,
      );
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
    setWarning("");
    setNotice("");
    try {
      await writeJson<MutationPayload>(endpointFor(selected.kind, selected.id), "PATCH", {
        source: selectedSourceDraft,
        version: selected.version,
      });
      const detail = await readJson<EditableDetailPayload>(
        endpointFor(selected.kind, selected.id),
      );
      const next = toEditableDetail(selected.kind, selected.id, detail);
      setSelected(next);
      setSourceDraft(next.source);
      setSlugDraft(next.id);
      const form = formFromEditablePayload(selected.kind, selected.id, detail);
      setContentForm(form);
      setContentFormBaseline(
        selected.kind === "posts" || selected.kind === "pages"
          ? sourceForEditedContent(selected.kind, form)
          : next.source,
      );
      clearLocalDraft(selected.kind, selected.id);
      setLocalAutosaveAt("");
      setContentSavedAt(new Date().toISOString());
      setLocalDraftSnapshot(null);
      await refreshLists();
      await refreshSummaryOnly();
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
    setWarning("");
    setNotice("");
    try {
      await writeJson<{ ok: true }>(endpointFor(selected.kind, selected.id), "DELETE", {
        version: selected.version,
      });
      setContentMode("browse");
      setSelected(null);
      setSourceDraft("");
      setContentForm(EMPTY_CONTENT_FORM);
      setContentFormBaseline("");
      setSlugDraft("");
      clearLocalDraft(selected.kind, selected.id);
      setLocalAutosaveAt("");
      setContentSavedAt("");
      setLocalDraftSnapshot(null);
      await refreshLists();
      await refreshSummaryOnly();
      setNotice(`${selected.title} deleted.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function moveSelectedContent() {
    if (!selected || !isDeleteSupported(selected.kind)) return;
    const toSlug = slugDraft.trim();
    if (!toSlug || toSlug === selected.id) return;
    if (selectedDirty) {
      setError("Save content changes before renaming the slug.");
      return;
    }
    const confirmed = window.confirm(`Rename ${selected.id} to ${toSlug}?`);
    if (!confirmed) return;
    setSaving(true);
    setError("");
    setWarning("");
    setNotice("");
    try {
      const endpoint =
        selected.kind === "posts"
          ? "/api/site-admin/posts/move"
          : "/api/site-admin/pages/move";
      const moved = await writeJson<{ toSlug?: string; version?: string }>(
        endpoint,
        "POST",
        {
          fromSlug: selected.id,
          toSlug,
          version: selected.version,
        },
      );
      await refreshLists();
      await selectContent(selected.kind, moved.toSlug || toSlug);
      await refreshSummaryOnly();
      setNotice(`${selected.title} renamed.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function restoreLocalDraft() {
    if (!selected || !localDraftSnapshot) return;
    if (selected.kind === "posts" || selected.kind === "pages") {
      if (!localDraftSnapshot.form) {
        setError("This local autosave cannot be restored into the structured editor.");
        return;
      }
      setContentForm(localDraftSnapshot.form);
    } else {
      setSourceDraft(localDraftSnapshot.source);
    }
    setLocalAutosaveAt(localDraftSnapshot.savedAt);
    setLocalDraftSnapshot(null);
    setNotice("Local autosave restored.");
  }

  function beginCreate(nextKind?: "posts" | "pages") {
    const resolvedKind = nextKind ?? (kind === "pages" ? "pages" : "posts");
    setContentMode("create");
    setSelected(null);
    setSourceDraft("");
    setContentForm(EMPTY_CONTENT_FORM);
    setContentFormBaseline("");
    setSlugDraft("");
    setLocalAutosaveAt("");
    setContentSavedAt("");
    setLocalDraftSnapshot(null);
    setCreateKind(resolvedKind);
    setCreateSlug("");
    setCreateTitle(resolvedKind === "posts" ? "Untitled Post" : "Untitled Page");
    setCreateDescription("");
    setCreateDate(todayInHalifax());
    setCreateBody(resolvedKind === "posts" ? "Write the post here." : "Write the page here.");
  }

  async function createContent() {
    const slug = createSlug.trim() || slugFromTitle(createTitle);
    if (!slug) {
      setError("Slug is required.");
      return;
    }
    setSaving(true);
    setError("");
    setWarning("");
    setNotice("");
    try {
      await writeJson<CreatePayload>(`/api/site-admin/${createKind}`, "POST", {
        slug,
        source: sourceForNewContent({
          kind: createKind,
          title: createTitle,
          description: createDescription,
          date: createDate,
          body: createBody,
        }),
      });
      await refreshLists();
      await selectContent(createKind, slug);
      setContentSavedAt(new Date().toISOString());
      await refreshSummaryOnly();
      setCreateSlug("");
      setCreateTitle(createKind === "posts" ? "Untitled Post" : "Untitled Page");
      setCreateDescription("");
      setCreateDate(todayInHalifax());
      setCreateBody(createKind === "posts" ? "Write the post here." : "Write the page here.");
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

  async function runSmartRelease() {
    setReleaseSaving(true);
    setError("");
    setWarning("");
    setNotice("");
    try {
      const payload = await writeJson<{ job?: { id?: string } }>(
        "/api/site-admin/release-jobs/smart",
        "POST",
        {
          request: {
            source: "site-admin-web-console",
            area,
          },
        },
      );
      const jobId = payload.job?.id ? ` (${payload.job.id})` : "";
      setNotice(`Release job created${jobId}.`);
      setReleaseWatchUntil(Date.now() + 3 * 60 * 1000);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReleaseSaving(false);
    }
  }

  async function saveHome() {
    if (!home) return;
    setSaving(true);
    setError("");
    setWarning("");
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
    setWarning("");
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
    setWarning("");
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
    setWarning("");
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

  const resolvedCreateSlug = createSlug.trim() || slugFromTitle(createTitle);

  return (
    <main className={styles.shell} data-area={area}>
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

      {notice ? <StatusNotice tone="success">{notice}</StatusNotice> : null}
      {warning ? <StatusNotice tone="warning">{warning}</StatusNotice> : null}
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
                  {release?.recommendedAction.label || (summaryError ? "Unavailable" : "Refresh")}
                </span>
              </div>
              <h2 className={styles.cardTitle}>
                {release?.headline ||
                  (summaryError ? "Release status unavailable" : "Status unavailable")}
              </h2>
              <p className={styles.cardText}>
                {release?.detail ||
                  (summaryError
                    ? `Could not load release summary: ${summaryError}. Content editing is still available.`
                    : "Refresh release status.")}
              </p>
              <div className={styles.cardMeta}>
                <span>Runner</span>
                <strong>
                  {release?.runners?.[0]?.status ||
                    (summaryError ? "Unavailable" : "Not seen")}
                </strong>
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
        <section className={`${styles.workspaceGrid} ${styles.contentWorkspace}`}>
          <Card className={styles.sidePanel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.cardLabel}>Content</p>
                <h2 className={styles.panelTitle}>{titleForKind(kind)}</h2>
              </div>
              <Button
                onClick={() => beginCreate(kind === "pages" ? "pages" : "posts")}
                variant="subtle"
                size="sm"
              >
                New
              </Button>
            </div>
            <div className={styles.segmented} role="group" aria-label="Content type">
              {(["posts", "pages", "components"] as EditableKind[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  data-active={kind === value}
                  onClick={() => {
                    setKind(value);
                    setContentMode("browse");
                    setSelected(null);
                    setSourceDraft("");
                    setContentForm(EMPTY_CONTENT_FORM);
                    setContentFormBaseline("");
                    setSlugDraft("");
                    setLocalAutosaveAt("");
                    setLocalDraftSnapshot(null);
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

          {contentMode === "create" ? (
            <Card className={`${styles.editorPanel} ${styles.createPanel}`}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.cardLabel}>New content</p>
                  <h2 className={styles.panelTitle}>
                    {createKind === "posts" ? "New post" : "New page"}
                  </h2>
                </div>
                <Button
                  onClick={() => setContentMode(selected ? "edit" : "browse")}
                  variant="subtle"
                  size="sm"
                >
                  Cancel
                </Button>
              </div>
              <div className={styles.segmented} role="group" aria-label="New content type">
                {(["posts", "pages"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    data-active={createKind === value}
                    onClick={() => {
                      setCreateKind(value);
                      setCreateTitle(value === "posts" ? "Untitled Post" : "Untitled Page");
                      setCreateBody(value === "posts" ? "Write the post here." : "Write the page here.");
                    }}
                  >
                    {titleForKind(value)}
                  </button>
                ))}
              </div>
              <label className={styles.fieldLabel}>
                Title
                <input
                  className={styles.textField}
                  value={createTitle}
                  onChange={(event) => setCreateTitle(event.target.value)}
                />
              </label>
              <details className={styles.editorDetails}>
                <summary>
                  <span>Metadata</span>
                  <small>
                    {resolvedCreateSlug}
                    {createKind === "posts" ? ` · ${createDate}` : ""}
                    {createDescription.trim() ? " · Description set" : ""}
                  </small>
                </summary>
                <div className={styles.editorDetailsBody}>
                  <label className={styles.fieldLabel}>
                    Slug
                    <input
                      className={styles.textField}
                      value={createSlug}
                      onChange={(event) => setCreateSlug(event.target.value)}
                      placeholder={resolvedCreateSlug}
                    />
                  </label>
                  {createKind === "posts" ? (
                    <label className={styles.fieldLabel}>
                      Date
                      <input
                        className={styles.textField}
                        type="date"
                        value={createDate}
                        onChange={(event) => setCreateDate(event.target.value)}
                      />
                    </label>
                  ) : null}
                  <label className={styles.fieldLabel}>
                    Description
                    <input
                      className={styles.textField}
                      value={createDescription}
                      onChange={(event) => setCreateDescription(event.target.value)}
                      placeholder="Optional"
                    />
                  </label>
                </div>
              </details>
              <div className={styles.createEditorShell}>
                <SiteAdminMarkdownEditor
                  label="New content body"
                  value={createBody}
                  onChange={setCreateBody}
                  minHeight={460}
                  size="large"
                  disabled={saving}
                />
              </div>
              <Button
                onClick={() => void createContent()}
                tone="accent"
                disabled={saving || !resolvedCreateSlug}
              >
                Create {createKind === "posts" ? "post" : "page"}
              </Button>
            </Card>
          ) : selected ? (
            <Card className={styles.editorPanel}>
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
                      disabled={saving || !selectedDirty}
                    >
                      {saving ? "Saving" : "Save"}
                    </Button>
                  </div>
                </div>
                <div className={styles.editorStatusBar}>
                  <span className={styles.statusPill} data-state={draftStatusState}>
                    {draftStatusLabel}
                  </span>
                  {selectedIsStructured ? (
                    <span className={styles.statusPill} data-state={contentForm.draft ? "smart-release" : "noop"}>
                      {contentForm.draft ? "Draft" : "Public"}
                    </span>
                  ) : null}
                  <span className={styles.statusPill} data-state={liveStatusState}>
                    {liveStatusLabel}
                  </span>
                  <span className={styles.editorHint}>
                    {editorStatusHint}
                  </span>
                  <div className={styles.editorStatusActions}>
                    {localDraftSnapshot ? (
                      <Button
                        onClick={restoreLocalDraft}
                        variant="subtle"
                        tone="warning"
                        size="sm"
                      >
                        Restore local draft
                      </Button>
                    ) : null}
                    {release?.recommendedAction.kind === "watch-release" ? (
                      <Button href="/api/site-admin/release-jobs" variant="subtle" size="sm">
                        View release
                      </Button>
                    ) : (
                      <Button
                        onClick={() => void runSmartRelease()}
                        variant={release?.recommendedAction.kind === "noop" ? "subtle" : "solid"}
                        tone={release?.recommendedAction.kind === "noop" ? "neutral" : "accent"}
                        size="sm"
                        disabled={
                          releaseSaving ||
                          selectedDirty ||
                          release?.recommendedAction.kind === "noop" ||
                          release?.recommendedAction.kind === "refresh" ||
                          !release?.recommendedAction
                        }
                      >
                        {publishButtonLabel}
                      </Button>
                    )}
                  </div>
                </div>
                {selectedIsStructured ? (
                  <>
                    <div className={styles.editorPrimaryGrid}>
                      <label className={styles.fieldLabel}>
                        Title
                        <input
                          className={styles.textField}
                          value={contentForm.title}
                          onChange={(event) =>
                            setContentForm((current) => ({
                              ...current,
                              title: event.target.value,
                            }))
                          }
                        />
                      </label>
                      {selected.kind === "posts" ? (
                        <label className={styles.fieldLabel}>
                          Date
                          <input
                            className={styles.textField}
                            type="date"
                            value={contentForm.date}
                            onChange={(event) =>
                              setContentForm((current) => ({
                                ...current,
                                date: event.target.value,
                              }))
                            }
                          />
                        </label>
                      ) : (
                        <label className={styles.fieldLabel}>
                          Updated
                          <input
                            className={styles.textField}
                            type="date"
                            value={contentForm.updated}
                            onChange={(event) =>
                              setContentForm((current) => ({
                                ...current,
                                updated: event.target.value,
                              }))
                            }
                          />
                        </label>
                      )}
                      <label className={styles.checkField}>
                        <input
                          type="checkbox"
                          checked={contentForm.draft}
                          onChange={(event) =>
                            setContentForm((current) => ({
                              ...current,
                              draft: event.target.checked,
                            }))
                          }
                        />
                        Draft
                      </label>
                    </div>
                    <details className={styles.editorDetails}>
                      <summary>
                        <span>Metadata</span>
                        <small>
                          {slugDraft || selected.id}
                          {contentForm.description.trim() ? " · Description set" : ""}
                        </small>
                      </summary>
                      <div className={styles.editorDetailsBody}>
                        {isDeleteSupported(selected.kind) ? (
                          <div className={styles.slugMoveRow}>
                            <label className={styles.fieldLabel}>
                              Slug
                              <input
                                className={styles.textField}
                                value={slugDraft}
                                onChange={(event) => setSlugDraft(event.target.value)}
                                spellCheck={false}
                              />
                            </label>
                            <Button
                              onClick={() => void moveSelectedContent()}
                              variant="subtle"
                              size="sm"
                              disabled={saving || selectedDirty || !slugDirty}
                            >
                              Rename
                            </Button>
                          </div>
                        ) : null}
                        <label className={styles.fieldLabel}>
                          Description
                          <input
                            className={styles.textField}
                            value={contentForm.description}
                            onChange={(event) =>
                              setContentForm((current) => ({
                                ...current,
                                description: event.target.value,
                              }))
                            }
                            placeholder="Optional"
                          />
                        </label>
                        {selected.kind === "posts" ? (
                          <div className={styles.editorMetaGrid}>
                            <label className={styles.fieldLabel}>
                              Tags
                              <input
                                className={styles.textField}
                                value={contentForm.tags}
                                onChange={(event) =>
                                  setContentForm((current) => ({
                                    ...current,
                                    tags: event.target.value,
                                  }))
                                }
                                placeholder="Comma separated"
                              />
                            </label>
                            <label className={styles.fieldLabel}>
                              Cover
                              <input
                                className={styles.textField}
                                value={contentForm.cover}
                                onChange={(event) =>
                                  setContentForm((current) => ({
                                    ...current,
                                    cover: event.target.value,
                                  }))
                                }
                                placeholder="Optional"
                              />
                            </label>
                            <label className={styles.fieldLabel}>
                              OG image
                              <input
                                className={styles.textField}
                                value={contentForm.ogImage}
                                onChange={(event) =>
                                  setContentForm((current) => ({
                                    ...current,
                                    ogImage: event.target.value,
                                  }))
                                }
                                placeholder="Optional"
                              />
                            </label>
                          </div>
                        ) : null}
                      </div>
                    </details>
                    <div className={styles.editorBodyShell}>
                      <SiteAdminMarkdownEditor
                        label={`${selected.title} body`}
                        value={contentForm.body}
                        onChange={(body) =>
                          setContentForm((current) => ({
                            ...current,
                            body,
                          }))
                        }
                        minHeight={560}
                        size="large"
                        disabled={saving}
                        previewLayout="split"
                      />
                    </div>
                  </>
                ) : (
                  <div className={styles.editorBodyShell}>
                    <SiteAdminMarkdownEditor
                      label={`${selected.title} MDX source`}
                      value={sourceDraft}
                      onChange={setSourceDraft}
                      minHeight={560}
                      size="large"
                      disabled={saving}
                    />
                  </div>
                )}
                <p className={styles.editorHint}>
                  Version {shortSha(selected.version)}. Saves use optimistic conflict
                  protection; reload if another client changed this file.
                </p>
            </Card>
          ) : (
            <Card className={styles.editorPanel}>
              <div className={styles.emptyEditor}>
                <p className={styles.cardLabel}>Editor</p>
                <h2 className={styles.panelTitle}>Select content</h2>
                <p className={styles.cardText}>
                  Choose an item from the list, or create a new post/page from the same workspace.
                </p>
                <div className={styles.emptyEditorActions}>
                  <Button
                    onClick={() => beginCreate(kind === "pages" ? "pages" : "posts")}
                    tone="accent"
                    size="sm"
                  >
                    New {kind === "pages" ? "page" : "post"}
                  </Button>
                </div>
              </div>
            </Card>
          )}
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
            <SiteAdminMarkdownEditor
              label="Home body MDX"
              value={homeBody}
              onChange={setHomeBody}
              minHeight={620}
              size="large"
              disabled={saving}
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
