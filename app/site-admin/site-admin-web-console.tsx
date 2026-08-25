"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";

import { SiteAdminStatusPanel } from "@/components/site-admin/status/panel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/loading-state";
import { StatusNotice } from "@/components/ui/status-notice";
import type {
  SiteAdminHomeData,
  SiteAdminNowData,
  SiteAdminNowUpdate,
} from "@/lib/site-admin/api-types";
import {
  SITE_COMPONENT_DEFINITIONS,
  isSiteComponentName,
  type SiteComponentName,
} from "@/lib/site-admin/component-registry";
import type { SiteAdminMobileSummary } from "@/lib/site-admin/mobile-summary";
import {
  contentListPlaceholder,
  contentSaveEffects,
  countLabel,
  createSelectionGate,
  editorialStatus,
  liveSyncStatus,
  releaseJobOutcome,
  visibilityLabel,
} from "./site-admin-console-model";
import {
  buildSiteAdminReleaseProgress,
  selectActiveReleaseJob,
  type SiteAdminReleaseJobLike,
  type SiteAdminReleaseRunnerLike,
} from "@/lib/site-admin/release-progress";
import {
  SiteAdminConflictDialog,
  type SiteAdminConflict,
} from "./site-admin-conflict-dialog";
import {
  StructuredCollectionDivider,
  StructuredCollectionEditor,
  StructuredCollectionEmpty,
  StructuredCollectionEntry,
  StructuredCollectionEntryForm,
} from "./site-admin-structured-collection-editor";
import {
  componentConflictDetail,
  componentEntryDomId,
  componentEntryFingerprint,
  componentEntryState as deriveComponentEntryState,
  componentItemMatches as matchesComponentItem,
  createComponentEntryId,
  moveDraftEntry,
  newsEntryIssues,
  parseNewsComponentDraft,
  parsePublicationsComponentDraft,
  parseTeachingComponentDraft,
  parseWorksComponentDraft,
  publicationEntryIssues,
  reorderDraftEntries,
  serializeNewsComponentDraft,
  serializePublicationsComponentDraft,
  serializeTeachingComponentDraft,
  serializeWorksComponentDraft,
  teachingEntryIssues,
  todayInHalifax,
  worksEntryIssues,
  type ComponentGrouping,
  type NewsComponentDraft,
  type NewsDraftEntry,
  type PublicationDraftEntry,
  type PublicationsComponentDraft,
  type TeachingComponentDraft,
  type TeachingDraftEntry,
  type WorksComponentDraft,
  type WorksDraftEntry,
} from "./site-admin-structured-collection-model";
import {
  NEWS_ENTRY_FIELDS,
  PUBLICATION_ENTRY_FIELDS,
  TEACHING_ENTRY_FIELDS,
  WORKS_ENTRY_FIELDS,
  structuredCollectionSearchValues,
} from "./site-admin-structured-collection-schema";
import { reorderWorksEntriesAcrossGroups } from "./site-admin-works-drag";
import {
  SiteAdminMediaLibrary,
  type SiteAdminAsset,
} from "./site-admin-media-library";
import { SiteAdminMarkdownEditor } from "./site-admin-markdown-editor";
import { SiteAdminPublishingProgress } from "./site-admin-publishing-progress";
import { SiteAdminSettingsPanel } from "./site-admin-settings-panel";
import { SiteAdminVersionHistory } from "./site-admin-version-history";
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

type ReleaseJobsPayload = {
  jobs: SiteAdminReleaseJobLike[];
  runners: {
    agents: SiteAdminReleaseRunnerLike[];
    queuedCount: number;
    runningCount: number;
  };
};

type ReleaseWakePayload = {
  configured: boolean;
  ok: boolean;
  status: number;
  error: string;
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
  name: SiteComponentName;
  label: string;
  description: string;
  primaryRoute?: string;
  entryLabel?: string;
  embedTag?: string;
};

type ComponentSummary = {
  count?: number;
  entryLabel?: string;
  rows?: { title: string; detail?: string; href?: string }[];
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

type Area = "content" | "media" | "release" | "settings" | "home" | "now";
type ContentMode = "browse" | "edit" | "create";

type ComponentReturnTarget = {
  kind: "posts" | "pages";
  id: string;
  title: string;
};

const DEFAULT_CREATE_BODY = "Write the post here.";
const COMPONENT_DEFINITIONS =
  SITE_COMPONENT_DEFINITIONS as readonly ComponentDefinition[];

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

function formatWhen(value: string | number | undefined) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
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

function componentDefinitionsFromPayload(
  payload: ComponentsPayload | null,
): readonly ComponentDefinition[] {
  return payload?.components?.length ? payload.components : COMPONENT_DEFINITIONS;
}

function componentSummaryFor(
  componentsPayload: ComponentsPayload | null,
  name: SiteComponentName,
): ComponentSummary | undefined {
  return componentsPayload?.summaries?.[name];
}

function findManagedComponentInBody(
  body: string,
  definitions: readonly ComponentDefinition[],
): ComponentDefinition | null {
  const source = String(body || "");
  return (
    definitions.find((definition) => {
      if (!definition.embedTag) return false;
      return new RegExp(`<${definition.embedTag}\\b`).test(source);
    }) ?? null
  );
}

function findManagedComponentForPage(
  page: PageListItem,
  definitions: readonly ComponentDefinition[],
): ComponentDefinition | null {
  return (
    definitions.find((definition) => {
      const route = definition.primaryRoute || `/${definition.name}`;
      return page.href === route || page.slug === definition.name;
    }) ?? null
  );
}

function managedComponentMeta(summary: ComponentSummary | undefined) {
  return `Managed · ${formatEntryCount(summary?.count ?? 0)}`;
}

function formatEntryCount(count: number) {
  return `${count} ${count === 1 ? "entry" : "entries"}`;
}

function sourceForNewContent(input: {
  kind: "posts" | "pages";
  title: string;
  description: string;
  date: string;
  body: string;
  visible: boolean;
}) {
  const title = input.title.trim() || (input.kind === "posts" ? "Untitled Post" : "Untitled Page");
  const description = input.description.trim();
  const body = input.body.trim() || (input.kind === "posts" ? "Write the post here." : "Write the page here.");
  const lines = [
    "---",
    `title: ${frontmatterString(title)}`,
    ...(input.kind === "posts" ? [`date: ${input.date || todayInHalifax()}`] : []),
    `description: ${frontmatterString(description)}`,
    `draft: ${input.visible ? "false" : "true"}`,
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

function versionPathFor(kind: EditableKind, id: string): string {
  if (kind === "posts") return `content/posts/${id}.mdx`;
  if (kind === "pages") return `content/pages/${id}.mdx`;
  return `content/components/${id}.mdx`;
}

function titleForKind(kind: EditableKind) {
  if (kind === "pages") return "Pages";
  if (kind === "posts") return "Posts";
  return "Components";
}

function localDraftKey(kind: EditableKind, id: string) {
  return `site-admin-content-draft:${kind}:${id}`;
}

const LOCAL_DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function readLocalDraft(kind: EditableKind, id: string): LocalDraftSnapshot | null {
  if (typeof window === "undefined") return null;
  const key = localDraftKey(kind, id);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalDraftSnapshot>;
    if (typeof parsed.source !== "string" || typeof parsed.savedAt !== "string") return null;
    const savedAtMs = Date.parse(parsed.savedAt);
    if (!Number.isFinite(savedAtMs) || Date.now() - savedAtMs > LOCAL_DRAFT_TTL_MS) {
      window.localStorage.removeItem(key);
      return null;
    }
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
  window.localStorage.removeItem(localDraftKey(kind, id));
}

class SiteAdminRequestError extends Error {
  status: number;
  code: string;
  payload: unknown;

  constructor(message: string, status: number, code = "", payload: unknown = null) {
    super(message);
    this.name = "SiteAdminRequestError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
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
    throw new SiteAdminRequestError(
      maybeError?.error ||
        `${response.status} ${response.statusText || "Request failed"}`,
      response.status,
      maybeError?.code || "",
      payload,
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

type ContentPublishAction =
  | "publish-content-staging"
  | "publish-content-production";

function contentPublishActionForBrowser(): ContentPublishAction | null {
  if (typeof window === "undefined") return null;
  const hostname = window.location.hostname.toLowerCase();
  if (hostname === "staging.jinkunchen.com") return "publish-content-staging";
  if (hostname === "jinkunchen.com" || hostname === "www.jinkunchen.com") {
    return "publish-content-production";
  }
  return null;
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
      ? formatEntryCount(payload.summary?.count ?? 0)
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
    const definitions = componentDefinitionsFromPayload(input.components);
    return (input.pages?.pages || []).map((item) => ({
      id: item.slug,
      title: item.title || item.slug,
      href: item.href,
      meta: (() => {
        const managed = findManagedComponentForPage(item, definitions);
        if (managed) {
          return managedComponentMeta(componentSummaryFor(input.components, managed.name));
        }
        return item.updatedIso ? formatWhen(item.updatedIso) : `${item.wordCount ?? 0} words`;
      })(),
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
  return componentDefinitionsFromPayload(input.components).map((item) => {
    const summary = componentSummaryFor(input.components, item.name);
    return {
      id: item.name,
      title: item.label || item.name,
      href: item.primaryRoute || "",
      meta: formatEntryCount(summary?.count ?? 0),
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
  const [area, setArea] = useState<Area>("content");
  const [summary, setSummary] = useState<SiteAdminMobileSummary | null>(
    initialSummary,
  );
  const [summaryError, setSummaryError] = useState(initialSummaryError);
  const [home, setHome] = useState<HomePayload | null>(null);
  const [homeTitle, setHomeTitle] = useState("");
  const [homeBody, setHomeBody] = useState("");
  const [homeBaseline, setHomeBaseline] = useState("");
  const [now, setNow] = useState<NowPayload | null>(null);
  const [nowText, setNowText] = useState("");
  const [nowContext, setNowContext] = useState("");
  const [nowLocation, setNowLocation] = useState("");
  const [nowDate, setNowDate] = useState(todayInHalifax());
  const [nowBaseline, setNowBaseline] = useState("");
  const [editingHistoryId, setEditingHistoryId] = useState("");
  const [historyText, setHistoryText] = useState("");
  const [historyDate, setHistoryDate] = useState(todayInHalifax());
  const [pages, setPages] = useState<PagesPayload | null>(null);
  const [posts, setPosts] = useState<PostsPayload | null>(null);
  const [components, setComponents] = useState<ComponentsPayload | null>(null);
  const [, setKind] = useState<EditableKind>("posts");
  const [documentKind, setDocumentKind] = useState<"posts" | "pages">("posts");
  const [contentMode, setContentMode] = useState<ContentMode>("browse");
  const [contentSearch, setContentSearch] = useState("");
  const [componentSearch, setComponentSearch] = useState("");
  const [componentGrouping, setComponentGrouping] =
    useState<ComponentGrouping>("auto");
  const [componentExpandedIds, setComponentExpandedIds] = useState<string[]>([]);
  const [componentDragId, setComponentDragId] = useState("");
  const [componentDropId, setComponentDropId] = useState("");
  const [componentReturnTarget, setComponentReturnTarget] =
    useState<ComponentReturnTarget | null>(null);
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
  // New content starts hidden, but the author can say otherwise up front
  // instead of hunting for the toggle in the Inspector afterwards.
  const [createVisible, setCreateVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Separate from `saving`: only mutations that replace the document under the
  // editor (delete, rename, conflict resolve, version restore) may lock it.
  const [blockingMutation, setBlockingMutation] = useState(false);
  const [releaseSaving, setReleaseSaving] = useState(false);
  const [releaseWatchUntil, setReleaseWatchUntil] = useState(0);
  const [releaseWatchJobId, setReleaseWatchJobId] = useState("");
  const [releaseActivity, setReleaseActivity] =
    useState<ReleaseJobsPayload | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [assetPickerTarget, setAssetPickerTarget] = useState<"cover" | "ogImage" | null>(null);
  const [conflict, setConflict] = useState<(SiteAdminConflict & {
    remote: EditableDetail;
    remotePayload: EditableDetailPayload;
  }) | null>(null);
  const [notice, setNotice] = useState("");
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [pendingPublishCount, setPendingPublishCount] = useState(0);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [releaseJobs, setReleaseJobs] = useState<SiteAdminReleaseJobLike[] | null>(
    null,
  );
  const [releaseJobsError, setReleaseJobsError] = useState("");
  // One token per opened document. Every await in the load/save paths rechecks
  // it so a response for document A can never be written into document B.
  const selectionGateRef = useRef(createSelectionGate());
  // The document whose detail GET is in flight, so a repeat click on the same
  // row is dropped without also dropping a click on a different row.
  const selectionLoadingRef = useRef("");
  const selectedSourceDraftRef = useRef("");
  const saveSelectedContentRef = useRef<
    (options?: { quiet?: boolean }) => Promise<void>
  >(async () => {});
  const saveHomeRef = useRef<() => Promise<void>>(async () => {});
  const saveNowRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    if (!inspectorOpen) return;
    const panel = document.getElementById("site-admin-inspector");
    const trigger = document.getElementById("site-admin-inspector-trigger");
    if (!panel) return;

    const focusableSelector = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "textarea:not([disabled])",
      "select:not([disabled])",
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");
    const focusFirst = () =>
      panel.querySelector<HTMLElement>("[data-inspector-close]")?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setInspectorOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    window.requestAnimationFrame(focusFirst);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      window.requestAnimationFrame(() => trigger?.focus());
    };
  }, [inspectorOpen]);

  const selectedContentKey = selected ? `${selected.kind}:${selected.id}` : "";

  useEffect(() => {
    if (!selectedContentKey) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("site-admin-editor-panel")?.scrollIntoView({
        block: "start",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedContentKey]);

  const currentItems = useMemo(
    () => contentItems({ kind: documentKind, pages, posts, components }),
    [documentKind, pages, posts, components],
  );
  const visibleItems = useMemo(() => {
    const query = contentSearch.trim().toLowerCase();
    if (!query) return currentItems;
    return currentItems.filter((item) =>
      [item.title, item.id, item.meta].some((value) =>
        String(value || "").toLowerCase().includes(query),
      ),
    );
  }, [contentSearch, currentItems]);
  const globalSearchItems = useMemo(() => {
    const query = contentSearch.trim().toLowerCase();
    if (!query) return [];
    return (["posts", "pages"] as const).flatMap((itemKind) =>
      contentItems({ kind: itemKind, pages, posts, components })
        .filter((item) =>
          [item.title, item.id, item.meta].some((value) =>
            String(value || "").toLowerCase().includes(query),
          ),
        )
        .map((item) => ({ kind: itemKind, item })),
    );
  }, [components, contentSearch, pages, posts]);
  const componentDefinitions = useMemo(
    () => componentDefinitionsFromPayload(components),
    [components],
  );
  const selectedManagedComponent = useMemo(() => {
    if (!selected || selected.kind !== "pages") return null;
    return findManagedComponentInBody(contentForm.body, componentDefinitions);
  }, [componentDefinitions, contentForm.body, selected]);
  const selectedManagedSummary = selectedManagedComponent
    ? componentSummaryFor(components, selectedManagedComponent.name)
    : undefined;
  const selectedComponentName =
    selected?.kind === "components" && isSiteComponentName(selected.id)
      ? selected.id
      : null;
  const selectedComponentDefinition = selectedComponentName
    ? componentDefinitions.find((definition) => definition.name === selectedComponentName) || null
    : null;
  const selectedIsNewsComponent = selectedComponentName === "news";
  const selectedNewsDraft = useMemo(
    () => (selectedIsNewsComponent ? parseNewsComponentDraft(sourceDraft) : null),
    [selectedIsNewsComponent, sourceDraft],
  );
  const selectedTeachingDraft = useMemo(
    () =>
      selectedComponentName === "teaching"
        ? parseTeachingComponentDraft(sourceDraft)
        : null,
    [selectedComponentName, sourceDraft],
  );
  const selectedWorksDraft = useMemo(
    () => (selectedComponentName === "works" ? parseWorksComponentDraft(sourceDraft) : null),
    [selectedComponentName, sourceDraft],
  );
  const selectedPublicationsDraft = useMemo(
    () =>
      selectedComponentName === "publications"
        ? parsePublicationsComponentDraft(sourceDraft)
        : null,
    [selectedComponentName, sourceDraft],
  );
  const selectedComponentIssues = useMemo(() => {
    if (selectedNewsDraft) {
      return selectedNewsDraft.items.flatMap((item) =>
        item.type === "entry" ? newsEntryIssues(item) : [],
      );
    }
    if (selectedTeachingDraft) {
      return selectedTeachingDraft.items.flatMap(teachingEntryIssues);
    }
    if (selectedWorksDraft) {
      return selectedWorksDraft.items.flatMap(worksEntryIssues);
    }
    if (selectedPublicationsDraft) {
      return selectedPublicationsDraft.items.flatMap(publicationEntryIssues);
    }
    return [];
  }, [
    selectedNewsDraft,
    selectedPublicationsDraft,
    selectedTeachingDraft,
    selectedWorksDraft,
  ]);
  const componentBaselineFingerprints = useMemo(() => {
    if (!selected || selected.kind !== "components" || !selectedComponentName) {
      return new Map<string, string>();
    }
    const items: Array<{ id: string }> =
      selectedComponentName === "news"
        ? parseNewsComponentDraft(selected.source).items
        : selectedComponentName === "teaching"
          ? parseTeachingComponentDraft(selected.source).items
          : selectedComponentName === "works"
            ? parseWorksComponentDraft(selected.source).items
            : parsePublicationsComponentDraft(selected.source).items;
    return new Map(
      items.map((item) => [item.id, componentEntryFingerprint(item)]),
    );
  }, [selected, selectedComponentName]);
  const componentSaveBlocked = selectedComponentIssues.length > 0;
  const release = summary?.release;
  const source = summary?.source;
  const activityReleaseJob = useMemo(
    () => (releaseActivity ? selectActiveReleaseJob(releaseActivity.jobs) : null),
    [releaseActivity],
  );
  const activeReleaseJob = releaseActivity
    ? activityReleaseJob
    : release?.runningJob ?? null;
  const activeReleaseJobs = releaseActivity?.jobs ??
    [release?.runningJob, release?.latestJob].filter(
      (job): job is SiteAdminReleaseJobLike => Boolean(job),
    );
  const activeReleaseRunners =
    releaseActivity?.runners.agents ?? release?.runners ?? [];
  const summaryGeneratedAt = Date.parse(summary?.generatedAt || "");
  const activeReleaseUpdatedAt = Number(
    activeReleaseJob?.updatedAt || activeReleaseJob?.createdAt || 0,
  );
  const releaseProgressNow = releaseActivity
    ? Date.now()
    : Number.isFinite(summaryGeneratedAt)
      ? summaryGeneratedAt
      : activeReleaseUpdatedAt;
  const releaseProgress = activeReleaseJob
    ? buildSiteAdminReleaseProgress({
        job: activeReleaseJob,
        jobs: activeReleaseJobs,
        runners: activeReleaseRunners,
        now: Number.isFinite(releaseProgressNow) ? releaseProgressNow : 0,
      })
    : release?.progress ?? null;
  const areaTitle =
    area === "media"
      ? "Media"
      : area === "release"
        ? "Publish"
        : area === "settings"
          ? "Settings"
          : "Content";
  const areaDescription =
    area === "media"
      ? "Upload and reuse images across pages, posts, and social metadata."
      : area === "release"
        ? "Publish saved content to the live site and inspect recovery only when needed."
        : area === "settings"
          ? "Manage site identity and navigation."
          : "Write, organize, and publish every part of the site from one workspace.";
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
  selectedSourceDraftRef.current = selectedSourceDraft;
  saveSelectedContentRef.current = saveSelectedContent;
  saveHomeRef.current = saveHome;
  saveNowRef.current = saveNow;
  const homeDirty = Boolean(home && `${homeTitle}\n${homeBody}` !== homeBaseline);
  const nowComparable = `${nowText}\n${nowContext}\n${nowLocation}\n${nowDate}`;
  const nowDirty = Boolean(now && nowComparable !== nowBaseline);
  const hasUnsavedChanges = selectedDirty || homeDirty || nowDirty || settingsDirty;
  const slugDirty = Boolean(
    selected &&
      (selected.kind === "posts" || selected.kind === "pages") &&
      slugDraft.trim() &&
      slugDraft.trim() !== selected.id,
  );
  const releaseActionKind = release?.recommendedAction.kind;
  const releaseIsRunning =
    Boolean(activeReleaseJob) ||
    (!releaseActivity && releaseActionKind === "watch-release");
  const releaseIsQueued = activeReleaseJob?.status === "queued";
  const releaseRunnerOffline =
    releaseIsQueued && releaseProgress?.runnerState === "offline";
  const releaseUnavailable = releaseActionKind === "refresh" || !release?.recommendedAction;
  // Autosave deliberately stops at the draft, so the console has to count the
  // saves itself rather than wait for the release summary to notice them.
  const liveSync = liveSyncStatus({
    releaseActionKind,
    pendingSaves: pendingPublishCount,
    releaseRunning: releaseIsRunning,
  });
  const publishBlocked =
    releaseSaving ||
    releaseIsRunning ||
    (liveSync.state !== "pending" &&
      (releaseActionKind === "noop" || releaseUnavailable));
  const documentStatus = editorialStatus({
    saving,
    blocked: componentSaveBlocked,
    dirty: selectedDirty,
    runnerOffline: releaseRunnerOffline,
    liveSync,
  });
  const liveStatusLabel = selectedDirty
    ? "Save before publishing"
    : releaseRunnerOffline
      ? "Runner offline"
    : releaseIsQueued
      ? "Queued"
    : releaseIsRunning
      ? "Publishing"
      : liveSync.label;
  const editorStatusHint = componentSaveBlocked
    ? `Fix ${selectedComponentIssues.length} validation ${
        selectedComponentIssues.length === 1 ? "issue" : "issues"
      } before saving. Your recovery copy is still kept in this browser.`
    : selectedDirty
    ? localAutosaveAt
      ? `Recovery copy saved ${formatWhen(localAutosaveAt)}. Save before publishing.`
      : "Unsaved edits are protected in this browser until saved."
    : releaseIsRunning && releaseProgress
      ? releaseProgress.detail
    : liveSync.state === "pending"
      ? contentSavedAt
        ? `Saved ${formatWhen(contentSavedAt)}. ${liveSync.label} — use Publish live when you are ready.`
        : release?.detail || "Saved content is ahead of the live site."
      : contentSavedAt
        ? `Saved ${formatWhen(contentSavedAt)}. ${release?.detail || ""}`.trim()
        : release?.headline || "Publish status unavailable";
  const selectedVisibility = visibilityLabel(contentForm.draft);
  const publishButtonLabel = releaseSaving
    ? "Starting"
    : selectedDirty
      ? "Save first"
      : liveSync.state === "live"
        ? "Live current"
        : releaseUnavailable && liveSync.pendingCount === 0
          ? "Refresh status"
          : "Publish live";

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
      setHomeBaseline(`${homeResult.value.data.title || ""}\n${homeResult.value.data.bodyMdx || ""}`);
    } else {
      failures.push({ scope: "Home", message: homeResult.reason?.message || "failed" });
    }

    if (nowResult.status === "fulfilled") {
      setNow(nowResult.value);
      setNowText(nowResult.value.data.current.text || "");
      setNowContext(nowResult.value.data.current.context || "");
      setNowLocation(nowResult.value.data.current.location || "");
      const nextNowDate = dateInputFromIso(nowResult.value.data.current.updatedAt);
      setNowDate(nextNowDate);
      setNowBaseline(
        `${nowResult.value.data.current.text || ""}\n${nowResult.value.data.current.context || ""}\n${nowResult.value.data.current.location || ""}\n${nextNowDate}`,
      );
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
    setHasLoadedOnce(true);
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
      window.localStorage.setItem(
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
    if (area !== "content") return;
    // The create drawer shares `saving`, so an autosave of the document behind
    // it would turn the new-content editor read-only mid-keystroke.
    if (contentMode === "create") return;
    if (!selected || !selectedDirty || saving || conflict || componentSaveBlocked) return;
    const selectedKey = `${selected.kind}:${selected.id}`;
    const timer = window.setTimeout(() => {
      if (`${selected.kind}:${selected.id}` !== selectedKey) return;
      void saveSelectedContentRef.current({ quiet: true });
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [
    area,
    componentSaveBlocked,
    conflict,
    contentMode,
    saving,
    selected,
    selectedDirty,
    selectedSourceDraft,
  ]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (saving) return;
      if (area === "home" && homeDirty) {
        void saveHomeRef.current();
      } else if (area === "now" && nowDirty) {
        void saveNowRef.current();
      } else if (selectedDirty) {
        void saveSelectedContentRef.current();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [area, homeDirty, nowDirty, saving, selectedDirty]);

  function toggleSelectedVisibility() {
    setContentForm((current) => ({ ...current, draft: !current.draft }));
  }

  function confirmDiscardChanges(): boolean {
    if (!hasUnsavedChanges) return true;
    return window.confirm("You have unsaved edits. Discard them and continue?");
  }

  /**
   * Drops every editor draft. Confirming "discard" used to leave the draft in
   * state with the autosave timer still armed, so the edits were saved 1.6s
   * after the author said to throw them away.
   */
  function discardEditorDrafts() {
    setSelected(null);
    setContentMode("browse");
    setSourceDraft("");
    setContentForm(EMPTY_CONTENT_FORM);
    setContentFormBaseline("");
    setSlugDraft("");
    setLocalAutosaveAt("");
    setLocalDraftSnapshot(null);
    setComponentReturnTarget(null);
    setHomeTitle(home?.data.title || "");
    setHomeBody(home?.data.bodyMdx || "");
    setNowText(now?.data.current.text || "");
    setNowContext(now?.data.current.context || "");
    setNowLocation(now?.data.current.location || "");
    setNowDate(dateInputFromIso(now?.data.current.updatedAt));
  }

  function changeArea(nextArea: Area) {
    if (nextArea === area) {
      setInspectorOpen(false);
      return;
    }
    if (!confirmDiscardChanges()) return;
    // A dirty settings draft is discarded by unmounting its panel; wiping the
    // document editor for it would throw away a selection that was never dirty.
    if (selectedDirty || homeDirty || nowDirty) discardEditorDrafts();
    setArea(nextArea);
    setInspectorOpen(false);
  }

  const refreshSummaryOnly = useCallback(async () => {
    try {
      const next = await readJson<SummaryPayload>("/api/site-admin/mobile/summary");
      setSummary(next.summary);
      setSummaryError("");
      return next.summary;
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, []);

  useEffect(() => {
    const watchDeadline = releaseWatchUntil;
    if (!releaseWatchJobId && !releaseIsRunning && watchDeadline <= Date.now()) return;
    let cancelled = false;
    let timer: number | undefined;

    const refreshReleaseActivity = async () => {
      try {
        const next = await readJson<ReleaseJobsPayload>(
          "/api/site-admin/release-jobs?limit=30",
        );
        if (cancelled) return;
        const watchedJob = releaseWatchJobId
          ? next.jobs.find((job) => job.id === releaseWatchJobId) || null
          : null;
        const watchedOutcome = watchedJob ? releaseJobOutcome(watchedJob) : null;
        if (watchedOutcome && watchedOutcome.state !== "active") {
          setReleaseActivity(null);
          setReleaseWatchUntil(0);
          setReleaseWatchJobId("");
          if (watchedOutcome.state === "succeeded") {
            setPendingPublishCount(0);
            setError("");
            setNotice("Published successfully. The public site is current.");
          } else {
            setNotice("");
            setError(
              `${watchedOutcome.state === "canceled" ? "Publish canceled" : "Publish failed"}: ${
                watchedOutcome.message
              }`,
            );
          }
          await refreshSummaryOnly();
          return;
        }
        const nextJob = selectActiveReleaseJob(next.jobs);
        if (!nextJob) {
          if (releaseWatchJobId && watchDeadline > Date.now()) {
            setReleaseActivity(null);
            timer = window.setTimeout(refreshReleaseActivity, 3_000);
            return;
          }
          const nextSummary = await refreshSummaryOnly();
          if (cancelled) return;
          setReleaseActivity(null);
          // Keep polling for the whole watch window: a freshly queued job can
          // take a few ticks to appear. Stop at the deadline instead of
          // leaving the chain running for the rest of the session.
          if (
            nextSummary?.release.recommendedAction.kind !== "watch-release" ||
            watchDeadline <= Date.now()
          ) {
            setReleaseWatchUntil(0);
            setReleaseWatchJobId("");
            return;
          }
          timer = window.setTimeout(refreshReleaseActivity, 4_000);
          return;
        }

        setReleaseActivity(next);
        setSummaryError("");
        const progress = buildSiteAdminReleaseProgress({
          job: nextJob,
          jobs: next.jobs,
          runners: next.runners.agents,
          now: Date.now(),
        });
        const delay =
          nextJob.status === "queued" && progress.runnerState === "offline"
            ? 10_000
            : 3_000;
        timer = window.setTimeout(refreshReleaseActivity, delay);
      } catch (err) {
        if (cancelled) return;
        setSummaryError(err instanceof Error ? err.message : String(err));
        timer = window.setTimeout(refreshReleaseActivity, 5_000);
      }
    };

    void refreshReleaseActivity();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [refreshSummaryOnly, releaseIsRunning, releaseWatchJobId, releaseWatchUntil]);

  function applySelectedDetail(
    nextKind: EditableKind,
    id: string,
    detail: EditableDetailPayload,
    token = selectionGateRef.current.open(),
  ) {
    if (selectionGateRef.current.isStale(token)) return null;
    const next = toEditableDetail(nextKind, id, detail);
    setKind(nextKind);
    if (nextKind === "posts" || nextKind === "pages") {
      setDocumentKind(nextKind);
    }
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
    setComponentSearch("");
    setComponentGrouping("auto");
    setComponentExpandedIds([]);
    setComponentDragId("");
    setComponentDropId("");
    setLocalAutosaveAt("");
    setContentSavedAt("");
    const localDraft = readLocalDraft(nextKind, id);
    setLocalDraftSnapshot(
      localDraft && localDraft.source !== baseline ? localDraft : null,
    );
    setArea("content");
    setInspectorOpen(false);
    return next;
  }

  async function selectContent(nextKind: EditableKind, id: string): Promise<boolean> {
    if (
      selected &&
      (selected.kind !== nextKind || selected.id !== id) &&
      !confirmDiscardChanges()
    ) {
      return false;
    }
    // A double-click used to fire two detail GETs whose responses could land
    // out of order. Only the repeat click is dropped: opening a *different*
    // document must still supersede the load in flight, and the gate below
    // keeps the losing response out of the editor.
    const requestKey = `${nextKind}:${id}`;
    if (selectionLoadingRef.current === requestKey) return false;
    selectionLoadingRef.current = requestKey;
    const token = selectionGateRef.current.open();
    setLoading(true);
    setError("");
    setWarning("");
    setNotice("");
    try {
      const detail = await readJson<EditableDetailPayload>(
        endpointFor(nextKind, id),
      );
      if (selectionGateRef.current.isStale(token)) return false;
      applySelectedDetail(nextKind, id, detail, token);
      return true;
    } catch (err) {
      if (selectionGateRef.current.isStale(token)) return false;
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      if (selectionLoadingRef.current === requestKey) {
        selectionLoadingRef.current = "";
      }
      // A superseded load must not clear the spinner out from under the newer
      // one; the request that still owns the selection ends it.
      if (!selectionGateRef.current.isStale(token)) setLoading(false);
    }
  }

  async function saveSelectedContent(options: { quiet?: boolean } = {}) {
    if (!selected) return;
    if (componentSaveBlocked) {
      setWarning(
        `Fix ${selectedComponentIssues.length} validation ${
          selectedComponentIssues.length === 1 ? "issue" : "issues"
        } before saving.`,
      );
      return;
    }
    const sourceAtStart = selectedSourceDraft;
    const selectedAtStart = selected;
    const token = selectionGateRef.current.current();
    const effects = contentSaveEffects(options);
    let saved = false;
    setSaving(true);
    setError("");
    setWarning("");
    setNotice("");
    try {
      await writeJson<MutationPayload>(
        endpointFor(selectedAtStart.kind, selectedAtStart.id),
        "PATCH",
        {
          source: sourceAtStart,
          version: selectedAtStart.version,
        },
      );
      const detail = await readJson<EditableDetailPayload>(
        endpointFor(selectedAtStart.kind, selectedAtStart.id),
      );
      // The author may have opened another document while the round-trip was
      // in flight; writing this response into it would overwrite their body.
      if (selectionGateRef.current.isStale(token)) return;
      const next = toEditableDetail(selectedAtStart.kind, selectedAtStart.id, detail);
      const newerLocalEdits = selectedSourceDraftRef.current !== sourceAtStart;
      setSelected(next);
      setSlugDraft(next.id);
      const form = formFromEditablePayload(
        selectedAtStart.kind,
        selectedAtStart.id,
        detail,
      );
      if (!newerLocalEdits) {
        setSourceDraft(next.source);
        setContentForm(form);
      }
      setContentFormBaseline(
        newerLocalEdits
          ? sourceAtStart
          : selectedAtStart.kind === "posts" || selectedAtStart.kind === "pages"
            ? sourceForEditedContent(selectedAtStart.kind, form)
            : next.source,
      );
      if (!newerLocalEdits) {
        clearLocalDraft(selectedAtStart.kind, selectedAtStart.id);
        setLocalAutosaveAt("");
      }
      setContentSavedAt(new Date().toISOString());
      if (!newerLocalEdits) setLocalDraftSnapshot(null);
      setPendingPublishCount((current) => current + 1);
      saved = true;
      if (effects.announce) setNotice(`${next.title} saved.`);
    } catch (err) {
      if (selectionGateRef.current.isStale(token)) return;
      if (err instanceof SiteAdminRequestError && err.status === 409 && selectedAtStart) {
        try {
          const remotePayload = await readJson<EditableDetailPayload>(
            endpointFor(selectedAtStart.kind, selectedAtStart.id),
          );
          const remote = toEditableDetail(
            selectedAtStart.kind,
            selectedAtStart.id,
            remotePayload,
          );
          setConflict({
            title: selectedAtStart.title,
            localSource: selectedSourceDraftRef.current,
            remoteSource: remote.source,
            detail:
              selectedAtStart.kind === "components" &&
              isSiteComponentName(selectedAtStart.id)
                ? componentConflictDetail(
                    selectedAtStart.id,
                    selectedAtStart.source,
                    selectedSourceDraftRef.current,
                    remote.source,
                  )
                : undefined,
            remote,
            remotePayload,
          });
          setWarning("A newer saved version exists. Review both versions before continuing.");
        } catch (refreshError) {
          if (selectionGateRef.current.isStale(token)) return;
          setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
        }
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSaving(false);
    }

    if (!saved) return;
    // Everything below is bookkeeping on top of a save that already succeeded,
    // so it runs outside the mutation's try: a list hiccup used to be reported
    // as a failed save and cancelled the publish that was meant to follow it.
    if (effects.reconcileLists && !(await refreshLists())) {
      setWarning("Saved. The content lists could not be refreshed — use Refresh to reload them.");
    }
    if (!effects.publish) return;
    if (selectionGateRef.current.isStale(token)) return;
    const publishNotice = await queueSavedContentPublish(
      `${selectedAtStart.kind}:${selectedAtStart.id}:save`,
    );
    await refreshSummaryOnly();
    if (effects.announce) {
      setNotice(`${selectedAtStart.title} saved.${publishNotice}`);
    }
  }

  function reloadConflictVersion() {
    if (!conflict || !selected) return;
    applySelectedDetail(selected.kind, selected.id, conflict.remotePayload);
    clearLocalDraft(selected.kind, selected.id);
    setConflict(null);
    setWarning("");
    setNotice("Latest saved version loaded.");
  }

  async function keepConflictEdits() {
    if (!conflict || !selected) return;
    setBlockingMutation(true);
    setSaving(true);
    setError("");
    const token = selectionGateRef.current.current();
    try {
      await writeJson<MutationPayload>(endpointFor(selected.kind, selected.id), "PATCH", {
        source: conflict.localSource,
        version: conflict.remote.version,
      });
      const detail = await readJson<EditableDetailPayload>(
        endpointFor(selected.kind, selected.id),
      );
      applySelectedDetail(selected.kind, selected.id, detail, token);
      clearLocalDraft(selected.kind, selected.id);
      setConflict(null);
      setWarning("");
      setContentSavedAt(new Date().toISOString());
      await refreshLists();
      const publishNotice = await queueSavedContentPublish(
        `${selected.kind}:${selected.id}:conflict-save`,
      );
      await refreshSummaryOnly();
      setNotice(`Your edits were saved as the latest Draft.${publishNotice}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
      setBlockingMutation(false);
    }
  }

  async function deleteSelectedContent() {
    if (!selected || !isDeleteSupported(selected.kind)) return;
    const confirmed = window.confirm(`Delete ${selected.title}?`);
    if (!confirmed) return;
    setBlockingMutation(true);
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
      const publishNotice = await queueSavedContentPublish(
        `${selected.kind}:${selected.id}:delete`,
      );
      await refreshSummaryOnly();
      setNotice(`${selected.title} deleted.${publishNotice}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
      setBlockingMutation(false);
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
    setBlockingMutation(true);
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
      const publishNotice = await queueSavedContentPublish(
        `${selected.kind}:${selected.id}:rename`,
      );
      await refreshSummaryOnly();
      setNotice(`${selected.title} renamed.${publishNotice}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
      setBlockingMutation(false);
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
    const resolvedKind = nextKind ?? documentKind;
    setContentMode("create");
    setCreateKind(resolvedKind);
    setCreateSlug("");
    setCreateTitle(resolvedKind === "posts" ? "Untitled Post" : "Untitled Page");
    setCreateDescription("");
    setCreateDate(todayInHalifax());
    setCreateBody(resolvedKind === "posts" ? "Write the post here." : "Write the page here.");
    setCreateVisible(false);
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
          visible: createVisible,
        }),
      });
      const listsRefreshed = await refreshLists();
      await selectContent(createKind, slug);
      setContentSavedAt(new Date().toISOString());
      const publishNotice = await queueSavedContentPublish(
        `${createKind}:${slug}:create`,
      );
      await refreshSummaryOnly();
      setCreateSlug("");
      setCreateTitle(createKind === "posts" ? "Untitled Post" : "Untitled Page");
      setCreateDescription("");
      setCreateDate(todayInHalifax());
      setCreateBody(createKind === "posts" ? "Write the post here." : "Write the page here.");
      setCreateVisible(false);
      setNotice(`${slug} created.${publishNotice}`);
      // refreshLists() reports instead of throwing, so say so rather than
      // leaving the sidebar quietly missing the new document.
      if (!listsRefreshed) {
        setWarning("Created. The content lists could not be refreshed — use Refresh to reload them.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Reconciles the sidebar lists. Never throws: one list failing must not
   * discard the two that loaded, and must not be mistaken for a failed save.
   * Returns false when any list could not be refreshed.
   */
  async function refreshLists(): Promise<boolean> {
    const [pagesResult, postsResult, componentsResult] = await Promise.allSettled([
      readJson<PagesPayload>("/api/site-admin/pages?drafts=1"),
      readJson<PostsPayload>("/api/site-admin/posts?drafts=1"),
      readJson<ComponentsPayload>("/api/site-admin/components"),
    ]);
    if (pagesResult.status === "fulfilled") setPages(pagesResult.value);
    if (postsResult.status === "fulfilled") setPosts(postsResult.value);
    if (componentsResult.status === "fulfilled") setComponents(componentsResult.value);
    return [pagesResult, postsResult, componentsResult].every(
      (result) => result.status === "fulfilled",
    );
  }

  /**
   * Reads the release queue into the Publish tab. Previously the only way to
   * see jobs was a link to the raw API response, which unloaded the page and
   * took any unsaved draft with it.
   */
  const refreshReleaseJobs = useCallback(async () => {
    setReleaseJobsError("");
    try {
      const next = await readJson<ReleaseJobsPayload>(
        "/api/site-admin/release-jobs?limit=20",
      );
      setReleaseJobs(next.jobs);
    } catch (err) {
      setReleaseJobs([]);
      setReleaseJobsError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (area !== "release") return;
    void refreshReleaseJobs();
  }, [area, refreshReleaseJobs]);

  async function runSmartRelease() {
    setReleaseSaving(true);
    setError("");
    setWarning("");
    setNotice("");
    try {
      const payload = await writeJson<{
        job?: SiteAdminReleaseJobLike;
        wake?: ReleaseWakePayload;
      }>(
        "/api/site-admin/release-jobs/smart",
        "POST",
        {
          request: {
            source: "site-admin-web-console",
            area,
          },
        },
      );
      if (!payload.job?.id) {
        throw new Error("The release API did not return a job to track.");
      }
      const jobId = ` (${payload.job.id})`;
      const wakeNotice =
        payload.wake?.configured && !payload.wake.ok
          ? ` Runner wake failed: ${payload.wake.error || `HTTP ${payload.wake.status}`}.`
          : payload.wake?.ok
            ? " Runner wake sent."
            : "";
      setNotice(`Publish job created${jobId}.${wakeNotice}`);
      setReleaseActivity(null);
      setReleaseWatchJobId(payload.job.id);
      setReleaseWatchUntil(Date.now() + 15 * 60 * 1000);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReleaseSaving(false);
    }
  }

  async function queueSavedContentPublish(reason: string): Promise<string> {
    const action = contentPublishActionForBrowser();
    if (!action) return "";
    try {
      const payload = await writeJson<{
        job?: SiteAdminReleaseJobLike;
        wake?: ReleaseWakePayload;
      }>(
        "/api/site-admin/release-jobs",
        "POST",
        {
          action,
          request: {
            source: "site-admin-web-console",
            reason,
            area,
          },
        },
      );
      if (!payload.job?.id) {
        throw new Error("The release API did not return a job to track.");
      }
      setReleaseActivity(null);
      setReleaseWatchJobId(payload.job.id);
      setReleaseWatchUntil(Date.now() + 15 * 60 * 1000);
      const jobId = ` Job ${payload.job.id}.`;
      if (payload.wake?.configured && !payload.wake.ok) {
        setWarning(
          `Content was queued, but the release runner did not wake: ${
            payload.wake.error || `HTTP ${payload.wake.status}`
          }. The job will remain queued and retry when the runner reconnects.`,
        );
      }
      return action === "publish-content-production"
        ? ` Publishing the saved content to the public site.${jobId}`
        : ` Publishing the saved content to staging.${jobId}`;
    } catch (err) {
      setWarning(
        `Content was saved, but publishing could not be queued: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return "";
    }
  }

  async function publishSavedContent() {
    if (pendingPublishCount <= 0) {
      await runSmartRelease();
      return;
    }
    setReleaseSaving(true);
    setError("");
    setWarning("");
    setNotice("");
    try {
      const publishNotice = await queueSavedContentPublish("content:publish-saved");
      if (publishNotice) setNotice(`Publish queued.${publishNotice}`);
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
      setHomeTitle(next.data.title || "");
      setHomeBody(next.data.bodyMdx || "");
      setHomeBaseline(`${next.data.title || ""}\n${next.data.bodyMdx || ""}`);
      const publishNotice = await queueSavedContentPublish("home:save");
      await refreshSummaryOnly();
      setNotice(`Home saved.${publishNotice}`);
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
      setNowText(next.data.current.text || "");
      setNowContext(next.data.current.context || "");
      setNowLocation(next.data.current.location || "");
      const nextDate = dateInputFromIso(next.data.current.updatedAt);
      setNowDate(nextDate);
      setNowBaseline(
        `${next.data.current.text || ""}\n${next.data.current.context || ""}\n${next.data.current.location || ""}\n${nextDate}`,
      );
      const publishNotice = await queueSavedContentPublish("now:create");
      await refreshSummaryOnly();
      setNotice(`Now saved.${publishNotice}`);
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
      const publishNotice = await queueSavedContentPublish("now:update-history");
      setNotice(`Now history updated.${publishNotice}`);
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
      const publishNotice = await queueSavedContentPublish("now:delete-history");
      setNotice(`Now history deleted.${publishNotice}`);
      void refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function updateNewsDraft(
    updater: (draft: NewsComponentDraft) => NewsComponentDraft,
  ) {
    const base = parseNewsComponentDraft(sourceDraft);
    setSourceDraft(serializeNewsComponentDraft(updater(base)));
  }

  function addNewsEntry() {
    const id = createComponentEntryId("news");
    updateNewsDraft((draft) => ({
      ...draft,
      items: [
        {
          id,
          type: "entry",
          date: todayInHalifax(),
          body: "New update.",
        },
        ...draft.items,
      ],
    }));
    setComponentExpandedIds([id]);
  }

  function addNewsDivider() {
    const id = createComponentEntryId("divider");
    updateNewsDraft((draft) => ({
      ...draft,
      items: [
        {
          id,
          type: "divider",
        },
        ...draft.items,
      ],
    }));
  }

  function updateNewsItem(nextItem: NewsDraftEntry) {
    updateNewsDraft((draft) => ({
      ...draft,
      items: draft.items.map((item) => {
        if (item.id !== nextItem.id || item.type !== "entry") return item;
        return nextItem;
      }),
    }));
  }

  function deleteNewsItem(id: string) {
    if (!window.confirm("Delete this News item?")) return;
    updateNewsDraft((draft) => ({
      ...draft,
      items: draft.items.filter((item) => item.id !== id),
    }));
    setComponentExpandedIds((current) => current.filter((entryId) => entryId !== id));
  }

  function duplicateNewsItem(id: string) {
    const copyId = createComponentEntryId("news");
    updateNewsDraft((draft) => {
      const index = draft.items.findIndex((item) => item.id === id);
      const source = draft.items[index];
      if (!source || source.type !== "entry") return draft;
      const copy = { ...source, id: copyId };
      return {
        ...draft,
        items: [...draft.items.slice(0, index + 1), copy, ...draft.items.slice(index + 1)],
      };
    });
    setComponentExpandedIds([copyId]);
  }

  function moveSelectedNewsItem(id: string, direction: -1 | 1) {
    updateNewsDraft((draft) => ({
      ...draft,
      items: moveDraftEntry(
        draft.items,
        draft.items.findIndex((item) => item.id === id),
        direction,
      ),
    }));
  }

  function updateTeachingDraft(
    updater: (draft: TeachingComponentDraft) => TeachingComponentDraft,
  ) {
    const base = parseTeachingComponentDraft(sourceDraft);
    setSourceDraft(serializeTeachingComponentDraft(updater(base)));
  }

  function addTeachingEntry() {
    const id = createComponentEntryId("teaching");
    updateTeachingDraft((draft) => ({
      ...draft,
      items: [
        {
          id,
          term: "New term",
          period: "",
          role: "",
          courseCode: "",
          courseName: "",
        },
        ...draft.items,
      ],
    }));
    setComponentExpandedIds([id]);
  }

  function updateTeachingItem(nextItem: TeachingDraftEntry) {
    updateTeachingDraft((draft) => ({
      ...draft,
      items: draft.items.map((item) =>
        item.id === nextItem.id ? nextItem : item,
      ),
    }));
  }

  function deleteTeachingItem(id: string) {
    if (!window.confirm("Delete this Teaching row?")) return;
    updateTeachingDraft((draft) => ({
      ...draft,
      items: draft.items.filter((item) => item.id !== id),
    }));
    setComponentExpandedIds((current) => current.filter((entryId) => entryId !== id));
  }

  function duplicateTeachingItem(id: string) {
    const copyId = createComponentEntryId("teaching");
    updateTeachingDraft((draft) => {
      const index = draft.items.findIndex((item) => item.id === id);
      const source = draft.items[index];
      if (!source) return draft;
      const copy = { ...source, id: copyId };
      return {
        ...draft,
        items: [...draft.items.slice(0, index + 1), copy, ...draft.items.slice(index + 1)],
      };
    });
    setComponentExpandedIds([copyId]);
  }

  function moveSelectedTeachingItem(id: string, direction: -1 | 1) {
    updateTeachingDraft((draft) => ({
      ...draft,
      items: moveDraftEntry(
        draft.items,
        draft.items.findIndex((item) => item.id === id),
        direction,
      ),
    }));
  }

  function updateWorksDraft(updater: (draft: WorksComponentDraft) => WorksComponentDraft) {
    const base = parseWorksComponentDraft(sourceDraft);
    setSourceDraft(serializeWorksComponentDraft(updater(base)));
  }

  function addWorksEntry() {
    const id = createComponentEntryId("works");
    updateWorksDraft((draft) => ({
      ...draft,
      items: [
        {
          id,
          category: "recent",
          role: "New role",
          affiliation: "",
          location: "",
          period: "",
          body: "",
        },
        ...draft.items,
      ],
    }));
    setComponentExpandedIds([id]);
  }

  function updateWorksItem(nextItem: WorksDraftEntry) {
    updateWorksDraft((draft) => ({
      ...draft,
      items: draft.items.map((item) =>
        item.id === nextItem.id ? nextItem : item,
      ),
    }));
  }

  function deleteWorksItem(id: string) {
    if (!window.confirm("Delete this Work row?")) return;
    updateWorksDraft((draft) => ({
      ...draft,
      items: draft.items.filter((item) => item.id !== id),
    }));
    setComponentExpandedIds((current) => current.filter((entryId) => entryId !== id));
  }

  function duplicateWorksItem(id: string) {
    const copyId = createComponentEntryId("works");
    updateWorksDraft((draft) => {
      const index = draft.items.findIndex((item) => item.id === id);
      const source = draft.items[index];
      if (!source) return draft;
      const copy = { ...source, id: copyId };
      return {
        ...draft,
        items: [...draft.items.slice(0, index + 1), copy, ...draft.items.slice(index + 1)],
      };
    });
    setComponentExpandedIds([copyId]);
  }

  function moveSelectedWorksItem(id: string, direction: -1 | 1) {
    updateWorksDraft((draft) => ({
      ...draft,
      items: moveDraftEntry(
        draft.items,
        draft.items.findIndex((item) => item.id === id),
        direction,
      ),
    }));
  }

  function updatePublicationsDraft(
    updater: (draft: PublicationsComponentDraft) => PublicationsComponentDraft,
  ) {
    const base = parsePublicationsComponentDraft(sourceDraft);
    setSourceDraft(serializePublicationsComponentDraft(updater(base)));
  }

  function addPublicationEntry() {
    const id = createComponentEntryId("publication");
    updatePublicationsDraft((draft) => ({
      ...draft,
      items: [
        {
          id,
          title: "Untitled publication",
          year: new Date().getFullYear().toString(),
          url: "",
          labels: [],
        },
        ...draft.items,
      ],
    }));
    setComponentExpandedIds([id]);
  }

  function updatePublicationItem(nextItem: PublicationDraftEntry) {
    updatePublicationsDraft((draft) => ({
      ...draft,
      items: draft.items.map((item) =>
        item.id === nextItem.id ? nextItem : item,
      ),
    }));
  }

  function deletePublicationItem(id: string) {
    if (!window.confirm("Delete this publication?")) return;
    updatePublicationsDraft((draft) => ({
      ...draft,
      items: draft.items.filter((item) => item.id !== id),
    }));
    setComponentExpandedIds((current) => current.filter((entryId) => entryId !== id));
  }

  function duplicatePublicationItem(id: string) {
    const copyId = createComponentEntryId("publication");
    updatePublicationsDraft((draft) => {
      const index = draft.items.findIndex((item) => item.id === id);
      const source = draft.items[index];
      if (!source) return draft;
      const copy = { ...source, id: copyId };
      return {
        ...draft,
        items: [...draft.items.slice(0, index + 1), copy, ...draft.items.slice(index + 1)],
      };
    });
    setComponentExpandedIds([copyId]);
  }

  function moveSelectedPublicationItem(id: string, direction: -1 | 1) {
    updatePublicationsDraft((draft) => ({
      ...draft,
      items: moveDraftEntry(
        draft.items,
        draft.items.findIndex((item) => item.id === id),
        direction,
      ),
    }));
  }

  function reorderSelectedComponentItems(sourceId: string, targetId: string) {
    if (!sourceId || !targetId || componentSearch.trim()) return;
    if (selectedComponentName === "news") {
      updateNewsDraft((draft) => ({
        ...draft,
        items: reorderDraftEntries(draft.items, sourceId, targetId),
      }));
    } else if (selectedComponentName === "teaching") {
      updateTeachingDraft((draft) => ({
        ...draft,
        items: reorderDraftEntries(draft.items, sourceId, targetId),
      }));
    } else if (selectedComponentName === "works") {
      updateWorksDraft((draft) => ({
        ...draft,
        items: reorderWorksEntriesAcrossGroups(draft.items, sourceId, targetId),
      }));
    } else if (selectedComponentName === "publications") {
      updatePublicationsDraft((draft) => ({
        ...draft,
        items: reorderDraftEntries(draft.items, sourceId, targetId),
      }));
    }
  }

  function handleComponentDragStart(event: DragEvent<HTMLElement>, id: string) {
    if (componentSearch.trim()) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
    setComponentDragId(id);
  }

  function handleComponentDragOver(event: DragEvent<HTMLElement>, id: string) {
    if (!componentDragId || componentSearch.trim()) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setComponentDropId(id);
  }

  function handleComponentDrop(event: DragEvent<HTMLElement>, id: string) {
    event.preventDefault();
    const sourceId = componentDragId || event.dataTransfer.getData("text/plain");
    reorderSelectedComponentItems(sourceId, id);
    setComponentDragId("");
    setComponentDropId("");
  }

  function toggleComponentEntry(id: string) {
    setComponentExpandedIds((current) =>
      current.includes(id) ? current.filter((entryId) => entryId !== id) : [id],
    );
  }

  function issuesForComponentEntry(id: string) {
    return selectedComponentIssues.filter((issue) => issue.entryId === id);
  }

  function focusComponentIssue(issue: (typeof selectedComponentIssues)[number] | undefined) {
    if (!issue) return;
    setComponentSearch("");
    setComponentExpandedIds([issue.entryId]);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const card = document.getElementById(componentEntryDomId(issue.entryId));
        card?.scrollIntoView({ behavior: "smooth", block: "center" });
        const field = card?.querySelector<HTMLElement>(
          `[data-component-field="${issue.field}"]`,
        );
        field?.focus({ preventScroll: true });
      });
    });
  }

  function reviewComponentIssue(direction: -1 | 1) {
    if (selectedComponentIssues.length === 0) return;
    const activeField = document.activeElement?.closest<HTMLElement>(
      "[data-structured-entry-form]",
    );
    const activeEntryId = activeField?.dataset.structuredEntryForm || "";
    const activeFieldName = document.activeElement?.getAttribute("data-component-field") || "";
    const currentIndex = selectedComponentIssues.findIndex(
      (issue) => issue.entryId === activeEntryId && issue.field === activeFieldName,
    );
    const nextIndex =
      currentIndex < 0
        ? direction === 1
          ? 0
          : selectedComponentIssues.length - 1
        : (currentIndex + direction + selectedComponentIssues.length) %
          selectedComponentIssues.length;
    focusComponentIssue(selectedComponentIssues[nextIndex]);
  }

  function completeComponentEntry(id: string) {
    setComponentExpandedIds((current) => current.filter((entryId) => entryId !== id));
    window.requestAnimationFrame(() => {
      document
        .getElementById(componentEntryDomId(id))
        ?.querySelector<HTMLElement>("[data-entry-trigger]")
        ?.focus({ preventScroll: true });
    });
  }

  function renderNewsEditor(draft: NewsComponentDraft) {
    const searching = Boolean(componentSearch.trim());
    const items = draft.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        if (item.type === "divider") return !searching;
        return matchesComponentItem(
          componentSearch,
          structuredCollectionSearchValues(item, NEWS_ENTRY_FIELDS),
        );
      });

    return (
      <StructuredCollectionEditor
        title="News entries"
        description="Edit dated updates directly. The public News page keeps using the same reusable collection."
        count={draft.items.filter((item) => item.type === "entry").length}
        entryLabel="updates"
        addLabel="Add update"
        onAdd={addNewsEntry}
        secondaryLabel="Add divider"
        onSecondary={addNewsDivider}
        search={componentSearch}
        onSearchChange={setComponentSearch}
        grouping={componentGrouping}
        onGroupingChange={setComponentGrouping}
        visibleEntryIds={items
          .filter(({ item }) => item.type === "entry")
          .map(({ item }) => item.id)}
        expandedEntryIds={componentExpandedIds}
        onExpandedEntryIdsChange={setComponentExpandedIds}
        issueCount={selectedComponentIssues.length}
        onReviewIssues={() => reviewComponentIssue(1)}
        onReviewPreviousIssue={() => reviewComponentIssue(-1)}
        onReviewNextIssue={() => reviewComponentIssue(1)}
        source={{
          fileName: `${selected?.id || "news"}.mdx`,
          label: `${selected?.title || "News"} MDX source`,
          value: sourceDraft,
          onChange: setSourceDraft,
          disabled: saving,
        }}
      >
        {items.length === 0 ? (
          <StructuredCollectionEmpty noun="updates" searching={searching} />
        ) : null}
        {items.map(({ item, index }, visibleIndex) => {
          const previousItem = items[visibleIndex - 1]?.item;
          const groupLabel =
            item.type === "entry" ? item.date.slice(0, 4) || "Undated" : "";
          const previousGroup =
            previousItem?.type === "entry"
              ? previousItem.date.slice(0, 4) || "Undated"
              : "";
          const clearDragState = () => {
            setComponentDragId("");
            setComponentDropId("");
          };
          if (item.type === "divider") {
            return (
              <StructuredCollectionDivider
                key={item.id}
                dragging={componentDragId === item.id}
                dropTarget={componentDropId === item.id}
                dragDisabled={searching}
                index={index}
                count={draft.items.length}
                onMove={(direction) => moveSelectedNewsItem(item.id, direction)}
                onDelete={() => deleteNewsItem(item.id)}
                onDragStart={(event) => handleComponentDragStart(event, item.id)}
                onDragEnd={clearDragState}
                onDragOver={(event) => handleComponentDragOver(event, item.id)}
                onDrop={(event) => handleComponentDrop(event, item.id)}
              />
            );
          }
          const issues = issuesForComponentEntry(item.id);
          return (
            <StructuredCollectionEntry
              key={item.id}
              id={item.id}
              groupLabel={groupLabel}
              previousGroupLabel={previousGroup}
              grouping={componentGrouping}
              title={item.body.split("\n")[0] || "Untitled update"}
              detail={item.date || "No date"}
              state={deriveComponentEntryState(componentBaselineFingerprints, item)}
              issues={issues}
              expanded={componentExpandedIds.includes(item.id)}
              dragging={componentDragId === item.id}
              dropTarget={componentDropId === item.id}
              dragDisabled={searching}
              index={index}
              count={draft.items.length}
              onToggle={() => toggleComponentEntry(item.id)}
              onMove={(direction) => moveSelectedNewsItem(item.id, direction)}
              onDuplicate={() => duplicateNewsItem(item.id)}
              onDelete={() => deleteNewsItem(item.id)}
              onDragStart={(event) => handleComponentDragStart(event, item.id)}
              onDragEnd={clearDragState}
              onDragOver={(event) => handleComponentDragOver(event, item.id)}
              onDrop={(event) => handleComponentDrop(event, item.id)}
            >
              <StructuredCollectionEntryForm
                item={item}
                fields={NEWS_ENTRY_FIELDS}
                issues={issues}
                disabled={blockingMutation}
                onChange={updateNewsItem}
                onComplete={() => completeComponentEntry(item.id)}
              />
            </StructuredCollectionEntry>
          );
        })}
      </StructuredCollectionEditor>
    );
  }

  function renderTeachingEditor(draft: TeachingComponentDraft) {
    const searching = Boolean(componentSearch.trim());
    const items = draft.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) =>
        matchesComponentItem(
          componentSearch,
          structuredCollectionSearchValues(item, TEACHING_ENTRY_FIELDS),
        ),
      );
    return (
      <StructuredCollectionEditor
        title="Teaching rows"
        description="Edit course rows directly. The MDX source remains available under Advanced."
        count={draft.items.length}
        entryLabel="courses"
        addLabel="Add course"
        onAdd={addTeachingEntry}
        search={componentSearch}
        onSearchChange={setComponentSearch}
        grouping={componentGrouping}
        onGroupingChange={setComponentGrouping}
        visibleEntryIds={items.map(({ item }) => item.id)}
        expandedEntryIds={componentExpandedIds}
        onExpandedEntryIdsChange={setComponentExpandedIds}
        issueCount={selectedComponentIssues.length}
        onReviewIssues={() => reviewComponentIssue(1)}
        onReviewPreviousIssue={() => reviewComponentIssue(-1)}
        onReviewNextIssue={() => reviewComponentIssue(1)}
        source={{
          fileName: `${selected?.id || "teaching"}.mdx`,
          label: `${selected?.title || "Teaching"} MDX source`,
          value: sourceDraft,
          onChange: setSourceDraft,
          disabled: saving,
        }}
      >
        {items.length === 0 ? (
          <StructuredCollectionEmpty noun="courses" searching={searching} />
        ) : null}
        {items.map(({ item, index }, visibleIndex) => {
          const issues = issuesForComponentEntry(item.id);
          const groupLabel =
            item.term.match(/^\d{4}\/\d{2}/)?.[0] || item.term || "No term";
          const previousTerm = items[visibleIndex - 1]?.item.term || "";
          const previousGroup = previousTerm.match(/^\d{4}\/\d{2}/)?.[0] || previousTerm;
          return (
            <StructuredCollectionEntry
              key={item.id}
              id={item.id}
              groupLabel={groupLabel}
              previousGroupLabel={previousGroup}
              grouping={componentGrouping}
              title={item.courseCode || item.courseName || item.term || "Untitled course"}
              detail={item.term || item.period || "Course"}
              state={deriveComponentEntryState(componentBaselineFingerprints, item)}
              issues={issues}
              expanded={componentExpandedIds.includes(item.id)}
              dragging={componentDragId === item.id}
              dropTarget={componentDropId === item.id}
              dragDisabled={searching}
              index={index}
              count={draft.items.length}
              onToggle={() => toggleComponentEntry(item.id)}
              onMove={(direction) => moveSelectedTeachingItem(item.id, direction)}
              onDuplicate={() => duplicateTeachingItem(item.id)}
              onDelete={() => deleteTeachingItem(item.id)}
              onDragStart={(event) => handleComponentDragStart(event, item.id)}
              onDragEnd={() => {
                setComponentDragId("");
                setComponentDropId("");
              }}
              onDragOver={(event) => handleComponentDragOver(event, item.id)}
              onDrop={(event) => handleComponentDrop(event, item.id)}
            >
              <StructuredCollectionEntryForm
                item={item}
                fields={TEACHING_ENTRY_FIELDS}
                issues={issues}
                disabled={blockingMutation}
                onChange={updateTeachingItem}
                onComplete={() => completeComponentEntry(item.id)}
              />
            </StructuredCollectionEntry>
          );
        })}
      </StructuredCollectionEditor>
    );
  }

  function renderWorksEditor(draft: WorksComponentDraft) {
    const searching = Boolean(componentSearch.trim());
    const items = draft.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) =>
        matchesComponentItem(
          componentSearch,
          structuredCollectionSearchValues(item, WORKS_ENTRY_FIELDS),
        ),
      );
    return (
      <StructuredCollectionEditor
        title="Work rows"
        description="Edit roles, affiliations, periods, and body text without touching MDX tags."
        count={draft.items.length}
        entryLabel="roles"
        addLabel="Add role"
        onAdd={addWorksEntry}
        search={componentSearch}
        onSearchChange={setComponentSearch}
        grouping={componentGrouping}
        onGroupingChange={setComponentGrouping}
        visibleEntryIds={items.map(({ item }) => item.id)}
        expandedEntryIds={componentExpandedIds}
        onExpandedEntryIdsChange={setComponentExpandedIds}
        issueCount={selectedComponentIssues.length}
        onReviewIssues={() => reviewComponentIssue(1)}
        onReviewPreviousIssue={() => reviewComponentIssue(-1)}
        onReviewNextIssue={() => reviewComponentIssue(1)}
        source={{
          fileName: `${selected?.id || "works"}.mdx`,
          label: `${selected?.title || "Works"} MDX source`,
          value: sourceDraft,
          onChange: setSourceDraft,
          disabled: saving,
        }}
      >
        {items.length === 0 ? (
          <StructuredCollectionEmpty noun="roles" searching={searching} />
        ) : null}
        {items.map(({ item, index }, visibleIndex) => {
          const issues = issuesForComponentEntry(item.id);
          const groupLabel = item.category === "passed" ? "Past" : "Recent";
          const previousItem = items[visibleIndex - 1]?.item;
          const previousGroup = previousItem
            ? previousItem.category === "passed"
              ? "Past"
              : "Recent"
            : "";
          return (
            <StructuredCollectionEntry
              key={item.id}
              id={item.id}
              groupLabel={groupLabel}
              previousGroupLabel={previousGroup}
              grouping={componentGrouping}
              title={item.role || item.affiliation || "Untitled work"}
              detail={item.period || item.category}
              state={deriveComponentEntryState(componentBaselineFingerprints, item)}
              issues={issues}
              expanded={componentExpandedIds.includes(item.id)}
              dragging={componentDragId === item.id}
              dropTarget={componentDropId === item.id}
              dragDisabled={searching}
              index={index}
              count={draft.items.length}
              onToggle={() => toggleComponentEntry(item.id)}
              onMove={(direction) => moveSelectedWorksItem(item.id, direction)}
              onDuplicate={() => duplicateWorksItem(item.id)}
              onDelete={() => deleteWorksItem(item.id)}
              onDragStart={(event) => handleComponentDragStart(event, item.id)}
              onDragEnd={() => {
                setComponentDragId("");
                setComponentDropId("");
              }}
              onDragOver={(event) => handleComponentDragOver(event, item.id)}
              onDrop={(event) => handleComponentDrop(event, item.id)}
            >
              <StructuredCollectionEntryForm
                item={item}
                fields={WORKS_ENTRY_FIELDS}
                issues={issues}
                disabled={blockingMutation}
                onChange={updateWorksItem}
                onComplete={() => completeComponentEntry(item.id)}
              />
            </StructuredCollectionEntry>
          );
        })}
      </StructuredCollectionEditor>
    );
  }

  function renderPublicationsEditor(draft: PublicationsComponentDraft) {
    const searching = Boolean(componentSearch.trim());
    const items = draft.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) =>
        matchesComponentItem(
          componentSearch,
          structuredCollectionSearchValues(item, PUBLICATION_ENTRY_FIELDS),
        ),
      );
    return (
      <StructuredCollectionEditor
        title="Publication rows"
        description="Edit titles, authors, venue, links, and labels directly. Advanced JSON remains preserved."
        count={draft.items.length}
        entryLabel="publications"
        addLabel="Add publication"
        onAdd={addPublicationEntry}
        search={componentSearch}
        onSearchChange={setComponentSearch}
        grouping={componentGrouping}
        onGroupingChange={setComponentGrouping}
        visibleEntryIds={items.map(({ item }) => item.id)}
        expandedEntryIds={componentExpandedIds}
        onExpandedEntryIdsChange={setComponentExpandedIds}
        issueCount={selectedComponentIssues.length}
        onReviewIssues={() => reviewComponentIssue(1)}
        onReviewPreviousIssue={() => reviewComponentIssue(-1)}
        onReviewNextIssue={() => reviewComponentIssue(1)}
        source={{
          fileName: `${selected?.id || "publications"}.mdx`,
          label: `${selected?.title || "Publications"} MDX source`,
          value: sourceDraft,
          onChange: setSourceDraft,
          disabled: saving,
        }}
      >
        {items.length === 0 ? (
          <StructuredCollectionEmpty noun="publications" searching={searching} />
        ) : null}
        {items.map(({ item, index }, visibleIndex) => {
          const issues = issuesForComponentEntry(item.id);
          const previousGroup = items[visibleIndex - 1]?.item.year || "";
          return (
            <StructuredCollectionEntry
              key={item.id}
              id={item.id}
              groupLabel={item.year || "No year"}
              previousGroupLabel={previousGroup}
              grouping={componentGrouping}
              title={item.title || "Untitled publication"}
              detail={item.year || "Publication"}
              state={deriveComponentEntryState(componentBaselineFingerprints, item)}
              issues={issues}
              expanded={componentExpandedIds.includes(item.id)}
              dragging={componentDragId === item.id}
              dropTarget={componentDropId === item.id}
              dragDisabled={searching}
              index={index}
              count={draft.items.length}
              onToggle={() => toggleComponentEntry(item.id)}
              onMove={(direction) => moveSelectedPublicationItem(item.id, direction)}
              onDuplicate={() => duplicatePublicationItem(item.id)}
              onDelete={() => deletePublicationItem(item.id)}
              onDragStart={(event) => handleComponentDragStart(event, item.id)}
              onDragEnd={() => {
                setComponentDragId("");
                setComponentDropId("");
              }}
              onDragOver={(event) => handleComponentDragOver(event, item.id)}
              onDrop={(event) => handleComponentDrop(event, item.id)}
            >
              <StructuredCollectionEntryForm
                item={item}
                fields={PUBLICATION_ENTRY_FIELDS}
                issues={issues}
                disabled={blockingMutation}
                onChange={updatePublicationItem}
                onComplete={() => completeComponentEntry(item.id)}
              />
            </StructuredCollectionEntry>
          );
        })}
      </StructuredCollectionEditor>
    );
  }

  async function selectManagedComponent(
    definition: ComponentDefinition,
    returnTarget: ComponentReturnTarget | null = null,
  ) {
    const opened = await selectContent("components", definition.name);
    if (!opened) return;
    setKind("components");
    setComponentReturnTarget(returnTarget);
  }

  function editManagedComponent(definition: ComponentDefinition) {
    const returnTarget =
      selected && (selected.kind === "pages" || selected.kind === "posts")
        ? { kind: selected.kind, id: selected.id, title: selected.title }
        : null;
    void selectManagedComponent(definition, returnTarget);
  }

  function editComponentByEmbedTag(embedTag: string) {
    const definition = componentDefinitions.find(
      (item) => item.embedTag === embedTag || item.name === embedTag,
    );
    if (!definition) {
      setWarning(`${embedTag} does not have a structured editor yet.`);
      return;
    }
    editManagedComponent(definition);
  }

  async function returnToComponentOrigin() {
    if (!componentReturnTarget) return;
    const target = componentReturnTarget;
    const opened = await selectContent(target.kind, target.id);
    if (opened) setComponentReturnTarget(null);
  }

  async function selectLibraryContent(nextKind: EditableKind, id: string) {
    const opened = await selectContent(nextKind, id);
    if (opened) setComponentReturnTarget(null);
  }

  function openDocumentKind(nextKind: "posts" | "pages") {
    if (!confirmDiscardChanges()) return;
    setArea("content");
    setKind(nextKind);
    setDocumentKind(nextKind);
    setContentSearch("");
    setContentMode("browse");
    setSelected(null);
    setSourceDraft("");
    setContentForm(EMPTY_CONTENT_FORM);
    setContentFormBaseline("");
    setSlugDraft("");
    setLocalAutosaveAt("");
    setLocalDraftSnapshot(null);
    setInspectorOpen(false);
    setComponentReturnTarget(null);
  }

  function closeSelectedContent() {
    if (!confirmDiscardChanges()) return;
    setContentMode("browse");
    if (selected?.kind === "posts" || selected?.kind === "pages") {
      setDocumentKind(selected.kind);
    }
    setSelected(null);
    setSourceDraft("");
    setContentForm(EMPTY_CONTENT_FORM);
    setContentFormBaseline("");
    setSlugDraft("");
    setLocalAutosaveAt("");
    setLocalDraftSnapshot(null);
    setInspectorOpen(false);
    setComponentReturnTarget(null);
  }

  function changeContentPicker(value: string) {
    if (value === "home" || value === "now") {
      changeArea(value);
      return;
    }
    if (value === "posts" || value === "pages") {
      openDocumentKind(value);
      return;
    }
    const componentName = value.replace(/^component:/, "");
    const definition = componentDefinitions.find((item) => item.name === componentName);
    if (definition) void selectManagedComponent(definition);
  }

  function renderContentLibrary() {
    const pickerValue =
      area === "home" || area === "now"
        ? area
        : selected?.kind === "components"
          ? `component:${selected.id}`
          : documentKind;
    return (
      <Card className={styles.sidePanel}>
        <div className={styles.panelHeader}>
          <div>
            <h2 className={styles.panelTitle}>Content</h2>
          </div>
        </div>

        <label className={styles.mobileContentPicker}>
          <span>Browse content</span>
          <select
            className={styles.textField}
            value={pickerValue}
            onChange={(event) => changeContentPicker(event.target.value)}
          >
            <optgroup label="Site">
              <option value="home">Home</option>
              <option value="now">Now</option>
            </optgroup>
            <optgroup label="Documents">
              <option value="posts">Posts</option>
              <option value="pages">Pages</option>
            </optgroup>
            <optgroup label="Collections">
              {componentDefinitions.map((definition) => (
                <option key={definition.name} value={`component:${definition.name}`}>
                  {definition.label}
                </option>
              ))}
            </optgroup>
          </select>
        </label>

        <div className={styles.contentNavSection}>
          <p className={styles.inspectorLabel}>Site</p>
          <button
            type="button"
            className={styles.contentNavButton}
            data-active={area === "home"}
            onClick={() => changeArea("home")}
          >
            <span>Home</span>
            <small>Landing page</small>
          </button>
          <button
            type="button"
            className={styles.contentNavButton}
            data-active={area === "now"}
            onClick={() => changeArea("now")}
          >
            <span>Now</span>
            <small>Current status</small>
          </button>
        </div>

        <div className={styles.contentNavSection}>
          <p className={styles.inspectorLabel}>Documents</p>
          {(["posts", "pages"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={styles.contentNavButton}
              data-active={
                area === "content" &&
                documentKind === value &&
                selected?.kind !== "components"
              }
              onClick={() => openDocumentKind(value)}
            >
              <span>{titleForKind(value)}</span>
              <small>
                {countLabel(value === "posts" ? posts?.count : pages?.count)} items
              </small>
            </button>
          ))}
        </div>

        <div className={styles.contentNavSection}>
          <p className={styles.inspectorLabel}>Collections</p>
          {componentDefinitions.map((definition) => {
            const summary = componentSummaryFor(components, definition.name);
            return (
              <button
                key={definition.name}
                type="button"
                className={styles.contentNavButton}
                data-active={selected?.kind === "components" && selected.id === definition.name}
                onClick={() => void selectManagedComponent(definition)}
              >
                <span>{definition.label}</span>
                <small>{formatEntryCount(summary?.count ?? 0)}</small>
              </button>
            );
          })}
        </div>
      </Card>
    );
  }

  function renderDocumentIndex() {
    const searching = Boolean(contentSearch.trim());
    const indexedItems = searching
      ? globalSearchItems
      : visibleItems.map((item) => ({ kind: documentKind, item }));
    const typeLabel = titleForKind(documentKind);
    const placeholder = contentListPlaceholder({
      hasLoadedOnce,
      itemCount: indexedItems.length,
      searching,
    });

    return (
      <Card className={`${styles.editorPanel} ${styles.contentIndexPanel}`}>
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.cardLabel}>Documents</p>
            <h2 className={styles.panelTitle}>{searching ? "Search results" : typeLabel}</h2>
            <p className={styles.cardText}>
              {placeholder === "loading"
                ? "Loading content…"
                : searching
                  ? `${indexedItems.length} matching items across posts and pages.`
                  : `${indexedItems.length} ${documentKind === "posts" ? "posts" : "pages"}.`}
            </p>
          </div>
          <Button onClick={() => beginCreate(documentKind)} tone="accent" size="sm">
            New {documentKind === "posts" ? "post" : "page"}
          </Button>
        </div>

        <div className={styles.contentIndexToolbar}>
          <label className={styles.contentIndexSearch}>
            <span className={styles.visuallyHidden}>Search posts and pages</span>
            <input
              className={styles.textField}
              value={contentSearch}
              onChange={(event) => setContentSearch(event.target.value)}
              placeholder="Search posts and pages"
            />
          </label>
        </div>

        {placeholder === "loading" ? (
          <ul className={styles.contentIndexList} aria-hidden="true">
            {[0, 1, 2, 3].map((row) => (
              <li key={row}>
                <div className={styles.contentIndexSkeleton} />
              </li>
            ))}
          </ul>
        ) : placeholder === "ready" ? (
          <ul className={styles.contentIndexList}>
            {indexedItems.map(({ kind: itemKind, item }) => (
              <li key={`${itemKind}:${item.id}`}>
                <button
                  type="button"
                  className={styles.contentIndexRow}
                  onClick={() => void selectLibraryContent(itemKind, item.id)}
                >
                  <span className={styles.contentIndexPrimary}>
                    <strong>{item.title}</strong>
                    {searching ? <small>/{item.id}</small> : null}
                  </span>
                  <span className={styles.contentIndexMeta}>
                    {searching ? <small>{titleForKind(itemKind)}</small> : null}
                    {item.draft ? <span className={styles.contentStateBadge}>Hidden</span> : null}
                    <small>{item.meta}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.contentIndexEmpty}>
            <h3>
              {placeholder === "no-matches"
                ? "No matching content"
                : `No ${typeLabel.toLowerCase()} yet`}
            </h3>
            <p>
              {placeholder === "no-matches"
                ? "Try another title, slug, or metadata term."
                : "Create the first item here."}
            </p>
          </div>
        )}
      </Card>
    );
  }

  const resolvedCreateSlug = createSlug.trim() || slugFromTitle(createTitle);

  return (
    <main className={styles.shell} data-area={area}>
      <header className={styles.adminChrome}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Site Admin · {actor}</p>
            <h1 className={styles.title}>{areaTitle}</h1>
            <p className={styles.description}>{areaDescription}</p>
          </div>
          <div className={styles.heroActions}>
            <Button onClick={() => void refreshAll()} variant="subtle" size="sm" disabled={loading}>
              {loading ? "Refreshing" : "Refresh"}
            </Button>
            <Button href="/" variant="ghost" size="sm">
              Public site
            </Button>
          </div>
        </section>

        <nav className={styles.adminTabs} aria-label="Site Admin sections">
          {[
            ["content", "Content"],
            ["media", "Media"],
            ["release", "Publish"],
            ["settings", "Settings"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={styles.adminTab}
              data-active={
                id === "content"
                  ? area === "content" || area === "home" || area === "now"
                  : area === id
              }
              onClick={() => changeArea(id as Area)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {notice ? <StatusNotice tone="success">{notice}</StatusNotice> : null}
      {warning ? <StatusNotice tone="warning">{warning}</StatusNotice> : null}
      {error ? <StatusNotice tone="danger">{error}</StatusNotice> : null}

      {area === "content" ? (
        <section
          className={`${styles.workspaceGrid} ${styles.contentWorkspace}`}
          data-selected={selected ? "true" : "false"}
        >
          {renderContentLibrary()}

          {selected ? (
            <Card id="site-admin-editor-panel" className={styles.editorPanel}>
              <div className={styles.editorChrome}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.cardLabel}>{titleForKind(selected.kind)}</p>
                    <h2 className={styles.panelTitle}>{selected.title}</h2>
                    <p className={styles.cardText}>{selected.meta}</p>
                  </div>
                  <div className={styles.panelActions}>
                    <Button
                      onClick={
                        componentReturnTarget
                          ? () => void returnToComponentOrigin()
                          : closeSelectedContent
                      }
                      className={styles.backToContentButton}
                      variant="subtle"
                      size="sm"
                    >
                      {componentReturnTarget
                        ? `Back to ${componentReturnTarget.title}`
                        : selected.kind === "components"
                          ? "Back to content"
                          : `Back to ${selected.kind}`}
                    </Button>
                    <Button
                      id="site-admin-inspector-trigger"
                      onClick={() => setInspectorOpen((current) => !current)}
                      variant="subtle"
                      size="sm"
                      aria-expanded={inspectorOpen}
                    >
                      Inspector
                    </Button>
                    {selected.href ? (
                      <Button href={selected.href} variant="ghost" size="sm">
                        Open
                      </Button>
                    ) : null}
                    <Button
                      onClick={() => void saveSelectedContent()}
                      variant={selectedDirty ? "solid" : "subtle"}
                      tone={selectedDirty ? "accent" : "neutral"}
                      size="sm"
                      disabled={saving || !selectedDirty || componentSaveBlocked}
                    >
                      {saving ? "Saving" : "Save"}
                    </Button>
                  </div>
                </div>
                {selected.kind === "components" && componentReturnTarget ? (
                  <div className={styles.componentContextBar}>
                    <div>
                      <span>Embedded in</span>
                      <strong>{componentReturnTarget.title}</strong>
                    </div>
                    {selectedComponentDefinition?.primaryRoute ? (
                      <small>{selectedComponentDefinition.primaryRoute}</small>
                    ) : null}
                    <Button
                      onClick={() => void returnToComponentOrigin()}
                      variant="subtle"
                      size="sm"
                    >
                      Return to page
                    </Button>
                  </div>
                ) : null}
                <div className={styles.editorStatusBar}>
                  <span className={styles.statusPill} data-state={documentStatus.tone}>
                    {documentStatus.label}
                  </span>
                  {selectedIsStructured ? (
                    <button
                      type="button"
                      className={styles.statusPill}
                      data-state={selectedVisibility.state}
                      onClick={toggleSelectedVisibility}
                      title={selectedVisibility.actionLabel}
                      aria-label={selectedVisibility.actionLabel}
                    >
                      {selectedVisibility.label}
                    </button>
                  ) : null}
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
                    {releaseIsRunning ? (
                      <Button
                        onClick={() => changeArea("release")}
                        variant="subtle"
                        size="sm"
                      >
                        View release
                      </Button>
                    ) : liveSync.state !== "live" ? (
                      <Button
                        onClick={() => void publishSavedContent()}
                        tone="accent"
                        size="sm"
                        disabled={selectedDirty || publishBlocked}
                      >
                        {publishButtonLabel}
                      </Button>
                    ) : null}
                  </div>
                  {releaseIsRunning && releaseProgress ? (
                    <SiteAdminPublishingProgress progress={releaseProgress} />
                  ) : null}
                </div>
              </div>
                {selectedIsStructured ? (
                  <>
                    <div className={styles.editorTitleGrid}>
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
                    </div>
                    {selectedManagedComponent ? (
                      <>
                        <div className={styles.managedPagePanel}>
                          <div>
                            <p className={styles.cardLabel}>Managed collection</p>
                            <h3>{selectedManagedComponent.label} entries</h3>
                            <p>
                              This page renders the reusable{" "}
                              <code>{`<${selectedManagedComponent.embedTag || selectedManagedComponent.name} />`}</code>{" "}
                              block. Open its structured entries here; this page continues to own
                              the title, route, metadata, and advanced layout.
                            </p>
                          </div>
                          <div className={styles.managedPageMeta}>
                            <span>{formatEntryCount(selectedManagedSummary?.count ?? 0)}</span>
                            <Button
                              onClick={() => editManagedComponent(selectedManagedComponent)}
                              tone="accent"
                              size="sm"
                            >
                              Open structured entries
                            </Button>
                          </div>
                          {selectedManagedSummary?.rows?.length ? (
                            <div className={styles.managedPreviewList}>
                              {selectedManagedSummary.rows.slice(0, 4).map((row, index) => (
                                <div key={`${row.title}-${index}`}>
                                  <strong>{row.title}</strong>
                                  {row.detail ? <small>{row.detail}</small> : null}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <details className={styles.editorDetails}>
                          <summary>
                            <span>Advanced page source</span>
                            <small>{selectedManagedComponent.embedTag}</small>
                          </summary>
                          <div className={styles.editorDetailsBody}>
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
                                minHeight={320}
                                size="large"
                                blocking={blockingMutation}
                                initialMode="source"
                                visualEditing={false}
                              />
                            </div>
                          </div>
                        </details>
                      </>
                    ) : (
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
                          blocking={blockingMutation}
                          onEditComponent={editComponentByEmbedTag}
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {selectedIsNewsComponent && selectedNewsDraft ? (
                      renderNewsEditor(selectedNewsDraft)
                    ) : selectedTeachingDraft ? (
                      renderTeachingEditor(selectedTeachingDraft)
                    ) : selectedWorksDraft ? (
                      renderWorksEditor(selectedWorksDraft)
                    ) : selectedPublicationsDraft ? (
                      renderPublicationsEditor(selectedPublicationsDraft)
                    ) : (
                      <div className={styles.editorBodyShell}>
                        <SiteAdminMarkdownEditor
                          label={`${selected.title} MDX source`}
                          value={sourceDraft}
                          onChange={setSourceDraft}
                          minHeight={560}
                          size="large"
                          blocking={blockingMutation}
                          initialMode="source"
                          visualEditing={false}
                        />
                      </div>
                    )}
                  </>
                )}
            </Card>
          ) : (
            renderDocumentIndex()
          )}
          {inspectorOpen ? (
            <button
              type="button"
              className={styles.inspectorScrim}
              aria-hidden="true"
              tabIndex={-1}
              onClick={() => setInspectorOpen(false)}
            />
          ) : null}
          <Card
            id="site-admin-inspector"
            className={styles.inspectorPanel}
            data-open={inspectorOpen ? "true" : "false"}
            role="dialog"
            aria-modal="true"
            aria-label="Draft settings"
            aria-hidden={!inspectorOpen}
            inert={!inspectorOpen}
            tabIndex={-1}
          >
            {selected ? (
              <>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.cardLabel}>Inspector</p>
                    <h2 className={styles.panelTitle}>Draft settings</h2>
                  </div>
                  <Button
                    data-inspector-close
                    onClick={() => setInspectorOpen(false)}
                    variant="ghost"
                    size="sm"
                  >
                    Close
                  </Button>
                </div>

                <section className={styles.inspectorSection}>
                  <p className={styles.inspectorLabel}>State</p>
                  <div className={styles.inspectorPills}>
                    <span className={styles.statusPill} data-state={documentStatus.tone}>
                      {documentStatus.label}
                    </span>
                    {selectedIsStructured ? (
                      <button
                        type="button"
                        className={styles.statusPill}
                        data-state={selectedVisibility.state}
                        onClick={toggleSelectedVisibility}
                        title={selectedVisibility.actionLabel}
                        aria-label={selectedVisibility.actionLabel}
                      >
                        {selectedVisibility.label}
                      </button>
                    ) : null}
                  </div>
                  <p className={styles.editorHint}>{editorStatusHint}</p>
                  {releaseIsRunning && releaseProgress ? (
                    <SiteAdminPublishingProgress progress={releaseProgress} compact />
                  ) : null}
                </section>

                {selectedIsStructured ? (
                  <section className={styles.inspectorSection}>
                    <p className={styles.inspectorLabel}>Metadata</p>
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
                        checked={!contentForm.draft}
                        onChange={(event) =>
                          setContentForm((current) => ({
                            ...current,
                            draft: !event.target.checked,
                          }))
                        }
                      />
                      Visible on the public site
                    </label>
                    <label className={styles.fieldLabel}>
                      Description
                      <textarea
                        className={styles.inspectorTextarea}
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
                      <>
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
                        <div className={styles.assetField}>
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
                          <Button
                            onClick={() => setAssetPickerTarget("cover")}
                            variant="subtle"
                            size="sm"
                          >
                            Choose
                          </Button>
                        </div>
                        <div className={styles.assetField}>
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
                          <Button
                            onClick={() => setAssetPickerTarget("ogImage")}
                            variant="subtle"
                            size="sm"
                          >
                            Choose
                          </Button>
                        </div>
                      </>
                    ) : null}
                  </section>
                ) : null}

                {selectedManagedComponent ? (
                  <section className={styles.inspectorSection}>
                    <p className={styles.inspectorLabel}>Managed collection</p>
                    <div className={styles.inspectorStat}>
                      <span>{selectedManagedComponent.label}</span>
                      <strong>{formatEntryCount(selectedManagedSummary?.count ?? 0)}</strong>
                    </div>
                    <Button
                      onClick={() => editManagedComponent(selectedManagedComponent)}
                      variant="subtle"
                      size="sm"
                    >
                      Edit entries
                    </Button>
                  </section>
                ) : null}

                <section className={styles.inspectorSection}>
                  <p className={styles.inspectorLabel}>Version</p>
                  <div className={styles.inspectorStat}>
                    <span>Saved version</span>
                    <strong>{shortSha(selected.version)}</strong>
                  </div>
                  <SiteAdminVersionHistory
                    path={versionPathFor(selected.kind, selected.id)}
                    currentSource={selectedSourceDraft}
                    currentVersion={selected.version}
                    onRestored={async () => {
                      setBlockingMutation(true);
                      const token = selectionGateRef.current.current();
                      try {
                        clearLocalDraft(selected.kind, selected.id);
                        const detail = await readJson<EditableDetailPayload>(
                          endpointFor(selected.kind, selected.id),
                        );
                        applySelectedDetail(selected.kind, selected.id, detail, token);
                        await refreshLists();
                        await refreshSummaryOnly();
                        setNotice("Earlier version restored and saved.");
                      } finally {
                        setBlockingMutation(false);
                      }
                    }}
                  />
                </section>

                {isDeleteSupported(selected.kind) ? (
                  <details className={`${styles.editorDetails} ${styles.dangerZone}`}>
                    <summary>
                      <span>Danger zone</span>
                      <small>Delete this item</small>
                    </summary>
                    <div className={styles.editorDetailsBody}>
                      <p className={styles.editorHint}>
                        Deleting removes this draft and its public route. Version recovery remains
                        available only while the backend retains history.
                      </p>
                      <div className={styles.panelActions}>
                        <Button
                          onClick={() => void deleteSelectedContent()}
                          variant="subtle"
                          tone="danger"
                          size="sm"
                          disabled={saving}
                        >
                          Delete {titleForKind(selected.kind).toLowerCase()}
                        </Button>
                      </div>
                    </div>
                  </details>
                ) : null}
              </>
            ) : (
              <div className={styles.emptyInspector}>
                <p className={styles.cardLabel}>Inspector</p>
                <h2 className={styles.panelTitle}>No item selected</h2>
                <p className={styles.cardText}>
                  Select content to edit metadata, route, publish state, and recovery
                  information.
                </p>
              </div>
            )}
          </Card>
        </section>
      ) : null}

      {area === "content" && contentMode === "create" ? (
        <div
          className={styles.drawerScrim}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setContentMode(selected ? "edit" : "browse");
            }
          }}
        >
          <Card className={styles.createDrawer} role="dialog" aria-modal="true" aria-label="New content">
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
                Close
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
                    setCreateBody(
                      value === "posts" ? "Write the post here." : "Write the page here.",
                    );
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
            <div className={styles.drawerFieldGrid}>
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
            </div>
            <label className={styles.fieldLabel}>
              Description
              <input
                className={styles.textField}
                value={createDescription}
                onChange={(event) => setCreateDescription(event.target.value)}
                placeholder="Optional"
              />
            </label>
            <label className={styles.checkField}>
              <input
                type="checkbox"
                checked={createVisible}
                onChange={(event) => setCreateVisible(event.target.checked)}
              />
              Visible on the public site
            </label>
            <div className={styles.createEditorShell}>
              <SiteAdminMarkdownEditor
                label="New content body"
                value={createBody}
                onChange={setCreateBody}
                minHeight={360}
                size="large"
                blocking={saving}
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
        </div>
      ) : null}

      {area === "media" ? (
        <SiteAdminMediaLibrary />
      ) : null}

      {area === "settings" ? (
        <SiteAdminSettingsPanel onDirtyChange={setSettingsDirty} />
      ) : null}

      {area === "release" ? (
        <section className={styles.releaseWorkspace}>
          <Card className={styles.releaseOverview}>
            <div className={styles.cardHeader}>
              <div>
                <p className={styles.cardLabel}>Release status</p>
                <h2 className={styles.cardTitle}>
                  {releaseIsRunning && releaseProgress
                    ? releaseProgress.label
                    : liveSync.state === "pending"
                      ? "Ready to publish"
                      : liveSync.state === "live"
                        ? "Live current"
                        : summaryError
                          ? "Release status unavailable"
                          : release?.headline || "Refresh release status"}
                </h2>
              </div>
              {releaseIsRunning || liveSync.state !== "live" ? (
                <span className={styles.statusPill} data-state={documentStatus.tone}>
                  {documentStatus.label}
                </span>
              ) : null}
            </div>
            <p className={styles.cardText}>
              {releaseIsRunning
                ? releaseProgress?.detail
                : liveSync.state === "pending"
                  ? `${liveSync.pendingCount || "Saved"} content change${
                      liveSync.pendingCount === 1 ? " is" : "s are"
                    } ready for the public site.`
                  : liveSync.state === "live"
                    ? "Saved content matches the public site."
                    : summaryError
                      ? `Could not load release status: ${summaryError}.`
                      : "Release status has not loaded yet."}
            </p>
            {releaseIsRunning && releaseProgress ? (
              <SiteAdminPublishingProgress progress={releaseProgress} />
            ) : null}
            <div className={styles.releaseSteps} aria-label="Release flow">
              <div data-active={liveSync.state !== "unknown" ? "true" : "false"}>
                <strong>Draft</strong>
                <small>Content is saved</small>
              </div>
              <div
                data-active={
                  liveSync.state === "pending" || releaseIsRunning ? "true" : "false"
                }
              >
                <strong>Publish</strong>
                <small>
                  {liveSync.pendingCount > 0
                    ? `${liveSync.pendingCount} saved change${
                        liveSync.pendingCount === 1 ? "" : "s"
                      } not yet live`
                    : releaseIsRunning
                      ? "Release in progress"
                      : "No pending content"}
                </small>
              </div>
              <div data-active={liveSync.state === "live" ? "true" : "false"}>
                <strong>Live</strong>
                <small>Public site is current</small>
              </div>
            </div>
            <div className={styles.panelActions}>
              {liveSync.state !== "live" || releaseIsRunning ? (
                <Button
                  onClick={() => void runSmartRelease()}
                  tone="accent"
                  disabled={publishBlocked}
                >
                  {releaseSaving
                    ? "Starting"
                    : releaseIsRunning
                      ? liveStatusLabel
                      : "Publish live"}
                </Button>
              ) : null}
              <Button onClick={() => void refreshAll()} variant="subtle" disabled={loading}>
                Refresh status
              </Button>
            </div>
          </Card>

          <details
            className={styles.releaseDisclosure}
            open={releaseIsRunning ? true : undefined}
          >
            <summary>
              <span>
                <strong>Release activity</strong>
                <small>Source, runner health, and recent jobs</small>
              </span>
              <span className={styles.muted}>
                {releaseIsRunning
                  ? "Publishing"
                  : releaseJobs?.[0]?.status || "No active release"}
              </span>
            </summary>
            <div className={styles.releaseDisclosureBody}>
              <div className={styles.releaseMetaRow}>
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
                    <dt>Deploy needed</dt>
                    <dd>{source?.pendingDeploy === true ? "Yes" : "No"}</dd>
                  </div>
                </dl>
                <div className={styles.releaseRunnerSummary}>
                  <span>Runner</span>
                  <strong>
                    {releaseProgress?.runnerState === "offline"
                      ? "Offline"
                      : activeReleaseRunners[0]?.status ||
                        (summaryError ? "Unavailable" : "Not seen")}
                  </strong>
                  <small>
                    Release jobs use the shared Site Admin queue. A queued job is preserved if
                    the runner is temporarily unavailable.
                  </small>
                </div>
              </div>
              <div className={styles.releaseJobsHeader}>
                <div>
                  <strong>Recent jobs</strong>
                  <small>Latest release activity across clients</small>
                </div>
                <Button onClick={() => void refreshReleaseJobs()} variant="subtle" size="sm">
                  Reload
                </Button>
              </div>
              {releaseJobsError ? (
                <p className={styles.cardText}>{releaseJobsError}</p>
              ) : releaseJobs === null ? (
                <LoadingState label="Loading release jobs…" />
              ) : releaseJobs.length === 0 ? (
                <p className={styles.cardText}>No release jobs recorded yet.</p>
              ) : (
                <ul className={styles.contentIndexList}>
                  {releaseJobs.slice(0, 6).map((job) => (
                    <li key={job.id}>
                      <div className={styles.contentIndexRow}>
                        <span className={styles.contentIndexPrimary}>
                          <strong>{job.script || job.action}</strong>
                          <small>
                            {job.id} · {job.target}
                          </small>
                        </span>
                        <span className={styles.contentIndexMeta}>
                          <span className={styles.contentStateBadge}>{job.status}</span>
                          <small>
                            {job.phase || formatWhen(job.updatedAt || job.createdAt)}
                          </small>
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>

          <details className={styles.releaseDisclosure}>
            <summary>
              <span>
                <strong>Diagnostics and recovery</strong>
                <small>Build details and raw status endpoints</small>
              </span>
            </summary>
            <div className={styles.releaseDisclosureBody}>
              <SiteAdminStatusPanel />
              <div className={styles.linkRow}>
                <Link href="/api/site-admin/status">API status</Link>
                <Link href="/api/site-admin/mobile/summary">Summary</Link>
                <Link href="/api/site-admin/release-jobs">Release jobs</Link>
              </div>
            </div>
          </details>
        </section>
      ) : null}

      {area === "home" ? (
        <section className={`${styles.workspaceGrid} ${styles.contentWorkspaceSimple}`}>
          {renderContentLibrary()}
          <Card className={styles.formPanel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.cardLabel}>Home</p>
              <h2 className={styles.panelTitle}>Landing page MDX</h2>
            </div>
            <Button
              onClick={() => void saveHome()}
              tone="accent"
              disabled={!home || saving || !homeDirty}
            >
              {saving ? "Saving" : "Save"}
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
              blocking={blockingMutation}
            />
          </label>
          <p className={styles.editorHint}>
            Source version {shortSha(home?.sourceVersion.fileSha)}. Empty body MDX
            renders the public home shell only.
          </p>
          {home ? (
            <details className={styles.editorDetails}>
              <summary>
                <span>Version history</span>
                <small>{shortSha(home.sourceVersion.fileSha)}</small>
              </summary>
              <div className={styles.editorDetailsBody}>
                <SiteAdminVersionHistory
                  path="content/home.json"
                  currentSource={JSON.stringify(home.data, null, 2)}
                  currentVersion={home.sourceVersion.fileSha}
                  onRestored={async () => {
                    await refreshAll();
                    setNotice("Earlier Home version restored.");
                  }}
                />
              </div>
            </details>
          ) : null}
          </Card>
        </section>
      ) : null}

      {area === "now" ? (
        <section className={`${styles.workspaceGrid} ${styles.contentWorkspaceSimple}`}>
          {renderContentLibrary()}
          <div className={styles.nowEditorStack}>
            <Card className={styles.formPanel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.cardLabel}>Now</p>
                <h2 className={styles.panelTitle}>Current status</h2>
              </div>
              <Button onClick={() => void saveNow()} tone="accent" disabled={!now || saving || !nowDirty}>
                {saving ? "Saving" : "Save"}
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
              Saved content can be published from the Publish tab.
            </p>
            {now ? (
              <details className={styles.editorDetails}>
                <summary>
                  <span>Version history</span>
                  <small>{shortSha(now.sourceVersion.fileSha)}</small>
                </summary>
                <div className={styles.editorDetailsBody}>
                  <SiteAdminVersionHistory
                    path="content/now.json"
                    currentSource={JSON.stringify(now.data, null, 2)}
                    currentVersion={now.sourceVersion.fileSha}
                    onRestored={async () => {
                      await refreshAll();
                      setNotice("Earlier Now version restored.");
                    }}
                  />
                </div>
              </details>
            ) : null}
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
          </div>
        </section>
      ) : null}

      {assetPickerTarget ? (
        <div className={styles.drawerScrim} role="presentation">
          <div className={styles.mediaPickerDialog} role="dialog" aria-modal="true">
            <SiteAdminMediaLibrary
              mode="pick"
              onClose={() => setAssetPickerTarget(null)}
              onSelect={(asset: SiteAdminAsset) => {
                const target = assetPickerTarget;
                setContentForm((current) => ({ ...current, [target]: asset.url }));
                setAssetPickerTarget(null);
              }}
            />
          </div>
        </div>
      ) : null}

      {conflict ? (
        <SiteAdminConflictDialog
          conflict={conflict}
          busy={saving}
          onReload={reloadConflictVersion}
          onKeepMine={() => void keepConflictEdits()}
          onClose={() => setConflict(null)}
        />
      ) : null}
    </main>
  );
}
