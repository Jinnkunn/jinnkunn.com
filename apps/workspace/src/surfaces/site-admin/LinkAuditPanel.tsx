import { useCallback, useMemo, useState } from "react";

import {
  findIconLinkEntryForHref,
  isKnownIconLinkHref,
} from "./icon-link-registry";
import { localContent } from "./local-content";
import { useSiteAdmin } from "./state";
import { normalizeString } from "./utils";

type LinkIssueKind =
  | "folder-only"
  | "generic-icon"
  | "missing-icon-mark"
  | "protected"
  | "unresolved-internal";

interface LinkOccurrence {
  href: string;
  icon: boolean;
  iconUrl: string;
  index: number;
  kind: "html" | "markdown";
  label: string;
  sourcePath: string;
}

interface LinkIssue extends LinkOccurrence {
  detail: string;
  issue: LinkIssueKind;
  severity: "info" | "warn" | "error";
}

interface SourceFile {
  body: string;
  path: string;
}

const MARKDOWN_LINK_RE =
  /(<span\b[^>]*data-link-style=["']icon["'][^>]*>\s*)?\[([^\]\n]+)\]\(([^)\n]+)\)(\s*<\/span>)?/g;
const HTML_LINK_RE = /<a\b([^>]*)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
const ICON_URL_RE = /\bdata-link-icon=["']([^"']+)["']/i;

function cleanHtmlLabel(input: string): string {
  return input.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function stripQueryAndHash(pathname: string): string {
  return pathname.split(/[?#]/, 1)[0] || pathname;
}

function normalizeInternalPath(href: string): string | null {
  const value = href.trim();
  if (!value || value.startsWith("#")) return null;
  if (/^(?:https?:|mailto:|tel:|sms:)/i.test(value)) return null;
  if (!value.startsWith("/")) return null;
  const clean = stripQueryAndHash(value).replace(/\/+$/, "") || "/";
  return clean;
}

function collectMarkdownLinks(source: SourceFile): LinkOccurrence[] {
  const rows: LinkOccurrence[] = [];
  for (const match of source.body.matchAll(MARKDOWN_LINK_RE)) {
    const [raw, opening, label, href, closing] = match;
    const icon = Boolean(opening && closing);
    const iconUrl = normalizeString(ICON_URL_RE.exec(opening || "")?.[1]);
    rows.push({
      href: href.trim(),
      icon,
      iconUrl,
      index: match.index ?? 0,
      kind: "markdown",
      label: label.trim() || href.trim(),
      sourcePath: source.path,
    });
    // Avoid HTML link regex trying to interpret the same markdown label.
    void raw;
  }
  return rows;
}

function collectHtmlLinks(source: SourceFile): LinkOccurrence[] {
  const rows: LinkOccurrence[] = [];
  for (const match of source.body.matchAll(HTML_LINK_RE)) {
    const [, beforeAttrs, href, afterAttrs, labelHtml] = match;
    const attrs = `${beforeAttrs} ${afterAttrs}`;
    const icon = /\bdata-link-style=["']icon["']/i.test(attrs);
    rows.push({
      href: href.trim(),
      icon,
      iconUrl: normalizeString(ICON_URL_RE.exec(attrs)?.[1]),
      index: match.index ?? 0,
      kind: "html",
      label: cleanHtmlLabel(labelHtml) || href.trim(),
      sourcePath: source.path,
    });
  }
  return rows;
}

function collectLinks(source: SourceFile): LinkOccurrence[] {
  return [...collectMarkdownLinks(source), ...collectHtmlLinks(source)].sort(
    (a, b) => a.index - b.index,
  );
}

function normalizeHomeBody(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { bodyMdx?: unknown };
    return typeof parsed.bodyMdx === "string" ? parsed.bodyMdx : "";
  } catch {
    return raw;
  }
}

function routeSetFromIndexes(
  pages: Array<{ href: string; slug: string }>,
  posts: Array<{ href: string; slug: string }>,
): Set<string> {
  const out = new Set<string>(["/", "/blog", "/blog.rss"]);
  for (const row of pages) {
    const href = normalizeString(row.href) || `/${row.slug}`;
    out.add(stripQueryAndHash(href).replace(/\/+$/, "") || "/");
  }
  for (const row of posts) {
    const href = normalizeString(row.href) || `/blog/${row.slug}`;
    out.add(stripQueryAndHash(href).replace(/\/+$/, "") || "/");
  }
  return out;
}

function isFolderOnlyPath(pathname: string, generatedRoutes: Set<string>): boolean {
  if (generatedRoutes.has(pathname)) return false;
  const prefix = pathname === "/" ? "/" : `${pathname}/`;
  for (const route of generatedRoutes) {
    if (route.startsWith(prefix)) return true;
  }
  return false;
}

function buildIssues(
  links: LinkOccurrence[],
  generatedRoutes: Set<string>,
  protectedPaths: Set<string>,
): LinkIssue[] {
  const issues: LinkIssue[] = [];
  for (const link of links) {
    const internalPath = normalizeInternalPath(link.href);
    if (internalPath) {
      if (protectedPaths.has(internalPath)) {
        issues.push({
          ...link,
          detail: "Internal link points to a protected route.",
          issue: "protected",
          severity: "info",
        });
      }
      if (!generatedRoutes.has(internalPath)) {
        issues.push({
          ...link,
          detail: isFolderOnlyPath(internalPath, generatedRoutes)
            ? "This path is a navigation folder, not a generated public page."
            : "No generated page/post route matches this path.",
          issue: isFolderOnlyPath(internalPath, generatedRoutes)
            ? "folder-only"
            : "unresolved-internal",
          severity: isFolderOnlyPath(internalPath, generatedRoutes) ? "warn" : "error",
        });
      }
    }
    if (isKnownIconLinkHref(link.href) && !link.icon) {
      const entry = findIconLinkEntryForHref(link.href);
      issues.push({
        ...link,
        detail: `Known ${entry?.label || "icon"} link is missing the icon-link mark.`,
        issue: "missing-icon-mark",
        severity: "warn",
      });
    }
    if (link.icon && !link.iconUrl && !isKnownIconLinkHref(link.href)) {
      issues.push({
        ...link,
        detail: "Icon link has no known automatic icon and no custom icon URL.",
        issue: "generic-icon",
        severity: "info",
      });
    }
  }
  return issues;
}

function issueLabel(kind: LinkIssueKind): string {
  if (kind === "folder-only") return "Folder-only";
  if (kind === "generic-icon") return "Generic icon";
  if (kind === "missing-icon-mark") return "Missing icon mark";
  if (kind === "protected") return "Protected route";
  return "Unresolved internal";
}

export function LinkAuditPanel() {
  const {
    connection,
    pagesIndex,
    postsIndex,
    request,
    setMessage,
  } = useSiteAdmin();
  const [links, setLinks] = useState<LinkOccurrence[]>([]);
  const [issues, setIssues] = useState<LinkIssue[]>([]);
  const [sourceCount, setSourceCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const generatedRoutes = useMemo(
    () => routeSetFromIndexes(pagesIndex, postsIndex),
    [pagesIndex, postsIndex],
  );

  const runAudit = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const credentials =
        connection.baseUrl && connection.authToken
          ? {
              baseUrl: connection.baseUrl,
              authToken: connection.authToken,
              cfAccessClientId: connection.cfAccessClientId || undefined,
              cfAccessClientSecret: connection.cfAccessClientSecret || undefined,
            }
          : null;
      if (credentials) {
        await localContent.syncPull(credentials);
      }

      const [files, routesResp] = await Promise.all([
        localContent.listFiles("", { recursive: true }),
        request("/api/site-admin/routes", "GET"),
      ]);
      const protectedPaths = new Set<string>();
      if (routesResp.ok) {
        const payload = (routesResp.data ?? {}) as Record<string, unknown>;
        const rows = Array.isArray(payload.protectedRoutes)
          ? payload.protectedRoutes
          : [];
        for (const row of rows) {
          if (!row || typeof row !== "object") continue;
          const record = row as Record<string, unknown>;
          const enabled = record.enabled !== false;
          const path = normalizeString(record.path);
          if (enabled && path) protectedPaths.add(stripQueryAndHash(path).replace(/\/+$/, "") || "/");
        }
      }

      const sourceFiles: SourceFile[] = [];
      for (const file of files) {
        const path = file.rel_path;
        if (
          path !== "home.json" &&
          !path.endsWith(".mdx")
        ) {
          continue;
        }
        const row = await localContent.getFile(path);
        const body = row?.body_text ?? "";
        if (!body) continue;
        sourceFiles.push({
          path: `content/${path}`,
          body: path === "home.json" ? normalizeHomeBody(body) : body,
        });
      }
      const nextLinks = sourceFiles.flatMap(collectLinks);
      const nextIssues = buildIssues(nextLinks, generatedRoutes, protectedPaths);
      setSourceCount(sourceFiles.length);
      setLinks(nextLinks);
      setIssues(nextIssues);
      setMessage(
        nextIssues.some((issue) => issue.severity === "error") ? "warn" : "success",
        `Link audit complete: ${nextLinks.length} links, ${nextIssues.length} issue(s).`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setMessage("error", `Link audit failed: ${message}`);
    } finally {
      setLoading(false);
    }
  }, [connection, generatedRoutes, request, setMessage]);

  const counts = useMemo(() => {
    const result = {
      errors: 0,
      iconLinks: 0,
      internal: 0,
      warnings: 0,
    };
    for (const link of links) {
      if (link.icon) result.iconLinks += 1;
      if (normalizeInternalPath(link.href)) result.internal += 1;
    }
    for (const issue of issues) {
      if (issue.severity === "error") result.errors += 1;
      if (issue.severity === "warn") result.warnings += 1;
    }
    return result;
  }, [issues, links]);

  return (
    <section className="surface-card link-audit">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="m-0 text-[20px] font-semibold text-text-primary tracking-[-0.01em]">
            Links
          </h1>
          <p className="m-0 mt-0.5 text-[12.5px] text-text-muted">
            Audit internal routes, protected links, and inline icon-link marks.
          </p>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void runAudit()}
          disabled={loading}
        >
          {loading ? "Auditing..." : "Run audit"}
        </button>
      </header>

      <div className="link-audit__summary">
        <SummaryCard label="Sources" value={sourceCount} />
        <SummaryCard label="Links" value={links.length} />
        <SummaryCard label="Internal" value={counts.internal} />
        <SummaryCard label="Icon links" value={counts.iconLinks} />
        <SummaryCard label="Warnings" value={counts.warnings} tone="warn" />
        <SummaryCard label="Errors" value={counts.errors} tone="error" />
      </div>

      {error ? <p className="link-audit__error">{error}</p> : null}

      {issues.length === 0 ? (
        <div className="link-audit__empty">
          {links.length === 0
            ? "Run an audit after local sync is ready."
            : "No link issues found."}
        </div>
      ) : (
        <div className="link-audit__table" role="table" aria-label="Link issues">
          <div role="row" className="link-audit__table-head">
            <span role="columnheader">Issue</span>
            <span role="columnheader">Link</span>
            <span role="columnheader">Source</span>
            <span role="columnheader">Detail</span>
          </div>
          {issues.map((issue, index) => (
            <div role="row" key={`${issue.sourcePath}-${issue.index}-${issue.issue}-${index}`}>
              <span role="cell" data-tone={issue.severity}>
                {issueLabel(issue.issue)}
              </span>
              <span role="cell">
                <strong>{issue.label}</strong>
                <code>{issue.href}</code>
              </span>
              <span role="cell">
                <code>{issue.sourcePath}</code>
              </span>
              <span role="cell">{issue.detail}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SummaryCard({
  label,
  tone,
  value,
}: {
  label: string;
  tone?: "error" | "warn";
  value: number;
}) {
  return (
    <div className="link-audit__summary-card" data-tone={tone}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
