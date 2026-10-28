"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { EMPTY_CONTENT_FORM, formFromEditablePayload, sourceForEditedContent, frontmatterString, restoreDocumentForm, type EditableContentForm, type EditableKind } from "./site-admin-document-model";

import { SiteAdminStatusPanel } from "@/components/site-admin/status/panel";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Card } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/loading-state";
import { StatusNotice } from "@/components/ui/status-notice";
import type { PublicationReview } from "@/lib/shared/publication-snapshot";
import type {
  SiteAdminHomeData,
  SiteAdminNowData,
  SiteAdminNowUpdate,
} from "@jinnkunn/contracts/api";
import {
  SITE_COMPONENT_DEFINITIONS,
  isSiteComponentName,
  type SiteComponentName,
} from "@jinnkunn/content-core/components";
import type { SiteAdminMobileSummary } from "@/lib/site-admin/mobile-summary";
import {
  contentListPlaceholder,
  contentSaveEffects,
  countLabel,
  editorialStatus,
  liveSyncStatus,
  visibilityLabel,
} from "./site-admin-console-model";
import {
  pageBreadcrumb,
  pagePathLabel,
  type PageTreeNode,
} from "./site-admin-page-tree-model";
import {
  buildSiteAdminReleaseProgress,
  selectActiveReleaseJob,
  type SiteAdminReleaseJobLike,
} from "@/lib/site-admin/release-progress";
import {
  SiteAdminConflictDialog,
  type SiteAdminConflict,
} from "./site-admin-conflict-dialog";
import {
  componentConflictDetail,
  componentEntryDomId,
  todayInHalifax,
  type ComponentGrouping,
} from "./site-admin-structured-collection-model";
import { createCollectionActions } from "./site-admin-collection-actions";
import { SiteAdminCollectionGroupDialog, type CollectionGroupEdit, type CollectionGroupChange } from "./site-admin-collection-group-dialog";
import { useSiteAdminDraftPersistence } from "./use-site-admin-draft-persistence";
import { useSiteAdminSingletonDraft } from "./use-site-admin-singleton-draft";
import { useSiteAdminNavigationGuard, type SiteAdminNavigationActions } from "./use-site-admin-navigation-guard";
import { SiteAdminNavigationDialog } from "./site-admin-navigation-dialog";
import { useSiteAdminDocumentSession, type EditableDetail } from "./use-site-admin-document-session";
import { SiteAdminCollectionEditors } from "./site-admin-collection-editors";
import { SiteAdminHomeEditor } from "./site-admin-home-editor";
import { SiteAdminNowEditor } from "./site-admin-now-editor";
import { useSiteAdminWorkspaceLocation } from "./use-site-admin-workspace-location";
import { useSiteAdminReleaseMonitor, type ReleaseJobsPayload } from "./use-site-admin-release-monitor";
import { clearLocalDraft, readLocalDraft, requiresRecoveryReview } from "./site-admin-draft-storage";
import {
  collectionHistory as createCollectionHistory,
  commitCollectionDraft,
  parseCollectionDraft,
} from "./site-admin-collection-draft";
import {
  SiteAdminMediaLibrary,
  type SiteAdminAsset,
} from "./site-admin-media-library";
import { SiteAdminMarkdownEditor } from "./site-admin-markdown-editor";
import { SiteAdminPagePreview } from "./site-admin-page-preview";
import { CONTENT_TASK_FILTERS, contentMatchesTask, type ContentTaskFilter } from "./site-admin-content-tasks";
import { useSiteAdminContentLibrary } from "./use-site-admin-content-library";
import { useSiteAdminCollectionDraft } from "./use-site-admin-collection-draft";
import { useSiteAdminPublicationReview } from "./use-site-admin-publication-review";
import { SiteAdminPublicationReviewDialog } from "./site-admin-publication-review-dialog";
import { documentFieldProblems, documentDraftProblems } from "@/lib/shared/document-fields";
import { SiteAdminAnnouncementsPanel } from "./site-admin-announcements-panel";
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

type PageTreePayload = {
  slugs: string[];
  sourceVersion: SourceVersion;
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


type EditableSummary = {
  id: string;
  title: string;
  href: string;
  meta: string;
  draft?: boolean;
  version?: string;
  pending?: boolean;
  issueCount?: number;
  modifiedAt?: string | null;
  pinned?: boolean;
};

type EditableDetailPayload = {
  raw?: boolean;
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
  frontmatter?: Record<string, unknown>;
  frontmatterKeys?: string[];
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

type Area =
  | "content"
  | "media"
  | "release"
  | "settings"
  | "home"
  | "now"
  | "announcements";
type ContentMode = "browse" | "edit" | "create";

type ComponentReturnTarget = {
  kind: "posts" | "pages";
  id: string;
  title: string;
};

const DEFAULT_CREATE_BODY = "Write the post here.";
const COMPONENT_DEFINITIONS =
  SITE_COMPONENT_DEFINITIONS as readonly ComponentDefinition[];


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
    raw: payload.raw,
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
  const [pageTreeOrder, setPageTreeOrder] = useState<string[]>([]);
  const [posts, setPosts] = useState<PostsPayload | null>(null);
  const [components, setComponents] = useState<ComponentsPayload | null>(null);
  const [, setKind] = useState<EditableKind>("posts");
  const [contentMode, setContentMode] = useState<ContentMode>("browse");
  const [componentSearch, setComponentSearch] = useState("");
  const [componentGrouping, setComponentGrouping] =
    useState<ComponentGrouping>("auto");
  const [componentExpandedIds, setComponentExpandedIds] = useState<string[]>([]);
  const [groupEdit, setGroupEdit] = useState<CollectionGroupEdit | null>(null);
  const teachingDefaultsRef = useRef(new Map<string, { role: string; period: string }>());
  const [componentDragId, setComponentDragId] = useState("");
  const [componentDropId, setComponentDropId] = useState("");
  const [componentReturnTarget, setComponentReturnTarget] =
    useState<ComponentReturnTarget | null>(null);
  const {
    selected, setSelected, sourceDraft, setSourceDraft, contentForm, setContentForm,
    contentFormBaseline, setContentFormBaseline, slugDraft, setSlugDraft,
    localAutosaveAt, setLocalAutosaveAt, recoveredDocumentNeedsReview, setRecoveredDocumentNeedsReview,
    contentSavedAt, setContentSavedAt, localDraftSnapshot, setLocalDraftSnapshot,
    selectionGateRef, selectionLoadingRef, selectedSourceDraftRef,
    updateContentField,
  } = useSiteAdminDocumentSession();
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
  const [collectionPreviewOpen, setCollectionPreviewOpen] = useState(false);
  const [documentFocusRequest, setDocumentFocusRequest] = useState(0);
  const savedContentRevisionRef = useRef(0);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [announcementDirty, setAnnouncementDirty] = useState(false);
  const [announcementSaving, setAnnouncementSaving] = useState(false);
  const settingsNavigationRef = useRef<SiteAdminNavigationActions | null>(null);
  const announcementNavigationRef = useRef<SiteAdminNavigationActions | null>(null);
  const navigationSaveRef = useRef<() => Promise<boolean>>(async () => false);
  const discardEditorDraftsRef = useRef<() => void>(() => {});
  const discardActiveDraftsRef = useRef<() => void>(() => {});
  const [singletonConflict, setSingletonConflict] = useState<(SiteAdminConflict & { kind: "home" | "now"; version: string }) | null>(null);
  const [releaseJobs, setReleaseJobs] = useState<SiteAdminReleaseJobLike[] | null>(
    null,
  );
  const [releaseJobsError, setReleaseJobsError] = useState("");
  const shellRef = useRef<HTMLElement>(null);
  const chromeRef = useRef<HTMLElement>(null);
  const collectionViewsRef = useRef(new Map<string, { search: string; grouping: ComponentGrouping; scroll: number; expanded: string[] }>());
  const documentViewsRef = useRef(new Map<string, { search: string; scroll: number; task?: ContentTaskFilter }>());
  const saveSelectedContentRef = useRef<
    (options?: { quiet?: boolean }) => Promise<boolean | void>
  >(async () => {});
  const saveHomeRef = useRef<() => Promise<void>>(async () => {});
  const saveNowRef = useRef<() => Promise<void>>(async () => {});

  const { publicationReview, publicationReviewError, setPublicationReviewError, publicationReviewLoading, publishReviewOpen, setPublishReviewOpen, refreshPublicationReview } = useSiteAdminPublicationReview({
    ready: hasLoadedOnce,
    read: (signal) => readJson<PublicationReview>("/api/site-admin/publication-review", { signal }),
    onCountChange: setPendingPublishCount,
  });
  const rawPageItems = useMemo(() => contentItems({ kind: "pages", pages, posts, components }), [components, pages, posts]);
  const rawPostItems = useMemo(() => contentItems({ kind: "posts", pages, posts, components }), [components, pages, posts]);
  const { documentKind, setDocumentKind, showCollectionIndex, setShowCollectionIndex, contentSearch, setContentSearch, contentTask, setContentTask, setCollapsedPageSlugs, contentPins, taskMetadata, pageItems, postItems, visibleItems, globalSearchItems, pageTree, collapsedPageSlugSet } = useSiteAdminContentLibrary({ actor, rawPages: rawPageItems, rawPosts: rawPostItems, review: publicationReview, pageTreeOrder });
  const { collectionHistory, setCollectionHistory, collectionBaseline, setCollectionBaseline, selectedComponentName, collectionDraft, collectionDraftRef, collectionSource, selectedTeachingDraft, selectedComponentIssues, componentBaselineFingerprints, componentSaveProblems, componentSaveBlocked, checkpointCollectionEdit, undo: undoCollection, redo: redoCollection } = useSiteAdminCollectionDraft(selected, sourceDraft);

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

  const { releaseActivity, watchRelease } = useSiteAdminReleaseMonitor({
    releaseRunning: summary?.release.recommendedAction.kind === "watch-release",
    readJobs: () => readJson<ReleaseJobsPayload>("/api/site-admin/release-jobs?limit=30"),
    refreshSummary: refreshSummaryOnly,
    onActivity: () => setSummaryError(""),
    onError: setSummaryError,
    onFinished: (outcome, coveredRevision) => {
      if (outcome.state === "succeeded") {
        const remaining = Math.max(0, savedContentRevisionRef.current - coveredRevision);
        setPendingPublishCount(remaining);
        setError("");
        setNotice("Published successfully. Checking for newer saved drafts…");
        void refreshPublicationReview().then((review) => {
          setNotice(review
            ? review.changes.length
              ? "Published successfully. Newer drafts still need publishing."
              : "Published successfully. The public site is current."
            : "Published successfully. The remaining draft comparison is unavailable; refresh publication review.");
        });
      } else {
        setNotice("");
        setError(`${outcome.state === "canceled" ? "Publish canceled" : "Publish failed"}: ${outcome.message}`);
      }
    },
  });

  function recordSavedContent() {
    savedContentRevisionRef.current += 1;
    setPendingPublishCount((current) => current + 1);
    void refreshPublicationReview();
  }

  function publicationState(path: string) {
    const changed = publicationReview?.changes.some((item) => item.path === path || item.oldPath === path);
    return { pending: publicationReview ? Boolean(changed) : liveSync.state === "pending", live: publicationReview ? !changed : liveSync.state === "live" };
  }

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
    const shell = shellRef.current;
    const chrome = chromeRef.current;
    if (!shell || !chrome) return;
    const measure = () => shell.style.setProperty("--admin-chrome-height", `${chrome.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(chrome);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!selectedContentKey) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("site-admin-editor-panel")?.scrollIntoView({
        block: "start",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedContentKey]);

  const selectedPageBreadcrumb = useMemo(
    () =>
      selected?.kind === "pages"
        ? pageBreadcrumb(selected.id, pageItems, selected.title)
        : [],
    [pageItems, selected],
  );
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
  const selectedComponentDefinition = selectedComponentName
    ? componentDefinitions.find((definition) => definition.name === selectedComponentName) || null
    : null;
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
  const selectedIsStructured = !selected?.raw && (selected?.kind === "posts" || selected?.kind === "pages");
  const documentIssues = selectedIsStructured && selected && selected.kind !== "components" ? documentFieldProblems(contentForm, selected.kind) : [];
  const documentSaveIssues = selectedIsStructured && selected && selected.kind !== "components" ? documentDraftProblems(contentForm, selected.kind) : [];
  const selectedSourceDraft = selected
    ? selectedIsStructured
      ? sourceForEditedContent(selected.kind, contentForm)
      : collectionSource
    : "";
  const selectedDirty = Boolean(
    selected &&
      (selectedIsStructured
        ? selectedSourceDraft !== contentFormBaseline
        : collectionDraft
          ? JSON.stringify(collectionDraft) !== collectionBaseline
          : selectedSourceDraft !== selected.source),
  );
  selectedSourceDraftRef.current = selectedSourceDraft;
  saveSelectedContentRef.current = saveSelectedContent;
  const homeDirty = Boolean(home && `${homeTitle}\n${homeBody}` !== homeBaseline);
  const nowComparable = `${nowText}\n${nowContext}\n${nowLocation}\n${nowDate}`;
  const nowDirty = Boolean(now && nowComparable !== nowBaseline);
  const createDirty = contentMode === "create" && Boolean(createSlug || createDescription || createVisible ||
    createTitle !== (createKind === "posts" ? "Untitled Post" : "Untitled Page") ||
    createBody !== (createKind === "posts" ? "Write the post here." : "Write the page here.") || createDate !== todayInHalifax());
  const hasUnsavedChanges =
    selectedDirty || homeDirty || nowDirty || settingsDirty || announcementDirty || createDirty;
  const navigation = useSiteAdminNavigationGuard({
    dirty: hasUnsavedChanges,
    saving: saving || settingsSaving || announcementSaving,
    save: () => navigationSaveRef.current(),
    discard: () => discardActiveDraftsRef.current(),
    error,
  });
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
  // Autosave deliberately stops at the draft, so the console has to count the
  // saves itself rather than wait for the release summary to notice them.
  const liveSync = liveSyncStatus({
    releaseActionKind,
    pendingSaves: pendingPublishCount,
    releaseRunning: releaseIsRunning,
  });
  const publishBlocked =
    releaseSaving ||
    releaseIsRunning;
  const documentStatus = editorialStatus({
    saving,
    blocked: componentSaveBlocked || documentSaveIssues.length > 0,
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
    ? "Repair the source before saving. Recovery copy kept locally."
    : recoveredDocumentNeedsReview
    ? "Recovered edits are based on another version. Review them before saving the draft."
    : selectedDirty
    ? localAutosaveAt
      ? `Recovery copy saved ${formatWhen(localAutosaveAt)}`
      : "Autosave pending"
    : releaseIsRunning && releaseProgress
      ? releaseProgress.detail
    : liveSync.state === "pending"
      ? contentSavedAt
        ? `Draft saved ${formatWhen(contentSavedAt)} · not yet live`
        : "Saved content is not yet live"
      : contentSavedAt
        ? `Saved ${formatWhen(contentSavedAt)}`
        : liveSync.state === "live" ? "Saved content matches the public site" : "Publish status unavailable";
  const selectedVisibility = visibilityLabel(contentForm.draft);
  async function refreshAll() {
    setLoading(true);
    setError("");
    setWarning("");
    const results = await Promise.allSettled([
      readJson<SummaryPayload>("/api/site-admin/mobile/summary"),
      readJson<HomePayload>("/api/site-admin/home"),
      readJson<NowPayload>("/api/site-admin/now"),
      readJson<PagesPayload>("/api/site-admin/pages?drafts=1"),
      readJson<PageTreePayload>("/api/site-admin/pages/tree"),
      readJson<PostsPayload>("/api/site-admin/posts?drafts=1"),
      readJson<ComponentsPayload>("/api/site-admin/components"),
    ]);
    const failures: { scope: string; message: string }[] = [];
    const [
      summaryResult,
      homeResult,
      nowResult,
      pagesResult,
      pageTreeResult,
      postsResult,
      componentsResult,
    ] = results;

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

    if (pageTreeResult.status === "fulfilled") {
      setPageTreeOrder(pageTreeResult.value.slugs);
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

  const recoverySnapshot = useMemo(() => ({
    source: selectedSourceDraft,
    form: selectedIsStructured ? contentForm : undefined,
    collection: collectionDraft || undefined,
    baseVersion: selected?.version || "",
  }), [selectedSourceDraft, selectedIsStructured, contentForm, collectionDraft, selected?.version]);
  useSiteAdminDraftPersistence({
    kind: `${actor}:${selected?.kind || ""}`, id: selected?.id || "", dirty: selectedDirty, snapshot: recoverySnapshot,
    autosaveEnabled: area === "content" && contentMode !== "create" && !navigation.pending && !selected?.raw && !saving && !conflict && !componentSaveBlocked && documentSaveIssues.length === 0 && !recoveredDocumentNeedsReview,
    onSave: () => saveSelectedContentRef.current({ quiet: true }),
    onRecoverySaved: (at) => { setLocalAutosaveAt(at); setLocalDraftSnapshot(null); },
    onRecoveryFailure: () => setWarning("This browser could not keep a recovery copy. Save the draft before leaving."),
  });

  const homeForm = useMemo(() => ({ title: homeTitle, bodyMdx: homeBody }), [homeTitle, homeBody]);
  const nowForm = useMemo(() => ({ text: nowText, context: nowContext, location: nowLocation, date: nowDate }), [nowText, nowContext, nowLocation, nowDate]);
  const homeFormRef = useRef(homeForm); homeFormRef.current = homeForm;
  const nowFormRef = useRef(nowForm); nowFormRef.current = nowForm;
  const homePersistence = useSiteAdminSingletonDraft({
    kind: `${actor}:home`, id: "home", ready: Boolean(home), dirty: homeDirty,
    source: JSON.stringify(homeForm), form: homeForm, baseVersion: home?.sourceVersion.fileSha || "",
    enabled: area === "home" && !loading && !saving && !singletonConflict,
    pauseAutosave: navigation.pending,
    onSave: () => saveHome(), onRestore: (form) => { setHomeTitle(form.title); setHomeBody(form.bodyMdx); },
  });
  const nowPersistence = useSiteAdminSingletonDraft({
    kind: `${actor}:now`, id: "now", ready: Boolean(now), dirty: nowDirty,
    source: JSON.stringify(nowForm), form: nowForm, baseVersion: now?.sourceVersion.fileSha || "",
    enabled: area === "now" && !loading && !saving && !singletonConflict && Boolean(nowText.trim()),
    pauseAutosave: navigation.pending,
    onSave: () => saveNow(), onRestore: (form) => { setNowText(form.text); setNowContext(form.context); setNowLocation(form.location); setNowDate(form.date); },
  });
  saveHomeRef.current = async () => { await homePersistence.save(); };
  saveNowRef.current = async () => { await nowPersistence.save(); };
  navigationSaveRef.current = async () => {
    if (area === "settings") return await settingsNavigationRef.current?.save() ?? false;
    if (area === "announcements") return await announcementNavigationRef.current?.save() ?? false;
    if (area === "home") return homePersistence.save();
    if (area === "now") return nowPersistence.save();
    if (contentMode === "create") return createContent();
    return await saveSelectedContentRef.current() === true;
  };
  discardEditorDraftsRef.current = discardEditorDrafts;
  discardActiveDraftsRef.current = discardActiveDrafts;

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
      if (saving || navigation.pending) return;
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
  }, [area, homeDirty, nowDirty, saving, selectedDirty, navigation.pending]);

  function toggleSelectedVisibility() {
    setContentForm((current) => ({ ...current, draft: !current.draft }));
  }

  function setVersionRestoring(active: boolean) {
    setSaving(active);
    setBlockingMutation(active);
  }

  /**
   * Drops every editor draft. Confirming "discard" used to leave the draft in
   * state with the autosave timer still armed, so the edits were saved 1.6s
   * after the author said to throw them away.
   */
  function discardEditorDrafts() {
    settingsNavigationRef.current?.discard();
    announcementNavigationRef.current?.discard();
    if (selected && selectedDirty) clearLocalDraft(`${actor}:${selected.kind}`, selected.id);
    if (homeDirty) { homePersistence.dismiss(); homePersistence.resume(); }
    if (nowDirty) { nowPersistence.dismiss(); nowPersistence.resume(); }
    if (announcementDirty) clearLocalDraft(`${actor}:announcements`, "active");
    setSelected(null);
    setContentMode("browse");
    setSourceDraft("");
    setCollectionHistory(null);
    setCollectionBaseline("");
    setContentForm(EMPTY_CONTENT_FORM);
    setContentFormBaseline("");
    setSlugDraft("");
    setLocalAutosaveAt("");
    setRecoveredDocumentNeedsReview(false);
    setLocalDraftSnapshot(null);
    setComponentReturnTarget(null);
    setHomeTitle(home?.data.title || "");
    setHomeBody(home?.data.bodyMdx || "");
    setNowText(now?.data.current.text || "");
    setNowContext(now?.data.current.context || "");
    setNowLocation(now?.data.current.location || "");
    setNowDate(dateInputFromIso(now?.data.current.updatedAt));
  }

  function discardActiveDrafts() {
    settingsNavigationRef.current?.discard();
    announcementNavigationRef.current?.discard();
    if (selected && selectedDirty) {
      clearLocalDraft(`${actor}:${selected.kind}`, selected.id);
      setSourceDraft(selected.source);
      const form = formFromEditablePayload(selected.kind, selected.id, selected);
      setContentForm(form);
      setContentFormBaseline(selected.raw || selected.kind === "components" ? selected.source : sourceForEditedContent(selected.kind, form));
      const draft = selected.kind === "components" && !selected.raw && isSiteComponentName(selected.id) ? parseCollectionDraft(selected.id, selected.source) : null;
      setCollectionHistory(draft ? createCollectionHistory(draft) : null);
      setCollectionBaseline(draft ? JSON.stringify(draft) : "");
      setLocalDraftSnapshot(null); setRecoveredDocumentNeedsReview(false);
    }
    if (homeDirty) {
      homePersistence.dismiss(); homePersistence.resume();
      setHomeTitle(home?.data.title || ""); setHomeBody(home?.data.bodyMdx || "");
    }
    if (nowDirty) {
      nowPersistence.dismiss(); nowPersistence.resume();
      setNowText(now?.data.current.text || ""); setNowContext(now?.data.current.context || "");
      setNowLocation(now?.data.current.location || ""); setNowDate(dateInputFromIso(now?.data.current.updatedAt));
    }
    if (createDirty) setContentMode("browse");
  }

  async function changeArea(nextArea: Area) {
    if (nextArea === area) {
      setInspectorOpen(false);
      return;
    }
    if (!await navigation.authorize()) return;
    if (announcementDirty) clearLocalDraft(`${actor}:announcements`, "active");
    // A dirty settings draft is discarded by unmounting its panel; wiping the
    // document editor for it would throw away a selection that was never dirty.
    if (selectedDirty || homeDirty || nowDirty) discardEditorDraftsRef.current();
    setArea(nextArea);
    setInspectorOpen(false);
  }


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
      setShowCollectionIndex(false);
    }
    setContentMode("edit");
    setSelected(next);
    setDocumentFocusRequest(0);
    setSourceDraft(next.source);
    const draft = nextKind === "components" && !detail.raw && isSiteComponentName(id)
      ? parseCollectionDraft(id, next.source) : null;
    setCollectionHistory(draft ? createCollectionHistory(draft) : null);
    setCollectionBaseline(draft ? JSON.stringify(draft) : "");
    setSlugDraft(id);
    const form = formFromEditablePayload(nextKind, id, detail);
    setContentForm(form);
    const baseline =
      !detail.raw && (nextKind === "posts" || nextKind === "pages")
        ? sourceForEditedContent(nextKind, form)
        : next.source;
    setContentFormBaseline(baseline);
    const view = collectionViewsRef.current.get(id);
    setComponentSearch(view?.search || "");
    setComponentGrouping(view?.grouping || "auto");
    setComponentExpandedIds(view?.expanded || []);
    setComponentDragId("");
    setComponentDropId("");
    setLocalAutosaveAt("");
    setContentSavedAt("");
    const localDraft = readLocalDraft<EditableContentForm>(`${actor}:${nextKind}`, id);
    setRecoveredDocumentNeedsReview(false);
    setLocalDraftSnapshot(
      localDraft && (localDraft.source !== baseline ||
        (localDraft.collection && JSON.stringify(localDraft.collection) !== JSON.stringify(draft)))
        ? localDraft : null,
    );
    setArea("content");
    setInspectorOpen(false);
    if (view) window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => window.scrollTo({ top: view.scroll }));
    });
    return next;
  }

  async function selectContent(nextKind: EditableKind, id: string, discardConfirmed = false): Promise<boolean> {
    if (!discardConfirmed && area === "content" && selected?.kind === nextKind && selected.id === id) return true;
    if (
      (area !== "content" || (selected && (selected.kind !== nextKind || selected.id !== id))) &&
      !discardConfirmed && !await navigation.authorize()
    ) {
      return false;
    }
    if (area !== "content" && hasUnsavedChanges) discardEditorDraftsRef.current();
    rememberCollectionView();
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
      let detail: EditableDetailPayload;
      const normalList = nextKind === "posts" ? posts?.posts : nextKind === "pages" ? pages?.pages : undefined;
      const sourceNeedsRepair = nextKind !== "components" && publicationReview?.inventory?.some((item) => item.path === `${nextKind}/${id}.mdx` && (item.issues.some((issue) => issue.field === "source") || (normalList && !normalList.some((item) => item.slug === id) && item.issues.length)));
      try { detail = await readJson<EditableDetailPayload>(`${endpointFor(nextKind, id)}${sourceNeedsRepair ? "?raw=1" : ""}`); }
      catch (error) {
        const knownProblem = publicationReview?.inventory?.find((item) => item.path === `${nextKind}/${id}.mdx`)?.issues.length;
        if (nextKind === "components" || !knownProblem) throw error;
        detail = await readJson<EditableDetailPayload>(`${endpointFor(nextKind, id)}?raw=1`);
      }
      if (selectionGateRef.current.isStale(token)) return false;
      if (nextKind === "components" && publicationReview?.inventory?.find((item) => item.path === `components/${id}.mdx`)?.issues.some((issue) => issue.field === "source")) detail.raw = true;
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
    if (!selected || saving) return false;
    if (documentSaveIssues.length) {
      if (!options.quiet) { setWarning("Review the highlighted fields before saving."); focusDocumentField(documentSaveIssues[0].field); }
      return false;
    }
    if (componentSaveBlocked) {
      setWarning(
        componentSaveProblems[0].message,
      );
      return false;
    }
    const sourceAtStart = selectedSourceDraft;
    const collectionAtStart = collectionDraft;
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
      const newerLocalEdits = selectedSourceDraftRef.current !== sourceAtStart ||
        JSON.stringify(collectionDraftRef.current) !== JSON.stringify(collectionAtStart);
      setSelected(selectedAtStart.raw && newerLocalEdits ? { ...next, raw: true } : next);
      setSlugDraft(next.id);
      const form = formFromEditablePayload(
        selectedAtStart.kind,
        selectedAtStart.id,
        detail,
      );
      if (!newerLocalEdits) {
        setSourceDraft(next.source);
        if (!options.quiet) setContentForm(form);
      }
      setContentFormBaseline(
        newerLocalEdits
          ? sourceAtStart
          : !detail.raw && (selectedAtStart.kind === "posts" || selectedAtStart.kind === "pages")
            ? sourceForEditedContent(selectedAtStart.kind, form)
            : next.source,
      );
      if (collectionAtStart) setCollectionBaseline(JSON.stringify(collectionAtStart));
      if (!newerLocalEdits) {
        clearLocalDraft(`${actor}:${selectedAtStart.kind}`, selectedAtStart.id);
        setLocalAutosaveAt("");
      }
      setContentSavedAt(new Date().toISOString());
      setRecoveredDocumentNeedsReview(false);
      if (!newerLocalEdits) setLocalDraftSnapshot(null);
      recordSavedContent();
      saved = true;
      if (effects.announce) setNotice(`${next.title} saved.`);
    } catch (err) {
      if (selectionGateRef.current.isStale(token)) return;
      if (err instanceof SiteAdminRequestError && err.status === 409 && selectedAtStart) {
        try {
          const remotePayload = await readJson<EditableDetailPayload>(
            endpointFor(selectedAtStart.kind, selectedAtStart.id),
          );
          if (selectionGateRef.current.isStale(token)) return;
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

    if (!saved) return false;
    // Everything below is bookkeeping on top of a save that already succeeded,
    // so it runs outside the mutation's try: a list hiccup used to be reported
    // as a failed save even though the draft was persisted successfully.
    if (effects.reconcileLists && !(await refreshLists())) {
      setWarning("Saved. The content lists could not be refreshed — use Refresh to reload them.");
    }
    return true;
  }

  function reloadConflictVersion() {
    if (!conflict || !selected) return;
    applySelectedDetail(selected.kind, selected.id, conflict.remotePayload);
    clearLocalDraft(`${actor}:${selected.kind}`, selected.id);
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
      clearLocalDraft(`${actor}:${selected.kind}`, selected.id);
      setConflict(null);
      setWarning("");
      setContentSavedAt(new Date().toISOString());
      await refreshLists();
      recordSavedContent();
      await refreshSummaryOnly();
      setNotice("Your edits were saved as the latest Draft.");
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
      clearLocalDraft(`${actor}:${selected.kind}`, selected.id);
      setLocalAutosaveAt("");
      setContentSavedAt("");
      setLocalDraftSnapshot(null);
      await refreshLists();
      recordSavedContent();
      await refreshSummaryOnly();
      setNotice(`${selected.title} deleted from drafts. Review publication to update the public site.`);
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
      recordSavedContent();
      await refreshSummaryOnly();
      setNotice(`${selected.title} renamed in drafts. Review publication to update the public site.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
      setBlockingMutation(false);
    }
  }

  function restoreLocalDraft() {
    if (!selected || !localDraftSnapshot) return;
    const needsReview = requiresRecoveryReview(localDraftSnapshot, selected.version);
    if (needsReview && !window.confirm("A newer server draft exists. Restore the local copy for review? Autosave will stay paused until you save explicitly.")) return;
    setRecoveredDocumentNeedsReview(needsReview);
    if (selected.kind === "posts" || selected.kind === "pages") {
      if (!localDraftSnapshot.form) {
        setError("This local autosave cannot be restored into the structured editor.");
        return;
      }
      setContentForm(restoreDocumentForm(selected.kind, localDraftSnapshot.form, localDraftSnapshot.source));
    } else {
      setSourceDraft(localDraftSnapshot.source);
      if (selected.kind === "components" && isSiteComponentName(selected.id)) {
        const draft = localDraftSnapshot.collection?.name === selected.id
          ? localDraftSnapshot.collection
          : parseCollectionDraft(selected.id, localDraftSnapshot.source);
        setCollectionHistory(createCollectionHistory(draft));
      }
    }
    setLocalAutosaveAt(localDraftSnapshot.savedAt);
    setLocalDraftSnapshot(null);
    setNotice("Local autosave restored.");
  }

  async function beginCreate(nextKind?: "posts" | "pages") {
    if (!await navigation.authorize()) return;
    discardEditorDraftsRef.current();
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

  async function createContent(): Promise<boolean> {
    const slug = createSlug.trim() || slugFromTitle(createTitle);
    if (!slug) {
      setError("Slug is required.");
      return false;
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
      // The POST is committed. Do not offer to create it again if the detail read fails.
      setContentMode("browse");
      await selectContent(createKind, slug, true);
      setContentSavedAt(new Date().toISOString());
      recordSavedContent();
      await refreshSummaryOnly();
      setCreateSlug("");
      setCreateTitle(createKind === "posts" ? "Untitled Post" : "Untitled Page");
      setCreateDescription("");
      setCreateDate(todayInHalifax());
      setCreateBody(createKind === "posts" ? "Write the post here." : "Write the page here.");
      setCreateVisible(false);
      setNotice(`${slug} created as a draft. Review publication when ready.`);
      // refreshLists() reports instead of throwing, so say so rather than
      // leaving the sidebar quietly missing the new document.
      if (!listsRefreshed) {
        setWarning("Created. The content lists could not be refreshed — use Refresh to reload them.");
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
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
    const [pagesResult, pageTreeResult, postsResult, componentsResult] = await Promise.allSettled([
      readJson<PagesPayload>("/api/site-admin/pages?drafts=1"),
      readJson<PageTreePayload>("/api/site-admin/pages/tree"),
      readJson<PostsPayload>("/api/site-admin/posts?drafts=1"),
      readJson<ComponentsPayload>("/api/site-admin/components"),
    ]);
    if (pagesResult.status === "fulfilled") setPages(pagesResult.value);
    if (pageTreeResult.status === "fulfilled") setPageTreeOrder(pageTreeResult.value.slugs);
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

  async function queueSavedContentPublish(reason: string, reviewSnapshotSha: string): Promise<string> {
    const action = contentPublishActionForBrowser();
    if (!action) return "";
    const coveredRevision = savedContentRevisionRef.current;
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
            reviewSnapshotSha,
          },
        },
      );
      if (!payload.job?.id) {
        throw new Error("The release API did not return a job to track.");
      }
      watchRelease(payload.job.id, coveredRevision);
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
      throw new Error(`Publishing could not be queued: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function publishSavedContent() {
    if (!publicationReview || !publicationReview.changes.length || hasUnsavedChanges || publicationReviewLoading || publicationReviewError || publicationReview.validation?.blockers.length) return;
    setReleaseSaving(true);
    setError("");
    setWarning("");
    setNotice("");
    try {
      const publishNotice = await queueSavedContentPublish("content:publish-saved", publicationReview.snapshotSha);
      if (publishNotice) { setNotice(`Publish queued.${publishNotice}`); setPublishReviewOpen(false); }
    } catch (error) {
      await refreshPublicationReview();
      setPublicationReviewError(error instanceof Error ? error.message : String(error));
    } finally {
      setReleaseSaving(false);
    }
  }

  async function saveHome(expectedVersion?: string): Promise<boolean> {
    if (!home || saving) return false;
    const captured = homeFormRef.current;
    setSaving(true);
    setError("");
    setWarning("");
    setNotice("");
    try {
      const result = await writeJson<HomePostPayload>("/api/site-admin/home", "POST", {
        data: {
          ...home.data,
          ...captured,
        },
        expectedFileSha: expectedVersion ?? home.sourceVersion.fileSha,
      });
      setHome({ data: { ...home.data, ...captured }, sourceVersion: result.sourceVersion });
      setHomeBaseline(`${captured.title}\n${captured.bodyMdx}`);
      recordSavedContent();
      void refreshSummaryOnly();
      setNotice("Home draft saved. Review publication to update the public site.");
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (err instanceof SiteAdminRequestError && err.status === 409) {
        const remote = await readJson<HomePayload>("/api/site-admin/home").catch(() => null);
        if (remote) setSingletonConflict({ kind: "home", title: "Home", localSource: JSON.stringify(homeFormRef.current, null, 2), remoteSource: JSON.stringify(remote.data, null, 2), version: remote.sourceVersion.fileSha });
      }
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveNow(expectedVersion?: string): Promise<boolean> {
    if (!now || saving) return false;
    const captured = nowFormRef.current;
    setSaving(true);
    setError("");
    setWarning("");
    setNotice("");
    try {
      const next = await writeJson<NowPayload>("/api/site-admin/now", "POST", {
        action: "save-current",
        ...captured,
        expectedFileSha: expectedVersion ?? now.sourceVersion.fileSha,
      });
      setNow(next);
      setNowBaseline(`${captured.text}\n${captured.context}\n${captured.location}\n${captured.date}`);
      recordSavedContent();
      void refreshSummaryOnly();
      setNotice("Now draft saved. Review publication to update the public site.");
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (err instanceof SiteAdminRequestError && err.status === 409) {
        const remote = await readJson<NowPayload>("/api/site-admin/now").catch(() => null);
        if (remote) setSingletonConflict({ kind: "now", title: "Now", localSource: JSON.stringify(nowFormRef.current, null, 2), remoteSource: JSON.stringify(remote.data.current, null, 2), version: remote.sourceVersion.fileSha });
      }
      return false;
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
      recordSavedContent();
      setNotice("Now history draft updated.");
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
      recordSavedContent();
      setNotice("Now history deleted from drafts.");
      void refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const collectionActions = createCollectionActions({
    setCollectionHistory, setComponentExpandedIds, setComponentSearch, selectedComponentName, componentSearch,
    teachingTerm: selectedTeachingDraft?.items[0]?.term || "",
  });
  const { addTeachingEntry, updateTeachingTerm, moveWorksGroup, updatePublicationYear, reorderSelectedComponentItems } = collectionActions;

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
    checkpointCollectionEdit();
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
        const field = document.getElementById(`${componentEntryDomId(issue.entryId)}-drawer`)?.querySelector<HTMLElement>(
          `[data-component-field="${issue.field}"]`,
        );
        const input = field?.matches('input, textarea, select, [contenteditable="true"]')
          ? field : field?.querySelector<HTMLElement>('input, textarea, select, [contenteditable="true"]');
        input?.focus({ preventScroll: true });
      });
    });
  }

  function focusDocumentField(field: string) {
    const metadata = ["date", "updated", "cover", "ogImage"].includes(field);
    setInspectorOpen(metadata);
    if (field === "body") setDocumentFocusRequest((value) => value + 1);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const root = document.querySelector<HTMLElement>(`[data-document-field="${field}"]`);
      const control = root?.matches("input,textarea,select") ? root : root?.querySelector<HTMLElement>('input,textarea,select,[contenteditable="true"]');
      root?.scrollIntoView({ block: "center" });
      control?.focus({ preventScroll: true });
    }));
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


  function applyCollectionSource(source: string) {
    if (!selectedComponentName) return;
    const next = parseCollectionDraft(selectedComponentName, source);
    setCollectionHistory((current) => current
      ? commitCollectionDraft(current, next) : createCollectionHistory(next));
    setSourceDraft(source);
    setComponentExpandedIds([]);
  }

  function rememberCollectionView() {
    if (!selectedComponentName) return;
    collectionViewsRef.current.set(selectedComponentName, {
      search: componentSearch, grouping: componentGrouping, scroll: window.scrollY, expanded: componentExpandedIds,
    });
  }

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(`site-admin:views:${actor}`) || "{}");
      if (Array.isArray(saved.collections)) collectionViewsRef.current = new Map(saved.collections);
      if (Array.isArray(saved.documents)) documentViewsRef.current = new Map(saved.documents);
    } catch { /* Corrupt or unavailable preferences do not block editing. */ }
  }, [actor]);

  const workspaceRestored = useSiteAdminWorkspaceLocation({
    actor, ready: hasLoadedOnce,
    location: { area, view: showCollectionIndex ? "collections" : documentKind, ...(selected ? { kind: selected.kind, id: selected.id } : {}) },
    onRestore: async (next) => {
      if (next.area === area && next.kind === selected?.kind && next.id === selected?.id && next.view === (showCollectionIndex ? "collections" : documentKind)) {
        if (!selected) {
          const view = documentViewsRef.current.get(next.view);
          setContentSearch(view?.search || "");
          setContentTask(view?.task || "all");
          restoreBrowseScroll(view?.scroll || 0);
        }
        return true;
      }
      if (!await navigation.authorize()) return false;
      rememberCollectionView();
      if (next.area === "content" && next.kind && next.id) return selectContent(next.kind as EditableKind, next.id, true);
      discardEditorDraftsRef.current();
      selectionGateRef.current.open();
      setArea(next.area as Area);
      setShowCollectionIndex(next.view === "collections");
      setDocumentKind(next.view === "pages" ? "pages" : "posts");
      const view = documentViewsRef.current.get(next.view);
      setContentSearch(view?.search || "");
      setContentTask(view?.task || "all");
      restoreBrowseScroll(view?.scroll || 0);
      return true;
    },
  });

  useEffect(() => {
    if (!workspaceRestored) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const persist = () => {
      if (selectedComponentName) collectionViewsRef.current.set(selectedComponentName, { search: componentSearch, grouping: componentGrouping, expanded: componentExpandedIds, scroll: window.scrollY });
      if (!selected) documentViewsRef.current.set(showCollectionIndex ? "collections" : documentKind, { search: contentSearch, task: contentTask, scroll: window.scrollY });
      try { sessionStorage.setItem(`site-admin:views:${actor}`, JSON.stringify({ collections: [...collectionViewsRef.current], documents: [...documentViewsRef.current] })); } catch { /* Optional preference. */ }
    };
    const schedulePersist = () => {
      if (timer !== undefined) return;
      timer = setTimeout(() => { timer = undefined; persist(); }, 150);
    };
    persist();
    window.addEventListener("pagehide", persist);
    window.addEventListener("scroll", schedulePersist, { passive: true });
    return () => { clearTimeout(timer); window.removeEventListener("pagehide", persist); window.removeEventListener("scroll", schedulePersist); };
  }, [workspaceRestored, actor, selected, selectedComponentName, componentSearch, componentGrouping, componentExpandedIds, showCollectionIndex, documentKind, contentSearch, contentTask]);

  function addCourseToTerm(term: string) {
    addTeachingEntry(term, teachingDefaultsRef.current.get(term));
  }

  function applyGroupChange(change: CollectionGroupChange) {
    if (!groupEdit) return;
    if (groupEdit.kind === "teaching") {
      const defaults = { role: change.role, period: change.period };
      teachingDefaultsRef.current.set(change.label, defaults);
      if (groupEdit.term === null) addTeachingEntry(change.label, defaults);
      else {
        updateTeachingTerm(groupEdit.term, change.label, defaults, change.fillEmpty);
        if (groupEdit.term !== change.label) teachingDefaultsRef.current.delete(groupEdit.term);
      }
    } else if (groupEdit.kind === "publications") updatePublicationYear(groupEdit.year, change.label);
    else moveWorksGroup(groupEdit.category, change.label === "passed" ? "passed" : "recent");
    setGroupEdit(null);
  }

  async function publishCurrentContent() {
    await publishSavedContent();
  }


  const collectionEditorActions = {
    canUndo: Boolean(collectionHistory?.past.length),
    canRedo: Boolean(collectionHistory?.future.length),
    onUndo: undoCollection,
    onRedo: redoCollection,
    onCheckpoint: checkpointCollectionEdit,
    status: documentStatus.label,
    statusDetail: componentSaveBlocked ? "Recovery copy kept locally"
      : selectedDirty ? (saving ? "Saving draft…" : "Autosave pending") : contentSavedAt ? `Saved ${formatWhen(contentSavedAt)}` : "Draft saved",
    onSave: () => void saveSelectedContent(),
    saveDisabled: saving || !selectedDirty || componentSaveBlocked || loading || Boolean(conflict),
    onPublish: () => setPublishReviewOpen(true),
    publishDisabled: saving || releaseSaving || releaseIsRunning || componentSaveBlocked || loading || Boolean(conflict) || !contentPublishActionForBrowser() || (!selectedDirty && publishBlocked),
  };


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
    if (!selected) documentViewsRef.current.set(showCollectionIndex ? "collections" : documentKind, { search: contentSearch, task: contentTask, scroll: window.scrollY });
    const opened = await selectContent(nextKind, id);
    if (opened) setComponentReturnTarget(null);
  }

  async function openDocumentKind(nextKind: "posts" | "pages") {
    if (!await navigation.authorize()) return;
    rememberCollectionView();
    if (!selected) documentViewsRef.current.set(showCollectionIndex ? "collections" : documentKind, { search: contentSearch, task: contentTask, scroll: window.scrollY });
    setArea("content");
    selectionGateRef.current.open();
    selectionLoadingRef.current = "";
    setLoading(false);
    setKind(nextKind);
    setDocumentKind(nextKind);
    setShowCollectionIndex(false);
    const view = documentViewsRef.current.get(nextKind);
    setContentSearch(view?.search || "");
    setContentTask(view?.task || "all");
    setContentMode("browse");
    setSelected(null);
    setCollectionHistory(null);
    setCollectionBaseline("");
    setSourceDraft("");
    setContentForm(EMPTY_CONTENT_FORM);
    setContentFormBaseline("");
    setSlugDraft("");
    setLocalAutosaveAt("");
    setLocalDraftSnapshot(null);
    setInspectorOpen(false);
    setComponentReturnTarget(null);
    restoreBrowseScroll(view?.scroll || 0);
  }

  function restoreBrowseScroll(scroll: number) {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.scrollTo({ top: scroll })));
  }

  async function closeSelectedContent() {
    if (!await navigation.authorize()) return false;
    rememberCollectionView();
    selectionGateRef.current.open();
    selectionLoadingRef.current = "";
    setLoading(false);
    setContentMode("browse");
    const index = selected?.kind === "components" ? "collections" : selected?.kind || documentKind;
    setShowCollectionIndex(index === "collections");
    if (selected?.kind === "posts" || selected?.kind === "pages") {
      setDocumentKind(selected.kind);
    }
    setSelected(null);
    setSourceDraft("");
    setCollectionHistory(null);
    setCollectionBaseline("");
    setContentForm(EMPTY_CONTENT_FORM);
    setContentFormBaseline("");
    setSlugDraft("");
    setLocalAutosaveAt("");
    setLocalDraftSnapshot(null);
    setInspectorOpen(false);
    setComponentReturnTarget(null);
    const view = documentViewsRef.current.get(index);
    setContentSearch(view?.search || "");
    setContentTask(view?.task || "all");
    restoreBrowseScroll(view?.scroll || 0);
    void refreshLists();
    return true;
  }

  async function openCollectionIndex() {
    if (!selected) documentViewsRef.current.set(showCollectionIndex ? "collections" : documentKind, { search: contentSearch, task: contentTask, scroll: window.scrollY });
    if (!await closeSelectedContent()) return;
    setArea("content");
    setShowCollectionIndex(true);
    setContentSearch("");
    setContentTask(documentViewsRef.current.get("collections")?.task || "all");
    restoreBrowseScroll(documentViewsRef.current.get("collections")?.scroll || 0);
  }

  function changeContentPicker(value: string) {
    if (value.startsWith("pin:")) {
      const [, kind, id] = value.split(":");
      if (["posts", "pages", "components"].includes(kind) && id) void selectLibraryContent(kind as EditableKind, id);
      return;
    }
    if (value === "collections") {
      openCollectionIndex();
      return;
    }
    if (value === "home" || value === "now" || value === "announcements") {
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
    const collectionItems = contentItems({ kind: "components", pages, posts, components });
    const pinnedItems = contentPins.pins.flatMap((key) => {
      const [kind, id] = key.split(":") as [EditableKind, string];
      const item = (kind === "posts" ? postItems : kind === "pages" ? pageItems : collectionItems).find((item) => item.id === id);
      return item ? [{ key, kind, item }] : [];
    });
    const pickerValue =
      area === "home" || area === "now" || area === "announcements"
        ? area
        : selected && pinnedItems.some((pin) => pin.key === `${selected.kind}:${selected.id}`)
          ? `pin:${selected.kind}:${selected.id}`
        : selected?.kind === "components"
          ? `component:${selected.id}`
          : showCollectionIndex ? "collections" : documentKind;
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
            {pinnedItems.length ? <optgroup label="Pinned">{pinnedItems.map(({ key, item }) => <option key={key} value={`pin:${key}`}>{item.title}</option>)}</optgroup> : null}
            <optgroup label="Site">
              <option value="home">Home</option>
              <option value="now">Now</option>
              <option value="announcements">Announcements</option>
            </optgroup>
            <optgroup label="Documents">
              <option value="posts">Posts</option>
              <option value="pages">Pages</option>
            </optgroup>
            <optgroup label="Collections">
              <option value="collections">All collections</option>
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
          <button
            type="button"
            className={styles.contentNavButton}
            data-active={area === "announcements"}
            onClick={() => changeArea("announcements")}
          >
            <span>Announcements</span>
            <small>Notices and banners</small>
          </button>
        </div>

        {pinnedItems.length ? <div className={styles.contentNavSection}>
          <p className={styles.inspectorLabel}>Pinned</p>
          {pinnedItems.map(({ key, kind, item }) => <button key={key} type="button" className={styles.contentNavButton} onClick={() => void selectLibraryContent(kind, item.id)}><span>{item.title}</span></button>)}
        </div> : null}
        <div className={styles.contentNavSection}>
          <p className={styles.inspectorLabel}>Documents</p>
          {(["posts", "pages"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={styles.contentNavButton}
              data-active={
                area === "content" &&
                !showCollectionIndex &&
                documentKind === value &&
                selected?.kind !== "components"
              }
              onClick={() => openDocumentKind(value)}
            >
              <span>{titleForKind(value)}</span>
              <small>
                {countLabel(hasLoadedOnce ? value === "posts" ? postItems.length : pageItems.length : null)} items
              </small>
            </button>
          ))}
        </div>

        <div className={styles.contentNavSection}>
          <p className={styles.inspectorLabel}>Collections</p>
          <button type="button" className={styles.contentNavButton} data-active={!selected && showCollectionIndex && area === "content"} onClick={openCollectionIndex}><span>All collections</span><small>{componentDefinitions.length} collections</small></button>
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

  function togglePageBranch(slug: string) {
    setCollapsedPageSlugs((current) =>
      current.includes(slug)
        ? current.filter((item) => item !== slug)
        : [...current, slug],
    );
  }

  function renderPin(kind: EditableKind, item: EditableSummary) {
    const key = `${kind}:${item.id}`;
    const pinned = contentPins.pins.includes(key);
    return <IconButton label={`${pinned ? "Unpin" : "Pin"} ${item.title}`} active={pinned} aria-pressed={pinned} variant="ghost" size="sm" onClick={() => contentPins.toggle(key)}><span aria-hidden="true">{pinned ? "★" : "☆"}</span></IconButton>;
  }

  function renderIndexState(item: EditableSummary) {
    return <span className={styles.contentIndexMeta}>
      <span className={styles.contentTaskBadges}>
        {item.pending ? <span className={styles.contentStateBadge}>Pending publication</span> : item.pending === false && !item.issueCount ? <span className={styles.contentStateBadge}>Up to date</span> : null}
        {item.draft ? <span className={styles.contentStateBadge}>Hidden</span> : null}
        {item.issueCount ? <span className={styles.contentStateBadge} data-problem="true">{item.issueCount} {item.issueCount === 1 ? "issue" : "issues"}</span> : null}
      </span>
      <small>{contentTask === "recent" && item.modifiedAt ? `Modified ${formatWhen(item.modifiedAt)}` : item.meta}</small>
    </span>;
  }

  function renderTaskFilter() {
    return <div className={styles.contentTaskToolbar}>
      <label className={styles.fieldLabel}>Show
        <select className={styles.textField} value={contentTask} onChange={(event) => setContentTask(event.target.value as ContentTaskFilter)} aria-label="Content task filter">
          {CONTENT_TASK_FILTERS.map((filter) => <option key={filter.value} value={filter.value} disabled={!publicationReview && ["pending", "issues", "recent"].includes(filter.value)}>{filter.value === "recent" ? "Modified in the last 30 days" : filter.label}</option>)}
        </select>
      </label>
      {!publicationReview ? <span role="status">{publicationReviewError ? "Content status unavailable." : "Checking content status…"} {publicationReviewError ? <button type="button" onClick={() => void refreshPublicationReview()}>Retry status</button> : null}</span> : null}
      {contentTask !== "all" ? <Button variant="ghost" size="sm" onClick={() => setContentTask("all")}>Clear filter</Button> : null}
      {contentPins.unavailable ? <span role="status">Pins are available for this session only.</span> : null}
    </div>;
  }

  function renderPageTreeNodes(
    nodes: PageTreeNode<EditableSummary>[],
    nested = false,
  ) {
    return (
      <ul className={nested ? styles.pageTreeChildren : styles.pageTreeList}>
        {nodes.map((node) => {
          const hasChildren = node.children.length > 0;
          const expanded = hasChildren && (contentTask !== "all" || !collapsedPageSlugSet.has(node.slug));
          const childrenId = `site-admin-page-tree-${encodeURIComponent(node.slug)}`;
          const item = node.item;
          return (
            <li key={node.slug} className={styles.pageTreeItem}>
              <div className={styles.pageTreeRow}>
                {hasChildren ? (
                  <button
                    type="button"
                    className={styles.pageTreeDisclosure}
                    data-expanded={expanded}
                    aria-expanded={expanded}
                    aria-controls={childrenId}
                    aria-label={`${expanded ? "Collapse" : "Expand"} ${node.title}`}
                    title={`${expanded ? "Collapse" : "Expand"} ${node.title}`}
                    onClick={() => togglePageBranch(node.slug)}
                  >
                    <span aria-hidden="true">›</span>
                  </button>
                ) : (
                  <span className={styles.pageTreeDisclosureSpacer} aria-hidden="true" />
                )}

                {item ? (
                  <button
                    type="button"
                    className={styles.pageTreeSelect}
                    onClick={() => void selectLibraryContent("pages", item.id)}
                  >
                    <strong>{item.title}</strong>
                  </button>
                ) : (
                  <span className={styles.pageTreeFolder}>
                    <strong>{node.title}</strong>
                  </span>
                )}

                {item ? renderIndexState(item) : null}
                {item ? renderPin("pages", item) : null}
              </div>

              {expanded ? (
                <div id={childrenId}>{renderPageTreeNodes(node.children, true)}</div>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  function renderDocumentIndex() {
    const searching = Boolean(contentSearch.trim());
    const candidates = searching
      ? globalSearchItems
      : visibleItems.map((item) => ({ kind: documentKind, item }));
    const indexedItems = candidates.filter(({ item }) => contentMatchesTask({ ...item, issueCount: item.issueCount || 0 }, contentTask));
    if (contentTask === "recent") indexedItems.sort((a, b) => Date.parse(b.item.modifiedAt || "") - Date.parse(a.item.modifiedAt || ""));
    const typeLabel = titleForKind(documentKind);
    const placeholder = contentListPlaceholder({
      hasLoadedOnce,
      itemCount: indexedItems.length,
      searching: searching || contentTask !== "all",
    });

    return (
      <Card className={`${styles.editorPanel} ${styles.contentIndexPanel}`}>
        <div className={styles.contentIndexHeader}>
          <div className={styles.contentIndexHeading}>
            <p className={styles.cardLabel}>Documents</p>
            <div className={styles.contentIndexTitleLine}>
              <h2 className={styles.panelTitle}>{searching ? "Search results" : typeLabel}</h2>
              <span className={styles.contentIndexCount}>
                {placeholder === "loading"
                  ? "Loading…"
                  : searching
                    ? `${indexedItems.length} ${indexedItems.length === 1 ? "match" : "matches"}`
                    : `${indexedItems.length} ${documentKind === "posts" ? "posts" : "pages"}`}
              </span>
            </div>
          </div>
          <div className={styles.contentIndexHeaderActions}>
            <label className={styles.contentIndexSearch}>
              <span className={styles.visuallyHidden}>Search posts and pages</span>
              <input
                className={styles.textField}
                value={contentSearch}
                onChange={(event) => setContentSearch(event.target.value)}
                placeholder="Search posts and pages"
              />
            </label>
            <Button onClick={() => beginCreate(documentKind)} tone="accent" size="sm">
              New {documentKind === "posts" ? "post" : "page"}
            </Button>
          </div>
        </div>

        {renderTaskFilter()}
        {placeholder === "loading" ? (
          <ul className={styles.contentIndexList} aria-hidden="true">
            {[0, 1, 2, 3].map((row) => (
              <li key={row}>
                <div className={styles.contentIndexSkeleton} />
              </li>
            ))}
          </ul>
        ) : placeholder === "ready" && documentKind === "pages" && !searching && contentTask !== "recent" ? (
          renderPageTreeNodes(pageTree)
        ) : placeholder === "ready" ? (
          <ul className={styles.contentIndexList}>
            {indexedItems.map(({ kind: itemKind, item }) => (
              <li key={`${itemKind}:${item.id}`} className={styles.contentTaskRow}>
                <button
                  type="button"
                  className={styles.contentIndexRow}
                  onClick={() => void selectLibraryContent(itemKind, item.id)}
                >
                  <span className={styles.contentIndexPrimary}>
                    <strong>{item.title}</strong>
                    {searching || (documentKind === "pages" && contentTask === "recent") ? (
                      <small>
                        {itemKind === "pages"
                          ? `Pages / ${pagePathLabel(item.id, pageItems)}`
                          : `Posts / ${item.id}`}
                      </small>
                    ) : null}
                  </span>
                  {renderIndexState(item)}
                </button>
                {renderPin(itemKind, item)}
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
                ? "Try another search or clear the current filter."
                : "Create the first item here."}
            </p>
          </div>
        )}
      </Card>
    );
  }

  function renderCollectionIndex() {
    const items = contentItems({ kind: "components", pages, posts, components }).map((item) => taskMetadata("components", item)).filter((item) => contentMatchesTask({ ...item, issueCount: item.issueCount || 0 }, contentTask));
    if (contentTask === "recent") items.sort((a, b) => Date.parse(b.modifiedAt || "") - Date.parse(a.modifiedAt || ""));
    return <Card className={`${styles.editorPanel} ${styles.contentIndexPanel}`}>
      <div className={styles.contentIndexHeader}>
        <h2 className={styles.panelTitle}>Collections</h2>
        <span className={styles.contentIndexCount}>{items.length} collections</span>
      </div>
      {renderTaskFilter()}
      <ul className={styles.contentIndexList}>
        {items.map((item) => <li key={item.id} className={styles.contentTaskRow}>
          <button type="button" className={styles.contentIndexRow} onClick={() => void selectLibraryContent("components", item.id)}>
            <span className={styles.contentIndexPrimary}><strong>{item.title}</strong><small>{item.href}</small></span>
            {renderIndexState(item)}
          </button>
          {renderPin("components", item)}
        </li>)}
      </ul>
      {!items.length ? <p className={styles.contentIndexEmpty}>No collections match this filter.</p> : null}
    </Card>;
  }

  const resolvedCreateSlug = createSlug.trim() || slugFromTitle(createTitle);

  return (
    <main ref={shellRef} className={styles.shell} data-area={area} data-workspace-ready={workspaceRestored ? "true" : "false"}>
      <header ref={chromeRef} className={styles.adminChrome}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Site Admin · {actor}</p>
            <h1 className={styles.title}>{areaTitle}</h1>
          </div>
          <div className={styles.heroActions}>
            <Button onClick={async () => { if (await navigation.authorize()) { discardEditorDraftsRef.current(); void refreshAll(); } }} variant="subtle" size="sm" disabled={loading || saving}>
              {loading ? "Refreshing" : "Refresh"}
            </Button>
            <Button href="/" external variant="ghost" size="sm">
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
                  ? area === "content" || area === "home" || area === "now" || area === "announcements"
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
                    {selected.kind === "pages" ? (
                      <nav className={styles.pageBreadcrumb} aria-label="Page location">
                        <ol>
                          <li>Pages</li>
                          {selectedPageBreadcrumb.map((segment, index) => (
                            <li
                              key={segment.slug}
                              aria-current={
                                index === selectedPageBreadcrumb.length - 1 ? "page" : undefined
                              }
                            >
                              {segment.title}
                            </li>
                          ))}
                        </ol>
                      </nav>
                    ) : (
                      <p className={styles.cardLabel}>{titleForKind(selected.kind)}</p>
                    )}
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
                          ? "Back to collections"
                          : `Back to ${selected.kind}`}
                    </Button>
                    {collectionDraft ? (
                      <Button onClick={() => setCollectionPreviewOpen(true)} variant="subtle" size="sm">Page preview</Button>
                    ) : null}
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
                      <Button href={selected.href} external variant="ghost" size="sm">
                        Open
                      </Button>
                    ) : null}
                    <Button
                      onClick={() => void saveSelectedContent()}
                      className={styles.editorSaveButton}
                      variant="ghost"
                      size="sm"
                      disabled={saving || !selectedDirty || componentSaveBlocked || Boolean(conflict)}
                    >
                      {saving ? "Saving draft" : "Save draft"}
                    </Button>
                    <Button
                      onClick={() => setPublishReviewOpen(true)}
                      className={styles.editorPublishButton}
                      tone="accent"
                      size="sm"
                      disabled={collectionEditorActions.publishDisabled}
                    >
                      {releaseIsRunning ? "Publishing" : "Publish updates"}
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
                    ) : null}
                  </div>
                  {releaseIsRunning && releaseProgress ? (
                    <SiteAdminPublishingProgress progress={releaseProgress} />
                  ) : null}
                </div>
              </div>
                {documentIssues.length ? <section className={styles.validationSummary} aria-label="Fields needing attention">
                  <strong>{documentIssues.length} {documentIssues.length === 1 ? "field needs" : "fields need"} attention before publication</strong>
                  {!documentSaveIssues.length ? <p>Incomplete drafts can still be saved.</p> : null}
                  <ul>{documentIssues.map((issue) => <li key={issue.field}><button type="button" onClick={() => focusDocumentField(issue.field)}>{issue.message}</button></li>)}</ul>
                </section> : selected.raw ? <p className={styles.validationSummary} role="status">This document could not be read as structured content. Repair the source, then save to return to the regular editor.</p> : null}
                {selectedIsStructured ? (
                  <>
                    <div className={styles.editorTitleGrid}>
                      <label className={styles.fieldLabel}>
                        Title
                        <input
                          className={styles.textField}
                          data-document-field="title"
                          aria-label="Title"
                          aria-invalid={documentIssues.some((issue) => issue.field === "title")}
                          aria-describedby={documentIssues.some((issue) => issue.field === "title") ? "document-title-problem" : undefined}
                          value={contentForm.title}
                          onChange={(event) => updateContentField("title", event.target.value)}
                        />
                        {documentIssues.find((issue) => issue.field === "title") ? <small id="document-title-problem" className={styles.fieldError}>{documentIssues.find((issue) => issue.field === "title")?.message}</small> : null}
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
                                persistenceKey={`${actor}:${selected.kind}:${selected.id}`}
                                pagePreview={{ title: contentForm.title, routePath: selected.href, document: { kind: selected.kind === "posts" ? "posts" : "pages", slug: selected.id, source: selectedSourceDraft } }}
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
                      <div className={styles.editorBodyShell} data-document-field="body">
                        <SiteAdminMarkdownEditor
                          label={`${selected.title} body`}
                          persistenceKey={`${actor}:${selected.kind}:${selected.id}`}
                          focusRequest={documentFocusRequest}
                          pagePreview={{ title: contentForm.title, routePath: selected.href, document: { kind: selected.kind === "posts" ? "posts" : "pages", slug: selected.id, source: selectedSourceDraft } }}
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
                    {collectionDraft ? (
                      <SiteAdminCollectionEditors
                        draft={collectionDraft} actions={collectionActions} collectionEditorActions={collectionEditorActions}
                        componentSearch={componentSearch} setComponentSearch={setComponentSearch}
                        componentGrouping={componentGrouping} setComponentGrouping={setComponentGrouping}
                        componentExpandedIds={componentExpandedIds} setComponentExpandedIds={setComponentExpandedIds}
                        selectedComponentIssues={selectedComponentIssues} reviewComponentIssue={reviewComponentIssue}
                        selected={selected} collectionSource={collectionSource} applyCollectionSource={applyCollectionSource}
                        blockingMutation={blockingMutation} componentDragId={componentDragId} componentDropId={componentDropId}
                        setComponentDragId={setComponentDragId} setComponentDropId={setComponentDropId}
                        handleComponentDragStart={handleComponentDragStart} handleComponentDragOver={handleComponentDragOver} handleComponentDrop={handleComponentDrop}
                        issuesForComponentEntry={issuesForComponentEntry} componentBaselineFingerprints={componentBaselineFingerprints}
                        toggleComponentEntry={toggleComponentEntry} addCourseToTerm={addCourseToTerm} setGroupEdit={setGroupEdit} teachingDefaultsRef={teachingDefaultsRef}
                      />
                    ) : (
                      <div className={styles.editorBodyShell} data-document-field="body">
                        <SiteAdminMarkdownEditor
                          label={`${selected.title} MDX source`}
                          persistenceKey={`${actor}:${selected.kind}:${selected.id}`}
                          focusRequest={documentFocusRequest}
                          pagePreview={{ title: selected.title, routePath: selected.href, document: selected.kind === "components" ? undefined : { kind: selected.kind, slug: selected.id, source: selectedSourceDraft } }}
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
            showCollectionIndex ? renderCollectionIndex() : renderDocumentIndex()
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
                          data-document-field="date"
                          aria-label="Date"
                          aria-invalid={documentIssues.some((issue) => issue.field === "date")}
                          aria-describedby={documentIssues.some((issue) => issue.field === "date") ? "document-date-problem" : undefined}
                          value={contentForm.date}
                          onChange={(event) => updateContentField("date", event.target.value)}
                        />
                        {documentIssues.find((issue) => issue.field === "date") ? <small id="document-date-problem" className={styles.fieldError}>{documentIssues.find((issue) => issue.field === "date")?.message}</small> : null}
                      </label>
                    ) : (
                      <label className={styles.fieldLabel}>
                        Updated
                        <input
                          className={styles.textField}
                          type="date"
                          data-document-field="updated"
                          aria-invalid={documentIssues.some((issue) => issue.field === "updated")}
                          aria-describedby={documentIssues.some((issue) => issue.field === "updated") ? "document-updated-problem" : undefined}
                          value={contentForm.updated}
                          onChange={(event) => updateContentField("updated", event.target.value)}
                        />
                        {documentIssues.find((issue) => issue.field === "updated") ? <small id="document-updated-problem" className={styles.fieldError}>{documentIssues.find((issue) => issue.field === "updated")?.message}</small> : null}
                      </label>
                    )}
                    <label className={styles.checkField}>
                      <input
                        type="checkbox"
                        checked={!contentForm.draft}
                        onChange={(event) => updateContentField("draft", !event.target.checked)}
                      />
                      Visible on the public site
                    </label>
                    <label className={styles.fieldLabel}>
                      Description
                      <textarea
                        className={styles.inspectorTextarea}
                        value={contentForm.description}
                        onChange={(event) => updateContentField("description", event.target.value)}
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
                            onChange={(event) => updateContentField("tags", event.target.value)}
                            placeholder="Comma separated"
                          />
                        </label>
                        <div className={styles.assetField}>
                          <label className={styles.fieldLabel}>
                            Cover
                            <input
                              className={styles.textField}
                              data-document-field="cover"
                              aria-label="Cover"
                              aria-invalid={documentIssues.some((issue) => issue.field === "cover")}
                              aria-describedby={documentIssues.some((issue) => issue.field === "cover") ? "document-cover-problem" : undefined}
                              value={contentForm.cover}
                              onChange={(event) => updateContentField("cover", event.target.value)}
                              placeholder="Optional"
                            />
                            {documentIssues.find((issue) => issue.field === "cover") ? <small id="document-cover-problem" className={styles.fieldError}>{documentIssues.find((issue) => issue.field === "cover")?.message}</small> : null}
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
                              data-document-field="ogImage"
                              aria-label="OG image"
                              aria-invalid={documentIssues.some((issue) => issue.field === "ogImage")}
                              aria-describedby={documentIssues.some((issue) => issue.field === "ogImage") ? "document-ogImage-problem" : undefined}
                              value={contentForm.ogImage}
                              onChange={(event) => updateContentField("ogImage", event.target.value)}
                              placeholder="Optional"
                            />
                            {documentIssues.find((issue) => issue.field === "ogImage") ? <small id="document-ogImage-problem" className={styles.fieldError}>{documentIssues.find((issue) => issue.field === "ogImage")?.message}</small> : null}
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
                    beforeRestore={navigation.authorize}
                    onRestoringChange={setVersionRestoring}
                    onRestored={async () => {
                      setBlockingMutation(true);
                      const token = selectionGateRef.current.current();
                      try {
                        clearLocalDraft(`${actor}:${selected.kind}`, selected.id);
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
        <SiteAdminSettingsPanel onDirtyChange={setSettingsDirty} onSavingChange={setSettingsSaving} navigationActions={settingsNavigationRef} />
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
                  onClick={() => setPublishReviewOpen(true)}
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
          <SiteAdminHomeEditor home={home} homePersistence={homePersistence}
            homeTitle={homeTitle} setHomeTitle={setHomeTitle} homeBody={homeBody} setHomeBody={setHomeBody}
            homeDirty={homeDirty} saving={saving} publicationState={publicationState} shortSha={shortSha}
            onReview={() => setPublishReviewOpen(true)} beforeRestore={navigation.authorize}
            onRestored={async () => { await refreshAll(); recordSavedContent(); setNotice("Earlier Home draft restored. Review publication when ready."); }}
            onRestoringChange={setVersionRestoring}
            actor={actor} blockingMutation={blockingMutation}
          />
        </section>
      ) : null}

      {area === "announcements" ? (
        <section className={`${styles.workspaceGrid} ${styles.contentWorkspaceSimple}`}>
          {renderContentLibrary()}
          <SiteAdminAnnouncementsPanel
            actor={actor}
            {...publicationState("filesystem/announcements.json")}
            onReview={() => setPublishReviewOpen(true)}
            onDirtyChange={setAnnouncementDirty}
            onSavingChange={setAnnouncementSaving}
            beforeNavigate={navigation.authorize}
            navigationPending={navigation.pending}
            navigationActions={announcementNavigationRef}
            onSaved={(action) => {
              recordSavedContent();
              void (async () => {
                await refreshSummaryOnly();
                setNotice(`Announcement draft ${action === "delete" ? "deleted" : "saved"}. Review publication when ready.`);
              })();
            }}
          />
        </section>
      ) : null}

      {area === "now" ? (
        <section className={`${styles.workspaceGrid} ${styles.contentWorkspaceSimple}`}>
          {renderContentLibrary()}
          <SiteAdminNowEditor now={now} nowPersistence={nowPersistence}
            nowText={nowText} setNowText={setNowText} nowDate={nowDate} setNowDate={setNowDate} nowContext={nowContext} setNowContext={setNowContext} nowLocation={nowLocation} setNowLocation={setNowLocation} editingHistoryId={editingHistoryId} setEditingHistoryId={setEditingHistoryId} historyText={historyText} setHistoryText={setHistoryText} historyDate={historyDate} setHistoryDate={setHistoryDate}
            nowDirty={nowDirty} saving={saving} publicationState={publicationState} shortSha={shortSha}
            onReview={() => setPublishReviewOpen(true)} beforeRestore={navigation.authorize}
            onRestored={async () => { await refreshAll(); recordSavedContent(); setNotice("Earlier Now draft restored. Review publication when ready."); }}
            onRestoringChange={setVersionRestoring}
             formatWhen={formatWhen} saveHistoryEdit={saveHistoryEdit} startHistoryEdit={startHistoryEdit} deleteHistory={deleteHistory}
          />
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

      {groupEdit ? <SiteAdminCollectionGroupDialog group={groupEdit} onClose={() => setGroupEdit(null)} onApply={applyGroupChange} /> : null}

      {collectionPreviewOpen && selected?.kind === "components" ? <SiteAdminPagePreview title={selected.title} routePath={selected.href} component={selectedComponentName || undefined} source={selectedSourceDraft} onClose={() => setCollectionPreviewOpen(false)} /> : null}

      {publishReviewOpen ? <SiteAdminPublicationReviewDialog
        review={publicationReview} loading={publicationReviewLoading} error={publicationReviewError}
        busy={releaseSaving} disabled={hasUnsavedChanges || saving || releaseSaving || releaseIsRunning || !contentPublishActionForBrowser()}
        hasUnsaved={hasUnsavedChanges}
        target={contentPublishActionForBrowser() === "publish-content-production" ? "Production" : contentPublishActionForBrowser() === "publish-content-staging" ? "Staging" : "Local preview"}
        onClose={() => setPublishReviewOpen(false)} onRefresh={() => void refreshPublicationReview()} onConfirm={() => void publishCurrentContent()}
        onIssue={async (issue) => {
          setPublishReviewOpen(false);
          const match = /^(posts|pages|components)\/(.+)\.mdx$/.exec(issue.path);
          if (match) {
            const opened = selected?.kind === match[1] && selected.id === match[2] || await selectContent(match[1] as EditableKind, match[2]);
            if (!opened) return;
            if (match[1] === "components" && issue.entryId) focusComponentIssue({ entryId: issue.entryId, field: issue.field, message: issue.message });
            else focusDocumentField(issue.field);
          } else if (issue.path === "home.json") changeArea("home");
          else if (issue.path === "filesystem/announcements.json") changeArea("announcements");
          else changeArea("settings");
        }}
      /> : null}

      <SiteAdminNavigationDialog guard={navigation} />
      {conflict ? (
        <SiteAdminConflictDialog
          conflict={conflict}
          busy={saving}
          onReload={reloadConflictVersion}
          onKeepMine={() => void keepConflictEdits()}
          onClose={() => setConflict(null)}
        />
      ) : null}
      {singletonConflict ? <SiteAdminConflictDialog conflict={singletonConflict} busy={saving}
        onClose={() => setSingletonConflict(null)}
        onReload={() => {
          const copy = singletonConflict;
          void (async () => {
            if (copy.kind === "home") {
              const remote = await readJson<HomePayload>("/api/site-admin/home");
              setHome(remote); setHomeTitle(remote.data.title || ""); setHomeBody(remote.data.bodyMdx || "");
              setHomeBaseline(`${remote.data.title || ""}\n${remote.data.bodyMdx || ""}`); homePersistence.dismiss(); homePersistence.resume();
            } else {
              const remote = await readJson<NowPayload>("/api/site-admin/now");
              const date = dateInputFromIso(remote.data.current.updatedAt);
              setNow(remote); setNowText(remote.data.current.text || ""); setNowContext(remote.data.current.context || ""); setNowLocation(remote.data.current.location || ""); setNowDate(date);
              setNowBaseline(`${remote.data.current.text || ""}\n${remote.data.current.context || ""}\n${remote.data.current.location || ""}\n${date}`); nowPersistence.dismiss(); nowPersistence.resume();
            }
            setSingletonConflict(null); setError("");
          })().catch((error) => setError(error instanceof Error ? error.message : String(error)));
        }}
        onKeepMine={() => {
          const copy = singletonConflict;
          void (copy.kind === "home" ? saveHome(copy.version) : saveNow(copy.version)).then((saved) => {
            if (saved) { setSingletonConflict(null); (copy.kind === "home" ? homePersistence : nowPersistence).resume(); }
          });
        }} /> : null}
    </main>
  );
}
