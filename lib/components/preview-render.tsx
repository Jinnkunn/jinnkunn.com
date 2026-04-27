import "server-only";

import { Fragment } from "react";
import type { ReactElement, ReactNode } from "react";

import { PublicationList } from "@/components/publications/publication-list";
import { postMdxComponents } from "@/components/posts-mdx/components";
import { NewsEntry } from "@/components/posts-mdx/news-entry";
import { TeachingEntry } from "@/components/posts-mdx/teaching-entry";
import { WorksEntry } from "@/components/posts-mdx/works-entry";
import { compilePostMdx } from "@/lib/posts/compile";
import type { SiteComponentName } from "@/lib/site-admin/component-registry";

import {
  parseNewsEntries,
  parsePublicationsEntries,
  parseTeachingEntries,
  parseWorksEntries,
  type WorksComponentEntry,
} from "./parse";

function capEntries<T>(entries: T[], limit?: number): T[] {
  const cap =
    typeof limit === "number" && Number.isFinite(limit) && limit > 0
      ? Math.trunc(limit)
      : undefined;
  return cap ? entries.slice(0, cap) : entries;
}

async function renderMdxChildren(source: string): Promise<ReactNode> {
  if (!source.trim()) return null;
  const { Content } = await compilePostMdx(source);
  return <Content components={postMdxComponents} />;
}

function EmptyPreview({ children }: { children: ReactNode }): ReactElement {
  return (
    <p className="notion-text notion-text__content notion-semantic-string">
      {children}
    </p>
  );
}

async function renderNewsPreview(
  source: string,
  limit?: number,
): Promise<ReactElement> {
  const entries = capEntries(parseNewsEntries(source), limit);
  if (entries.length === 0) return <EmptyPreview>No news yet.</EmptyPreview>;
  const rendered = await Promise.all(
    entries.map(async (entry) => ({
      ...entry,
      children: await renderMdxChildren(entry.body),
    })),
  );
  return (
    <div className="news-block">
      {rendered.map((entry, index) => (
        <Fragment key={`${entry.dateIso}-${index}`}>
          <NewsEntry date={entry.dateIso}>{entry.children}</NewsEntry>
        </Fragment>
      ))}
    </div>
  );
}

function renderTeachingPreview(source: string, limit?: number): ReactElement {
  const entries = capEntries(parseTeachingEntries(source), limit);
  if (entries.length === 0) {
    return <EmptyPreview>No teaching activities yet.</EmptyPreview>;
  }
  return (
    <ul className="notion-bulleted-list teaching-list">
      {entries.map((entry, index) => (
        <TeachingEntry
          key={`${entry.term}-${entry.courseCode}-${index}`}
          term={entry.term}
          period={entry.period}
          role={entry.role}
          courseCode={entry.courseCode}
          courseName={entry.courseName}
          courseUrl={entry.courseUrl}
          instructor={entry.instructor}
        />
      ))}
    </ul>
  );
}

async function renderWorksRow(
  entry: WorksComponentEntry,
  key: string,
): Promise<ReactElement> {
  return (
    <WorksEntry
      key={key}
      category={entry.category}
      role={entry.role}
      affiliation={entry.affiliation}
      affiliationUrl={entry.affiliationUrl}
      location={entry.location}
      period={entry.period}
    >
      {await renderMdxChildren(entry.body)}
    </WorksEntry>
  );
}

function NotionSpacer() {
  return <div className="notion-text" aria-hidden="true" />;
}

async function renderWorksPreview(
  source: string,
  limit?: number,
): Promise<ReactElement> {
  const entries = parseWorksEntries(source);
  const recent = capEntries(
    entries.filter((entry) => entry.category === "recent"),
    limit,
  );
  const passed = capEntries(
    entries.filter((entry) => entry.category === "passed"),
    limit,
  );

  if (recent.length === 0 && passed.length === 0) {
    return <EmptyPreview>No works yet.</EmptyPreview>;
  }

  const recentNodes = await Promise.all(
    recent.map((entry, index) => renderWorksRow(entry, `recent-${index}`)),
  );
  const passedNodes = await Promise.all(
    passed.map((entry, index) => renderWorksRow(entry, `passed-${index}`)),
  );

  return (
    <>
      {recentNodes.length > 0 && (
        <Fragment>
          <span className="notion-heading__anchor" />
          <h1 className="notion-heading notion-semantic-string">Recent Works</h1>
          {recentNodes}
        </Fragment>
      )}
      {passedNodes.length > 0 && (
        <Fragment>
          {recentNodes.length > 0 && <NotionSpacer />}
          <span className="notion-heading__anchor" />
          <h1 className="notion-heading notion-semantic-string">Past Works</h1>
          {passedNodes}
        </Fragment>
      )}
    </>
  );
}

function renderPublicationsPreview(source: string, limit?: number): ReactElement {
  const entries = capEntries(parsePublicationsEntries(source), limit);
  if (entries.length === 0) return <EmptyPreview>No publications yet.</EmptyPreview>;
  return <PublicationList entries={entries} />;
}

export async function renderComponentPreviewElement(
  name: SiteComponentName,
  source: string,
  limit?: number,
): Promise<ReactElement> {
  if (name === "news") return await renderNewsPreview(source, limit);
  if (name === "teaching") return renderTeachingPreview(source, limit);
  if (name === "publications") return renderPublicationsPreview(source, limit);
  return await renderWorksPreview(source, limit);
}
