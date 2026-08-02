"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusNotice } from "@/components/ui/status-notice";
import {
  parsePublicationsEntries,
  parseTeachingEntries,
  parseWorksEntries,
  type TeachingComponentEntry,
  type WorksComponentEntry,
} from "@/lib/components/parse";
import type {
  PublicationStructuredEntry,
  PublicationVenue,
} from "@/lib/seo/publications-items";
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
  SiteAdminConflictDialog,
  type SiteAdminConflict,
} from "./site-admin-conflict-dialog";
import {
  SiteAdminMediaLibrary,
  type SiteAdminAsset,
} from "./site-admin-media-library";
import { SiteAdminMarkdownEditor } from "./site-admin-markdown-editor";
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

type NewsDraftEntry = {
  id: string;
  type: "entry";
  date: string;
  body: string;
};

type NewsDraftDivider = {
  id: string;
  type: "divider";
};

type NewsDraftItem = NewsDraftEntry | NewsDraftDivider;

type NewsComponentDraft = {
  frontmatter: string;
  items: NewsDraftItem[];
};

type TeachingDraftEntry = TeachingComponentEntry & {
  id: string;
};

type TeachingComponentDraft = {
  frontmatter: string;
  items: TeachingDraftEntry[];
};

type WorksDraftEntry = WorksComponentEntry & {
  id: string;
};

type WorksComponentDraft = {
  frontmatter: string;
  items: WorksDraftEntry[];
};

type PublicationDraftEntry = PublicationStructuredEntry & {
  id: string;
};

type PublicationsComponentDraft = {
  frontmatter: string;
  items: PublicationDraftEntry[];
};

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

function managedComponentMeta(
  definition: ComponentDefinition,
  summary: ComponentSummary | undefined,
) {
  return `Managed · ${summary?.count ?? 0} ${
    summary?.entryLabel || definition.entryLabel || "entries"
  }`;
}

const NEWS_ATTR_RE = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/g;
const NEWS_ENTRY_RE = /<NewsEntry\b([\s\S]*?)>\s*([\s\S]*?)\s*<\/NewsEntry>/g;

function parseNewsAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of String(raw || "").matchAll(NEWS_ATTR_RE)) {
    attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

function componentFrontmatterFromSource(
  source: string,
  fallbackTitle: string,
): { frontmatter: string; body: string } {
  const normalized = String(source || "").replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n[\s\S]*?\n---\n*/);
  if (!match) {
    return {
      frontmatter: ["---", `title: ${frontmatterString(fallbackTitle)}`, "---"].join("\n"),
      body: normalized.trim(),
    };
  }
  return {
    frontmatter: match[0].trimEnd(),
    body: normalized.slice(match[0].length),
  };
}

function newsFrontmatterFromSource(source: string): { frontmatter: string; body: string } {
  return componentFrontmatterFromSource(source, "News");
}

function parseNewsDividerItems(segment: string, prefix: string): NewsDraftDivider[] {
  return String(segment || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => line === "---" || line === "***" || /^<hr\s*\/?>$/i.test(line))
    .map(({ index }) => ({ id: `${prefix}-divider-${index}`, type: "divider" as const }));
}

function parseNewsComponentDraft(source: string): NewsComponentDraft {
  const { frontmatter, body } = newsFrontmatterFromSource(source);
  const items: NewsDraftItem[] = [];
  let cursor = 0;
  let entryIndex = 0;
  let match: RegExpExecArray | null;
  NEWS_ENTRY_RE.lastIndex = 0;
  while ((match = NEWS_ENTRY_RE.exec(body)) !== null) {
    items.push(...parseNewsDividerItems(body.slice(cursor, match.index), `before-${entryIndex}`));
    const attrs = parseNewsAttrs(match[1] ?? "");
    items.push({
      id: `entry-${entryIndex}`,
      type: "entry",
      date: /^\d{4}-\d{2}-\d{2}$/.test(attrs.date || "") ? attrs.date : todayInHalifax(),
      body: (match[2] ?? "").trim(),
    });
    entryIndex += 1;
    cursor = NEWS_ENTRY_RE.lastIndex;
  }
  items.push(...parseNewsDividerItems(body.slice(cursor), "after"));
  return { frontmatter, items };
}

function serializeNewsComponentDraft(draft: NewsComponentDraft): string {
  const body = draft.items
    .map((item) => {
      if (item.type === "divider") return "---";
      const date = item.date || todayInHalifax();
      return [`<NewsEntry date="${date}">`, "", item.body.trimEnd(), "", "</NewsEntry>"].join(
        "\n",
      );
    })
    .join("\n\n");
  return [draft.frontmatter.trimEnd(), "", body.trimEnd(), ""].join("\n");
}

function jsxAttr(name: string, value: string | undefined) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const escaped = trimmed
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `${name}="${escaped}"`;
}

function compactAttrs(attrs: string[]) {
  return attrs.filter(Boolean).join(" ");
}

function jsonDataAttr(value: unknown) {
  return JSON.stringify(value).replace(/'/g, "\\u0027");
}

function parseTeachingComponentDraft(source: string): TeachingComponentDraft {
  const { frontmatter } = componentFrontmatterFromSource(source, "Teaching");
  return {
    frontmatter,
    items: parseTeachingEntries(source).map((entry, index) => ({
      id: `teaching-${index}`,
      ...entry,
    })),
  };
}

function serializeTeachingComponentDraft(draft: TeachingComponentDraft): string {
  const body = draft.items
    .map((entry) => {
      const attrs = compactAttrs([
        jsxAttr("term", entry.term),
        jsxAttr("period", entry.period),
        jsxAttr("role", entry.role),
        jsxAttr("courseCode", entry.courseCode),
        jsxAttr("courseName", entry.courseName),
        jsxAttr("courseUrl", entry.courseUrl),
        jsxAttr("instructor", entry.instructor),
      ]);
      return `<TeachingEntry ${attrs} />`;
    })
    .join("\n\n");
  return [draft.frontmatter.trimEnd(), "", body.trimEnd(), ""].join("\n");
}

function parseWorksComponentDraft(source: string): WorksComponentDraft {
  const { frontmatter } = componentFrontmatterFromSource(source, "Works");
  return {
    frontmatter,
    items: parseWorksEntries(source).map((entry, index) => ({
      id: `works-${index}`,
      ...entry,
    })),
  };
}

function serializeWorksComponentDraft(draft: WorksComponentDraft): string {
  const body = draft.items
    .map((entry) => {
      const attrs = compactAttrs([
        jsxAttr("category", entry.category),
        jsxAttr("role", entry.role),
        jsxAttr("affiliation", entry.affiliation),
        jsxAttr("affiliationUrl", entry.affiliationUrl),
        jsxAttr("location", entry.location),
        jsxAttr("period", entry.period),
      ]);
      return [`<WorksEntry ${attrs}>`, "", String(entry.body || "").trimEnd(), "", "</WorksEntry>"].join(
        "\n",
      );
    })
    .join("\n\n");
  return [draft.frontmatter.trimEnd(), "", body.trimEnd(), ""].join("\n");
}

function parsePublicationsComponentDraft(source: string): PublicationsComponentDraft {
  const { frontmatter } = componentFrontmatterFromSource(source, "Publications");
  return {
    frontmatter,
    items: parsePublicationsEntries(source).map((entry, index) => ({
      id: `publication-${index}`,
      ...entry,
    })),
  };
}

function serializePublicationsComponentDraft(draft: PublicationsComponentDraft): string {
  const body = draft.items
    .map((entry) => {
      const data = { ...entry, id: undefined };
      return `<PublicationsEntry data='${jsonDataAttr(data)}' />`;
    })
    .join("\n\n");
  return [draft.frontmatter.trimEnd(), "", body.trimEnd(), ""].join("\n");
}

function moveNewsItem(items: NewsDraftItem[], index: number, direction: -1 | 1) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  if (!item) return items;
  next.splice(nextIndex, 0, item);
  return next;
}

function moveDraftEntry<T>(items: T[], index: number, direction: -1 | 1) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  if (!item) return items;
  next.splice(nextIndex, 0, item);
  return next;
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
    const definitions = componentDefinitionsFromPayload(input.components);
    return (input.pages?.pages || []).map((item) => ({
      id: item.slug,
      title: item.title || item.slug,
      href: item.href,
      meta: (() => {
        const managed = findManagedComponentForPage(item, definitions);
        if (managed) {
          return managedComponentMeta(managed, componentSummaryFor(input.components, managed.name));
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
  const [kind, setKind] = useState<EditableKind>("posts");
  const [contentMode, setContentMode] = useState<ContentMode>("browse");
  const [contentSearch, setContentSearch] = useState("");
  const [componentSearch, setComponentSearch] = useState("");
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
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [releaseSaving, setReleaseSaving] = useState(false);
  const [releaseWatchUntil, setReleaseWatchUntil] = useState(0);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [assetPickerTarget, setAssetPickerTarget] = useState<"cover" | "ogImage" | null>(null);
  const [conflict, setConflict] = useState<(SiteAdminConflict & {
    remote: EditableDetail;
    remotePayload: EditableDetailPayload;
  }) | null>(null);
  const [notice, setNotice] = useState("");
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const selectedSourceDraftRef = useRef("");
  const saveSelectedContentRef = useRef<
    (options?: { quiet?: boolean }) => Promise<void>
  >(async () => {});
  const saveHomeRef = useRef<() => Promise<void>>(async () => {});
  const saveNowRef = useRef<() => Promise<void>>(async () => {});

  const currentItems = useMemo(
    () => contentItems({ kind, pages, posts, components }),
    [kind, pages, posts, components],
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
    return (["posts", "pages", "components"] as EditableKind[]).flatMap((itemKind) =>
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
  const release = summary?.release;
  const source = summary?.source;
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
  const hasUnsavedChanges = selectedDirty || homeDirty || nowDirty;
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
    ? "Saving"
    : selectedDirty
      ? "Unsaved edits"
      : "Saved";
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
      ? "Publishing"
      : releaseNeedsPublish
        ? "Ready to publish"
        : releaseActionKind === "noop"
          ? "Live current"
          : "Publish unavailable";
  const editorStatusHint = selectedDirty
    ? localAutosaveAt
      ? `Recovery copy saved ${formatWhen(localAutosaveAt)}. Save before publishing.`
      : "Unsaved edits are protected in this browser until saved."
    : releaseNeedsPublish
      ? release?.detail || "Saved content is ahead of the live site."
      : contentSavedAt
        ? `Saved ${formatWhen(contentSavedAt)}. ${release?.detail || ""}`.trim()
        : release?.headline || "Publish status unavailable";
  const publishButtonLabel = releaseSaving
    ? "Starting"
    : selectedDirty
      ? "Save first"
      : releaseActionKind === "noop"
        ? "Live current"
        : releaseUnavailable
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
    if (!selected || !selectedDirty || saving || conflict) return;
    const selectedKey = `${selected.kind}:${selected.id}`;
    const timer = window.setTimeout(() => {
      if (`${selected.kind}:${selected.id}` !== selectedKey) return;
      void saveSelectedContentRef.current({ quiet: true });
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [conflict, saving, selected, selectedDirty, selectedSourceDraft]);

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

  function confirmDiscardChanges(): boolean {
    if (!hasUnsavedChanges) return true;
    return window.confirm("You have unsaved edits. Discard them and continue?");
  }

  function changeArea(nextArea: Area) {
    if (nextArea === area || confirmDiscardChanges()) {
      setArea(nextArea);
      setInspectorOpen(false);
    }
  }

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

  function applySelectedDetail(
    nextKind: EditableKind,
    id: string,
    detail: EditableDetailPayload,
  ) {
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
    setComponentSearch("");
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
    setLoading(true);
    setError("");
    setWarning("");
    setNotice("");
    try {
      const detail = await readJson<EditableDetailPayload>(
        endpointFor(nextKind, id),
      );
      applySelectedDetail(nextKind, id, detail);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function saveSelectedContent(options: { quiet?: boolean } = {}) {
    if (!selected) return;
    const sourceAtStart = selectedSourceDraft;
    const selectedAtStart = selected;
    setSaving(true);
    setError("");
    setWarning("");
    setNotice("");
    try {
      await writeJson<MutationPayload>(endpointFor(selected.kind, selected.id), "PATCH", {
        source: sourceAtStart,
        version: selected.version,
      });
      const detail = await readJson<EditableDetailPayload>(
        endpointFor(selected.kind, selected.id),
      );
      const next = toEditableDetail(selected.kind, selected.id, detail);
      const newerLocalEdits = selectedSourceDraftRef.current !== sourceAtStart;
      setSelected(next);
      setSlugDraft(next.id);
      const form = formFromEditablePayload(selected.kind, selected.id, detail);
      if (!newerLocalEdits) {
        setSourceDraft(next.source);
        setContentForm(form);
      }
      setContentFormBaseline(
        newerLocalEdits
          ? sourceAtStart
          : selected.kind === "posts" || selected.kind === "pages"
            ? sourceForEditedContent(selected.kind, form)
            : next.source,
      );
      if (!newerLocalEdits) {
        clearLocalDraft(selected.kind, selected.id);
        setLocalAutosaveAt("");
      }
      setContentSavedAt(new Date().toISOString());
      if (!newerLocalEdits) setLocalDraftSnapshot(null);
      await refreshLists();
      await refreshSummaryOnly();
      if (!options.quiet) setNotice(`${next.title} saved.`);
    } catch (err) {
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
            remote,
            remotePayload,
          });
          setWarning("A newer saved version exists. Review both versions before continuing.");
        } catch (refreshError) {
          setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
        }
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSaving(false);
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
    setSaving(true);
    setError("");
    try {
      await writeJson<MutationPayload>(endpointFor(selected.kind, selected.id), "PATCH", {
        source: conflict.localSource,
        version: conflict.remote.version,
      });
      const detail = await readJson<EditableDetailPayload>(
        endpointFor(selected.kind, selected.id),
      );
      applySelectedDetail(selected.kind, selected.id, detail);
      clearLocalDraft(selected.kind, selected.id);
      setConflict(null);
      setWarning("");
      setContentSavedAt(new Date().toISOString());
      await refreshLists();
      await refreshSummaryOnly();
      setNotice("Your edits were saved as the latest Draft.");
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
      setNotice(`Publish job created${jobId}.`);
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
      setHomeTitle(next.data.title || "");
      setHomeBody(next.data.bodyMdx || "");
      setHomeBaseline(`${next.data.title || ""}\n${next.data.bodyMdx || ""}`);
      await refreshSummaryOnly();
      setNotice("Home saved.");
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
      await refreshSummaryOnly();
      setNotice("Now saved.");
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

  function updateNewsDraft(
    updater: (draft: NewsComponentDraft) => NewsComponentDraft,
  ) {
    const base = parseNewsComponentDraft(sourceDraft);
    setSourceDraft(serializeNewsComponentDraft(updater(base)));
  }

  function addNewsEntry() {
    updateNewsDraft((draft) => ({
      ...draft,
      items: [
        {
          id: `entry-new-${Date.now()}`,
          type: "entry",
          date: todayInHalifax(),
          body: "New update.",
        },
        ...draft.items,
      ],
    }));
  }

  function addNewsDivider() {
    updateNewsDraft((draft) => ({
      ...draft,
      items: [
        {
          id: `divider-new-${Date.now()}`,
          type: "divider",
        },
        ...draft.items,
      ],
    }));
  }

  function updateNewsItem(index: number, patch: Partial<NewsDraftEntry>) {
    updateNewsDraft((draft) => ({
      ...draft,
      items: draft.items.map((item, itemIndex) => {
        if (itemIndex !== index || item.type !== "entry") return item;
        return { ...item, ...patch };
      }),
    }));
  }

  function deleteNewsItem(index: number) {
    if (!window.confirm("Delete this News item?")) return;
    updateNewsDraft((draft) => ({
      ...draft,
      items: draft.items.filter((_item, itemIndex) => itemIndex !== index),
    }));
  }

  function duplicateNewsItem(index: number) {
    updateNewsDraft((draft) => {
      const source = draft.items[index];
      if (!source || source.type !== "entry") return draft;
      const copy = { ...source, id: `entry-copy-${Date.now()}` };
      return {
        ...draft,
        items: [...draft.items.slice(0, index + 1), copy, ...draft.items.slice(index + 1)],
      };
    });
  }

  function moveSelectedNewsItem(index: number, direction: -1 | 1) {
    updateNewsDraft((draft) => ({
      ...draft,
      items: moveNewsItem(draft.items, index, direction),
    }));
  }

  function updateTeachingDraft(
    updater: (draft: TeachingComponentDraft) => TeachingComponentDraft,
  ) {
    const base = parseTeachingComponentDraft(sourceDraft);
    setSourceDraft(serializeTeachingComponentDraft(updater(base)));
  }

  function addTeachingEntry() {
    updateTeachingDraft((draft) => ({
      ...draft,
      items: [
        {
          id: `teaching-new-${Date.now()}`,
          term: "New term",
          period: "",
          role: "",
          courseCode: "",
          courseName: "",
        },
        ...draft.items,
      ],
    }));
  }

  function updateTeachingItem(index: number, patch: Partial<TeachingDraftEntry>) {
    updateTeachingDraft((draft) => ({
      ...draft,
      items: draft.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    }));
  }

  function deleteTeachingItem(index: number) {
    if (!window.confirm("Delete this Teaching row?")) return;
    updateTeachingDraft((draft) => ({
      ...draft,
      items: draft.items.filter((_item, itemIndex) => itemIndex !== index),
    }));
  }

  function duplicateTeachingItem(index: number) {
    updateTeachingDraft((draft) => {
      const source = draft.items[index];
      if (!source) return draft;
      const copy = { ...source, id: `teaching-copy-${Date.now()}` };
      return {
        ...draft,
        items: [...draft.items.slice(0, index + 1), copy, ...draft.items.slice(index + 1)],
      };
    });
  }

  function moveSelectedTeachingItem(index: number, direction: -1 | 1) {
    updateTeachingDraft((draft) => ({
      ...draft,
      items: moveDraftEntry(draft.items, index, direction),
    }));
  }

  function updateWorksDraft(updater: (draft: WorksComponentDraft) => WorksComponentDraft) {
    const base = parseWorksComponentDraft(sourceDraft);
    setSourceDraft(serializeWorksComponentDraft(updater(base)));
  }

  function addWorksEntry() {
    updateWorksDraft((draft) => ({
      ...draft,
      items: [
        {
          id: `works-new-${Date.now()}`,
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
  }

  function updateWorksItem(index: number, patch: Partial<WorksDraftEntry>) {
    updateWorksDraft((draft) => ({
      ...draft,
      items: draft.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    }));
  }

  function deleteWorksItem(index: number) {
    if (!window.confirm("Delete this Work row?")) return;
    updateWorksDraft((draft) => ({
      ...draft,
      items: draft.items.filter((_item, itemIndex) => itemIndex !== index),
    }));
  }

  function duplicateWorksItem(index: number) {
    updateWorksDraft((draft) => {
      const source = draft.items[index];
      if (!source) return draft;
      const copy = { ...source, id: `works-copy-${Date.now()}` };
      return {
        ...draft,
        items: [...draft.items.slice(0, index + 1), copy, ...draft.items.slice(index + 1)],
      };
    });
  }

  function moveSelectedWorksItem(index: number, direction: -1 | 1) {
    updateWorksDraft((draft) => ({
      ...draft,
      items: moveDraftEntry(draft.items, index, direction),
    }));
  }

  function updatePublicationsDraft(
    updater: (draft: PublicationsComponentDraft) => PublicationsComponentDraft,
  ) {
    const base = parsePublicationsComponentDraft(sourceDraft);
    setSourceDraft(serializePublicationsComponentDraft(updater(base)));
  }

  function addPublicationEntry() {
    updatePublicationsDraft((draft) => ({
      ...draft,
      items: [
        {
          id: `publication-new-${Date.now()}`,
          title: "Untitled publication",
          year: new Date().getFullYear().toString(),
          url: "",
          labels: [],
        },
        ...draft.items,
      ],
    }));
  }

  function updatePublicationItem(index: number, patch: Partial<PublicationDraftEntry>) {
    updatePublicationsDraft((draft) => ({
      ...draft,
      items: draft.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    }));
  }

  function updatePublicationListField(
    index: number,
    field: "labels" | "highlights" | "externalUrls",
    value: string,
  ) {
    updatePublicationItem(index, {
      [field]: value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    } as Partial<PublicationDraftEntry>);
  }

  function publicationAuthorNames(item: PublicationDraftEntry) {
    if (item.authors?.length) return item.authors;
    return (item.authorsRich || []).map((author) => author.name).filter(Boolean);
  }

  function updatePublicationAuthors(index: number, value: string) {
    const names = value
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    updatePublicationsDraft((draft) => ({
      ...draft,
      items: draft.items.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const selfNames = new Set(
          (item.authorsRich || [])
            .filter((author) => author.isSelf)
            .map((author) => author.name.toLocaleLowerCase()),
        );
        return {
          ...item,
          authors: names,
          authorsRich: names.map((name) => ({
            name,
            isSelf: selfNames.has(name.toLocaleLowerCase()),
          })),
        };
      }),
    }));
  }

  function updatePublicationSelfAuthor(index: number, selfAuthor: string) {
    updatePublicationsDraft((draft) => ({
      ...draft,
      items: draft.items.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const names = publicationAuthorNames(item);
        return {
          ...item,
          authors: names,
          authorsRich: names.map((name) => ({
            name,
            isSelf: name === selfAuthor,
          })),
        };
      }),
    }));
  }

  function publicationPrimaryVenue(item: PublicationDraftEntry): PublicationVenue | null {
    return (
      (item.venues || []).find(
        (venue) => !/^(doi|arxiv(?:\.org)?)$/i.test(String(venue.type || "").trim()),
      ) || null
    );
  }

  function updatePublicationPrimaryVenue(
    index: number,
    patch: Partial<PublicationVenue>,
  ) {
    updatePublicationsDraft((draft) => ({
      ...draft,
      items: draft.items.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const venues = [...(item.venues || [])];
        const venueIndex = venues.findIndex(
          (venue) => !/^(doi|arxiv(?:\.org)?)$/i.test(String(venue.type || "").trim()),
        );
        const current =
          venueIndex >= 0
            ? venues[venueIndex]
            : { type: "Venue", text: item.venue || "" };
        const next = { ...current, ...patch };
        if (venueIndex >= 0) venues[venueIndex] = next;
        else venues.unshift(next);
        return {
          ...item,
          venue: next.text,
          venues,
        };
      }),
    }));
  }

  function deletePublicationItem(index: number) {
    if (!window.confirm("Delete this publication?")) return;
    updatePublicationsDraft((draft) => ({
      ...draft,
      items: draft.items.filter((_item, itemIndex) => itemIndex !== index),
    }));
  }

  function duplicatePublicationItem(index: number) {
    updatePublicationsDraft((draft) => {
      const source = draft.items[index];
      if (!source) return draft;
      const copy = { ...source, id: `publication-copy-${Date.now()}` };
      return {
        ...draft,
        items: [...draft.items.slice(0, index + 1), copy, ...draft.items.slice(index + 1)],
      };
    });
  }

  function moveSelectedPublicationItem(index: number, direction: -1 | 1) {
    updatePublicationsDraft((draft) => ({
      ...draft,
      items: moveDraftEntry(draft.items, index, direction),
    }));
  }

  function renderComponentItemActions(input: {
    index: number;
    count: number;
    onMove: (direction: -1 | 1) => void;
    onDuplicate: () => void;
    onDelete: () => void;
    reorderDisabled?: boolean;
  }) {
    return (
      <div className={styles.historyActions}>
        <Button
          onClick={() => input.onMove(-1)}
          variant="subtle"
          size="sm"
          disabled={input.reorderDisabled || input.index === 0}
        >
          Up
        </Button>
        <Button
          onClick={() => input.onMove(1)}
          variant="subtle"
          size="sm"
          disabled={input.reorderDisabled || input.index === input.count - 1}
        >
          Down
        </Button>
        <Button onClick={input.onDuplicate} variant="subtle" size="sm">
          Duplicate
        </Button>
        <Button onClick={input.onDelete} variant="subtle" tone="danger" size="sm">
          Delete
        </Button>
      </div>
    );
  }

  function componentItemMatches(values: Array<string | undefined>) {
    const query = componentSearch.trim().toLocaleLowerCase();
    if (!query) return true;
    return values.some((value) => String(value || "").toLocaleLowerCase().includes(query));
  }

  function renderComponentEditorHeader(input: {
    title: string;
    description: string;
    count: number;
    entryLabel: string;
    addLabel: string;
    onAdd: () => void;
    secondaryLabel?: string;
    onSecondary?: () => void;
  }) {
    return (
      <div className={styles.componentCollectionHeader}>
        <div className={styles.componentCollectionIntro}>
          <p className={styles.cardLabel}>Structured entries</p>
          <h3>{input.title}</h3>
          <p>{input.description}</p>
        </div>
        <div className={styles.componentCollectionTools}>
          <label className={styles.componentSearchField}>
            <span className={styles.visuallyHidden}>Search {input.entryLabel}</span>
            <input
              className={styles.textField}
              type="search"
              value={componentSearch}
              onChange={(event) => setComponentSearch(event.target.value)}
              placeholder={`Search ${input.entryLabel}`}
            />
          </label>
          <span className={styles.collectionCount}>
            {input.count} {input.entryLabel}
          </span>
          <div className={styles.panelActions}>
            {input.secondaryLabel && input.onSecondary ? (
              <Button onClick={input.onSecondary} variant="subtle" size="sm">
                {input.secondaryLabel}
              </Button>
            ) : null}
            <Button onClick={input.onAdd} tone="accent" size="sm">
              {input.addLabel}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  function renderCollectionEntryMeta(detail: string, ready: boolean) {
    return (
      <span className={styles.collectionEntryMeta}>
        <small>{detail}</small>
        <span className={styles.entryReadiness} data-ready={ready ? "true" : "false"}>
          {ready ? "Ready" : "Needs details"}
        </span>
      </span>
    );
  }

  function renderCollectionEmpty(noun: string) {
    const searching = Boolean(componentSearch.trim());
    return (
      <div className={styles.collectionEmpty}>
        <strong>
          {searching ? `No matching ${noun}` : `No ${noun} yet`}
        </strong>
        <span>
          {searching
            ? "Try a different title, date, or metadata value."
            : "Add the first entry to populate this collection."}
        </span>
      </div>
    );
  }

  function renderAdvancedComponentSource() {
    if (!selected) return null;
    return (
      <details className={styles.editorDetails}>
        <summary>
          <span>Advanced component source</span>
          <small>{selected.id}.mdx</small>
        </summary>
        <div className={styles.editorDetailsBody}>
          <SiteAdminMarkdownEditor
            label={`${selected.title} MDX source`}
            value={sourceDraft}
            onChange={setSourceDraft}
            minHeight={420}
            size="large"
            disabled={saving}
            initialMode="source"
            visualEditing={false}
          />
        </div>
      </details>
    );
  }

  function renderNewsEditor(draft: NewsComponentDraft) {
    const searching = Boolean(componentSearch.trim());
    const items = draft.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        if (item.type === "divider") return !searching;
        return componentItemMatches([item.date, item.body]);
      });

    return (
      <div className={styles.newsEditor}>
        {renderComponentEditorHeader({
          title: "News entries",
          description:
            "Edit dated updates directly. The public News page keeps using the same reusable collection.",
          count: draft.items.filter((item) => item.type === "entry").length,
          entryLabel: "updates",
          addLabel: "Add update",
          onAdd: addNewsEntry,
          secondaryLabel: "Add divider",
          onSecondary: addNewsDivider,
        })}
        <div className={styles.newsEntryList}>
          {items.length === 0
            ? renderCollectionEmpty("updates")
            : null}
          {items.map(({ item, index }) =>
            item.type === "divider" ? (
              <div key={item.id} className={styles.newsDividerRow}>
                <span>Divider</span>
                <div className={styles.historyActions}>
                  <Button
                    onClick={() => moveSelectedNewsItem(index, -1)}
                    variant="subtle"
                    size="sm"
                    disabled={index === 0}
                  >
                    Up
                  </Button>
                  <Button
                    onClick={() => moveSelectedNewsItem(index, 1)}
                    variant="subtle"
                    size="sm"
                    disabled={index === draft.items.length - 1}
                  >
                    Down
                  </Button>
                  <Button
                    onClick={() => deleteNewsItem(index)}
                    variant="subtle"
                    tone="danger"
                    size="sm"
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ) : (
              <details key={item.id} className={styles.newsEntryCard}>
                <summary className={styles.collectionEntrySummary}>
                  <strong>{item.body.split("\n")[0] || "Untitled update"}</strong>
                  {renderCollectionEntryMeta(
                    item.date || "No date",
                    Boolean(item.date.trim() && item.body.trim()),
                  )}
                </summary>
                {renderComponentItemActions({
                  index,
                  count: draft.items.length,
                  reorderDisabled: searching,
                  onMove: (direction) => moveSelectedNewsItem(index, direction),
                  onDuplicate: () => duplicateNewsItem(index),
                  onDelete: () => deleteNewsItem(index),
                })}
                <label className={styles.fieldLabel}>
                  Date
                  <input
                    className={styles.textField}
                    type="date"
                    value={item.date}
                    onChange={(event) => updateNewsItem(index, { date: event.target.value })}
                  />
                </label>
                <label className={styles.fieldLabel}>
                  Body
                  <textarea
                    className={styles.newsEntryBody}
                    value={item.body}
                    onChange={(event) => updateNewsItem(index, { body: event.target.value })}
                    disabled={saving}
                  />
                </label>
              </details>
            ),
          )}
        </div>
        {renderAdvancedComponentSource()}
      </div>
    );
  }

  function renderTeachingEditor(draft: TeachingComponentDraft) {
    const items = draft.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) =>
        componentItemMatches([
          item.term,
          item.period,
          item.role,
          item.courseCode,
          item.courseName,
          item.instructor,
        ]),
      );
    return (
      <div className={styles.newsEditor}>
        {renderComponentEditorHeader({
          title: "Teaching rows",
          description:
            "Edit course rows directly. The MDX source remains available under Advanced.",
          count: draft.items.length,
          entryLabel: "courses",
          addLabel: "Add course",
          onAdd: addTeachingEntry,
        })}
        <div className={styles.newsEntryList}>
          {items.length === 0 ? renderCollectionEmpty("courses") : null}
          {items.map(({ item, index }) => (
            <details key={item.id} className={styles.newsEntryCard}>
              <summary className={styles.collectionEntrySummary}>
                <strong>
                  {item.courseCode || item.courseName || item.term || "Untitled course"}
                </strong>
                {renderCollectionEntryMeta(
                  item.term || item.period || "Course",
                  Boolean(
                    item.term.trim() && (item.courseCode.trim() || item.courseName.trim()),
                  ),
                )}
              </summary>
              {renderComponentItemActions({
                index,
                count: draft.items.length,
                reorderDisabled: Boolean(componentSearch.trim()),
                onMove: (direction) => moveSelectedTeachingItem(index, direction),
                onDuplicate: () => duplicateTeachingItem(index),
                onDelete: () => deleteTeachingItem(index),
              })}
              <div className={styles.componentEntryGrid}>
                <label className={styles.fieldLabel}>
                  Term
                  <input
                    className={styles.textField}
                    value={item.term}
                    onChange={(event) => updateTeachingItem(index, { term: event.target.value })}
                  />
                </label>
                <label className={styles.fieldLabel}>
                  Period
                  <input
                    className={styles.textField}
                    value={item.period}
                    onChange={(event) => updateTeachingItem(index, { period: event.target.value })}
                  />
                </label>
                <label className={styles.fieldLabel}>
                  Role
                  <input
                    className={styles.textField}
                    value={item.role}
                    onChange={(event) => updateTeachingItem(index, { role: event.target.value })}
                  />
                </label>
                <label className={styles.fieldLabel}>
                  Course code
                  <input
                    className={styles.textField}
                    value={item.courseCode}
                    onChange={(event) =>
                      updateTeachingItem(index, { courseCode: event.target.value })
                    }
                  />
                </label>
                <label className={styles.fieldLabel}>
                  Course name
                  <input
                    className={styles.textField}
                    value={item.courseName}
                    onChange={(event) =>
                      updateTeachingItem(index, { courseName: event.target.value })
                    }
                  />
                </label>
                <label className={styles.fieldLabel}>
                  Instructor
                  <input
                    className={styles.textField}
                    value={item.instructor || ""}
                    onChange={(event) =>
                      updateTeachingItem(index, { instructor: event.target.value })
                    }
                  />
                </label>
                <label className={styles.fieldLabel}>
                  Course URL
                  <input
                    className={styles.textField}
                    value={item.courseUrl || ""}
                    onChange={(event) =>
                      updateTeachingItem(index, { courseUrl: event.target.value })
                    }
                  />
                </label>
              </div>
            </details>
          ))}
        </div>
        {renderAdvancedComponentSource()}
      </div>
    );
  }

  function renderWorksEditor(draft: WorksComponentDraft) {
    const items = draft.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) =>
        componentItemMatches([
          item.category,
          item.role,
          item.affiliation,
          item.location,
          item.period,
          item.body,
        ]),
      );
    return (
      <div className={styles.newsEditor}>
        {renderComponentEditorHeader({
          title: "Work rows",
          description:
            "Edit roles, affiliations, periods, and body text without touching MDX tags.",
          count: draft.items.length,
          entryLabel: "roles",
          addLabel: "Add role",
          onAdd: addWorksEntry,
        })}
        <div className={styles.newsEntryList}>
          {items.length === 0 ? renderCollectionEmpty("roles") : null}
          {items.map(({ item, index }) => (
            <details key={item.id} className={styles.newsEntryCard}>
              <summary className={styles.collectionEntrySummary}>
                <strong>{item.role || item.affiliation || "Untitled work"}</strong>
                {renderCollectionEntryMeta(
                  item.period || item.category,
                  Boolean(item.role.trim() && item.period.trim()),
                )}
              </summary>
              {renderComponentItemActions({
                index,
                count: draft.items.length,
                reorderDisabled: Boolean(componentSearch.trim()),
                onMove: (direction) => moveSelectedWorksItem(index, direction),
                onDuplicate: () => duplicateWorksItem(index),
                onDelete: () => deleteWorksItem(index),
              })}
              <div className={styles.componentEntryGrid}>
                <label className={styles.fieldLabel}>
                  Category
                  <select
                    className={styles.textField}
                    value={item.category}
                    onChange={(event) =>
                      updateWorksItem(index, {
                        category: event.target.value === "passed" ? "passed" : "recent",
                      })
                    }
                  >
                    <option value="recent">Recent</option>
                    <option value="passed">Past</option>
                  </select>
                </label>
                <label className={styles.fieldLabel}>
                  Role
                  <input
                    className={styles.textField}
                    value={item.role}
                    onChange={(event) => updateWorksItem(index, { role: event.target.value })}
                  />
                </label>
                <label className={styles.fieldLabel}>
                  Affiliation
                  <input
                    className={styles.textField}
                    value={item.affiliation || ""}
                    onChange={(event) =>
                      updateWorksItem(index, { affiliation: event.target.value })
                    }
                  />
                </label>
                <label className={styles.fieldLabel}>
                  Affiliation URL
                  <input
                    className={styles.textField}
                    value={item.affiliationUrl || ""}
                    onChange={(event) =>
                      updateWorksItem(index, { affiliationUrl: event.target.value })
                    }
                  />
                </label>
                <label className={styles.fieldLabel}>
                  Location
                  <input
                    className={styles.textField}
                    value={item.location || ""}
                    onChange={(event) => updateWorksItem(index, { location: event.target.value })}
                  />
                </label>
                <label className={styles.fieldLabel}>
                  Period
                  <input
                    className={styles.textField}
                    value={item.period}
                    onChange={(event) => updateWorksItem(index, { period: event.target.value })}
                  />
                </label>
              </div>
              <label className={styles.fieldLabel}>
                Body
                <textarea
                  className={styles.newsEntryBody}
                  value={item.body}
                  onChange={(event) => updateWorksItem(index, { body: event.target.value })}
                  disabled={saving}
                />
              </label>
            </details>
          ))}
        </div>
        {renderAdvancedComponentSource()}
      </div>
    );
  }

  function renderPublicationsEditor(draft: PublicationsComponentDraft) {
    const items = draft.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) =>
        componentItemMatches([
          item.title,
          item.year,
          item.url,
          item.venue,
          ...(item.venues || []).flatMap((venue) => [venue.type, venue.text, venue.url]),
          ...publicationAuthorNames(item),
          ...(item.labels || []),
          ...(item.highlights || []),
        ]),
      );
    return (
      <div className={styles.newsEditor}>
        {renderComponentEditorHeader({
          title: "Publication rows",
          description:
            "Edit titles, authors, venue, links, and labels directly. Advanced JSON remains preserved.",
          count: draft.items.length,
          entryLabel: "publications",
          addLabel: "Add publication",
          onAdd: addPublicationEntry,
        })}
        <div className={styles.newsEntryList}>
          {items.length === 0
            ? renderCollectionEmpty("publications")
            : null}
          {items.map(({ item, index }) => {
            const authors = publicationAuthorNames(item);
            const selfAuthor =
              item.authorsRich?.find((author) => author.isSelf)?.name || "";
            const primaryVenue = publicationPrimaryVenue(item);
            return (
              <details key={item.id} className={styles.newsEntryCard}>
                <summary className={styles.collectionEntrySummary}>
                  <strong>{item.title || "Untitled publication"}</strong>
                  {renderCollectionEntryMeta(
                    item.year || "Publication",
                    Boolean(item.title.trim() && item.year.trim()),
                  )}
                </summary>
                {renderComponentItemActions({
                  index,
                  count: draft.items.length,
                  reorderDisabled: Boolean(componentSearch.trim()),
                  onMove: (direction) => moveSelectedPublicationItem(index, direction),
                  onDuplicate: () => duplicatePublicationItem(index),
                  onDelete: () => deletePublicationItem(index),
                })}
                <div className={styles.componentEntryGrid}>
                <label className={styles.fieldLabel}>
                  Title
                  <input
                    className={styles.textField}
                    value={item.title || ""}
                    onChange={(event) =>
                      updatePublicationItem(index, { title: event.target.value })
                    }
                  />
                </label>
                <label className={styles.fieldLabel}>
                  Year
                  <input
                    className={styles.textField}
                    value={item.year || ""}
                    onChange={(event) =>
                      updatePublicationItem(index, { year: event.target.value })
                    }
                  />
                </label>
                <label className={styles.fieldLabel}>
                  URL
                  <input
                    className={styles.textField}
                    value={item.url || ""}
                    onChange={(event) => updatePublicationItem(index, { url: event.target.value })}
                  />
                </label>
                <label className={styles.fieldLabel}>
                  Authors
                  <input
                    className={styles.textField}
                    value={authors.join(", ")}
                    onChange={(event) => updatePublicationAuthors(index, event.target.value)}
                    placeholder="Comma separated"
                  />
                </label>
                <label className={styles.fieldLabel}>
                  Highlighted author
                  <select
                    className={styles.textField}
                    value={selfAuthor}
                    onChange={(event) =>
                      updatePublicationSelfAuthor(index, event.target.value)
                    }
                  >
                    <option value="">None</option>
                    {authors.map((author) => (
                      <option key={author} value={author}>
                        {author}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.fieldLabel}>
                  Venue
                  <input
                    className={styles.textField}
                    value={primaryVenue?.text || item.venue || ""}
                    onChange={(event) =>
                      updatePublicationPrimaryVenue(index, { text: event.target.value })
                    }
                    placeholder="Conference or journal"
                  />
                </label>
                <label className={styles.fieldLabel}>
                  Venue type
                  <input
                    className={styles.textField}
                    value={primaryVenue?.type || ""}
                    onChange={(event) =>
                      updatePublicationPrimaryVenue(index, { type: event.target.value })
                    }
                    placeholder="Conference, Journal, Workshop"
                  />
                </label>
                <label className={styles.fieldLabel}>
                  Venue URL
                  <input
                    className={styles.textField}
                    value={primaryVenue?.url || ""}
                    onChange={(event) =>
                      updatePublicationPrimaryVenue(index, { url: event.target.value })
                    }
                    placeholder="Optional"
                  />
                </label>
                <label className={styles.fieldLabel}>
                  Labels
                  <input
                    className={styles.textField}
                    value={(item.labels || []).join(", ")}
                    onChange={(event) =>
                      updatePublicationListField(index, "labels", event.target.value)
                    }
                  />
                </label>
                <label className={styles.fieldLabel}>
                  Highlights
                  <input
                    className={styles.textField}
                    value={(item.highlights || []).join(", ")}
                    onChange={(event) =>
                      updatePublicationListField(index, "highlights", event.target.value)
                    }
                  />
                </label>
                <label className={styles.fieldLabel}>
                  DOI URL
                  <input
                    className={styles.textField}
                    value={item.doiUrl || ""}
                    onChange={(event) =>
                      updatePublicationItem(index, { doiUrl: event.target.value })
                    }
                  />
                </label>
                <label className={styles.fieldLabel}>
                  arXiv URL
                  <input
                    className={styles.textField}
                    value={item.arxivUrl || ""}
                    onChange={(event) =>
                      updatePublicationItem(index, { arxivUrl: event.target.value })
                    }
                  />
                </label>
                <label className={styles.fieldLabel}>
                  External URLs
                  <input
                    className={styles.textField}
                    value={(item.externalUrls || []).join(", ")}
                    onChange={(event) =>
                      updatePublicationListField(index, "externalUrls", event.target.value)
                    }
                  />
                </label>
                </div>
              </details>
            );
          })}
        </div>
        {renderAdvancedComponentSource()}
      </div>
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

  function renderContentLibrary() {
    const searching = Boolean(contentSearch.trim());
    return (
      <Card className={styles.sidePanel}>
        <div className={styles.panelHeader}>
          <div>
            <h2 className={styles.panelTitle}>Content</h2>
          </div>
          <Button
            onClick={() => beginCreate(kind === "pages" ? "pages" : "posts")}
            variant="subtle"
            size="sm"
          >
            New
          </Button>
        </div>

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
          <div className={styles.contentNavSectionHeader}>
            <p className={styles.inspectorLabel}>Documents</p>
            <div className={styles.segmented} role="group" aria-label="Document type">
              {(["posts", "pages"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  data-active={area === "content" && kind === value}
                  onClick={() => openDocumentKind(value)}
                >
                  {titleForKind(value)}
                </button>
              ))}
            </div>
          </div>
          <label className={styles.fieldLabel}>
            Search all content
            <input
              className={styles.textField}
              value={contentSearch}
              onChange={(event) => setContentSearch(event.target.value)}
              placeholder="Title, slug, or metadata"
            />
          </label>
          <div className={styles.itemList}>
            {(searching
              ? globalSearchItems
              : visibleItems.map((item) => ({ kind, item })))
              .filter(({ kind: itemKind }) => itemKind !== "components")
              .map(({ kind: itemKind, item }) => (
                <button
                  key={`${itemKind}:${item.id}`}
                  type="button"
                  className={styles.itemButton}
                  data-active={selected?.kind === itemKind && selected?.id === item.id}
                  onClick={() => void selectLibraryContent(itemKind, item.id)}
                >
                  <span>{item.title}</span>
                  <small>
                    {searching ? `${titleForKind(itemKind)} · ` : ""}
                    {item.draft ? "Hidden · " : ""}
                    {item.meta}
                  </small>
                </button>
              ))}
            {(searching ? globalSearchItems : visibleItems).length === 0 ? (
              <p className={styles.listEmpty}>No matching content.</p>
            ) : null}
          </div>
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
                <small>{summary?.count ?? 0} {summary?.entryLabel || definition.entryLabel || "entries"}</small>
              </button>
            );
          })}
        </div>
      </Card>
    );
  }

  const resolvedCreateSlug = createSlug.trim() || slugFromTitle(createTitle);

  return (
    <main className={styles.shell} data-area={area}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Site Admin · {actor}</p>
          <h1 className={styles.title}>{areaTitle}</h1>
          <p className={styles.description}>{areaDescription}</p>
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

      {area === "content" ? (
        <section
          className={`${styles.workspaceGrid} ${styles.contentWorkspace}`}
          data-selected={selected ? "true" : "false"}
        >
          {renderContentLibrary()}

          {selected ? (
            <Card className={styles.editorPanel}>
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
                      {componentReturnTarget ? `Back to ${componentReturnTarget.title}` : "Back"}
                    </Button>
                    <Button
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
                      tone="accent"
                      size="sm"
                      disabled={saving || !selectedDirty}
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
                  <span className={styles.statusPill} data-state={draftStatusState}>
                    {draftStatusLabel}
                  </span>
                  {selectedIsStructured ? (
                    <span className={styles.statusPill} data-state={contentForm.draft ? "smart-release" : "noop"}>
                      {contentForm.draft ? "Hidden" : "Public"}
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
                            <span>
                              {selectedManagedSummary?.count ?? 0}{" "}
                              {selectedManagedSummary?.entryLabel ||
                                selectedManagedComponent.entryLabel ||
                                "entries"}
                            </span>
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
                                disabled={saving}
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
                          disabled={saving}
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
                          disabled={saving}
                          initialMode="source"
                          visualEditing={false}
                        />
                      </div>
                    )}
                  </>
                )}
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
          {inspectorOpen ? (
            <button
              type="button"
              className={styles.inspectorScrim}
              aria-label="Close inspector"
              onClick={() => setInspectorOpen(false)}
            />
          ) : null}
          <Card className={styles.inspectorPanel} data-open={inspectorOpen ? "true" : "false"}>
            {selected ? (
              <>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.cardLabel}>Inspector</p>
                    <h2 className={styles.panelTitle}>Draft settings</h2>
                  </div>
                </div>

                <section className={styles.inspectorSection}>
                  <p className={styles.inspectorLabel}>State</p>
                  <div className={styles.inspectorPills}>
                    <span className={styles.statusPill} data-state={draftStatusState}>
                      {draftStatusLabel}
                    </span>
                    {selectedIsStructured ? (
                      <span
                        className={styles.statusPill}
                        data-state={contentForm.draft ? "smart-release" : "noop"}
                      >
                        {contentForm.draft ? "Hidden" : "Public"}
                      </span>
                    ) : null}
                    <span className={styles.statusPill} data-state={liveStatusState}>
                      {liveStatusLabel}
                    </span>
                  </div>
                  <p className={styles.editorHint}>{editorStatusHint}</p>
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
                        checked={contentForm.draft}
                        onChange={(event) =>
                          setContentForm((current) => ({
                            ...current,
                            draft: event.target.checked,
                          }))
                        }
                      />
                      Hide from public site
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
                      <strong>
                        {selectedManagedSummary?.count ?? 0}{" "}
                        {selectedManagedSummary?.entryLabel ||
                          selectedManagedComponent.entryLabel ||
                          "entries"}
                      </strong>
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
                  <p className={styles.inspectorLabel}>Actions</p>
                  <div className={styles.inspectorActions}>
                    {selected.href ? (
                      <Button href={selected.href} variant="subtle" size="sm">
                        Open live
                      </Button>
                    ) : null}
                    <Button href="/api/site-admin/release-jobs" variant="ghost" size="sm">
                      Release jobs
                    </Button>
                    {isDeleteSupported(selected.kind) ? (
                      <Button
                        onClick={() => void deleteSelectedContent()}
                        variant="ghost"
                        tone="danger"
                        size="sm"
                        disabled={saving}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </section>

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
                      clearLocalDraft(selected.kind, selected.id);
                      const detail = await readJson<EditableDetailPayload>(
                        endpointFor(selected.kind, selected.id),
                      );
                      applySelectedDetail(selected.kind, selected.id, detail);
                      await refreshLists();
                      await refreshSummaryOnly();
                      setNotice("Earlier version restored and saved.");
                    }}
                  />
                </section>
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
            <div className={styles.createEditorShell}>
              <SiteAdminMarkdownEditor
                label="New content body"
                value={createBody}
                onChange={setCreateBody}
                minHeight={360}
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
        </div>
      ) : null}

      {area === "media" ? (
        <SiteAdminMediaLibrary />
      ) : null}

      {area === "settings" ? (
        <SiteAdminSettingsPanel />
      ) : null}

      {area === "release" ? (
        <section className={styles.releaseGrid}>
          <Card className={styles.releasePrimaryCard}>
            <div className={styles.cardHeader}>
              <div>
                <p className={styles.cardLabel}>Recommended action</p>
                <h2 className={styles.cardTitle}>
                  {release?.headline ||
                    (summaryError ? "Release status unavailable" : "Refresh release status")}
                </h2>
              </div>
              <span className={styles.statusPill} data-state={release?.recommendedAction.kind}>
                {release?.recommendedAction.label || (summaryError ? "Unavailable" : "Refresh")}
              </span>
            </div>
            <p className={styles.cardText}>
              {release?.detail ||
                (summaryError
                  ? `Could not load release summary: ${summaryError}.`
                  : "Release status has not loaded yet.")}
            </p>
            <div className={styles.releaseSteps} aria-label="Release flow">
              <div data-active="true">
                <span>1</span>
                <strong>Draft</strong>
                <small>Save content changes</small>
              </div>
              <div data-active={releaseNeedsPublish || releaseIsRunning ? "true" : "false"}>
                <span>2</span>
                <strong>Preview</strong>
                <small>Optional for code and layout changes</small>
              </div>
              <div data-active={release?.recommendedAction.kind === "noop" ? "true" : "false"}>
                <span>3</span>
                <strong>Live</strong>
                <small>Production is current</small>
              </div>
            </div>
            <div className={styles.panelActions}>
              <Button
                onClick={() => void runSmartRelease()}
                tone="accent"
                disabled={
                  releaseSaving ||
                  release?.recommendedAction.kind === "noop" ||
                  release?.recommendedAction.kind === "refresh" ||
                  !release?.recommendedAction
                }
              >
                {releaseSaving
                  ? "Starting"
                  : release?.recommendedAction.kind === "noop"
                    ? "Live current"
                    : "Publish live"}
              </Button>
              <Button onClick={() => void refreshAll()} variant="subtle" disabled={loading}>
                Refresh
              </Button>
              <Button href="/api/site-admin/release-jobs" variant="ghost">
                Jobs
              </Button>
            </div>
          </Card>

          <Card className={styles.releaseSideCard}>
            <p className={styles.cardLabel}>Source state</p>
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

          <Card className={styles.releaseSideCard}>
            <div className={styles.cardHeader}>
              <p className={styles.cardLabel}>Runner</p>
              <span className={styles.muted}>
                {release?.runners?.[0]?.status || (summaryError ? "Unavailable" : "Not seen")}
              </span>
            </div>
            <p className={styles.cardText}>
              Release jobs run through the shared Site Admin release queue. Logs and recovery
              commands stay available without becoming the default path.
            </p>
            <details className={styles.editorDetails}>
              <summary>
                <span>Advanced recovery</span>
                <small>Raw status endpoints</small>
              </summary>
              <div className={styles.editorDetailsBody}>
                <div className={styles.linkRow}>
                  <Link href="/api/site-admin/status">API status</Link>
                  <Link href="/api/site-admin/mobile/summary">Summary</Link>
                  <Link href="/api/site-admin/release-jobs">Release jobs</Link>
                </div>
              </div>
            </details>
          </Card>
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
              disabled={saving}
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
