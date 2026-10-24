import matter from "gray-matter";
import { parseComponentEntries } from "../components/parse.ts";
import { SITE_COMPONENT_DEFINITIONS } from "../site-admin/component-registry.ts";
import type { PublicationReview, PublicationSnapshot } from "./publication-snapshot.ts";

export type PublicationFieldChange = { label: string; before: string; after: string };
export type PublicationEntryChange = { kind: "added" | "changed" | "deleted"; title: string; fields: PublicationFieldChange[] };
export type PublicationChangeDetails = {
  summary: string;
  fields: PublicationFieldChange[];
  entries: PublicationEntryChange[];
  routes: string[];
  siteWide: boolean;
};

const FIELD_LABELS: Record<string, string> = {
  title: "Title", bodyMdx: "Content", body: "Content", date: "Date", dateIso: "Date",
  description: "Description", draft: "Hidden", tags: "Tags", cover: "Cover image", ogImage: "Social image",
  period: "Period", category: "Group", role: "Role", affiliation: "Organization", affiliationUrl: "Organization link",
  location: "Location", term: "Term", courseCode: "Course code", courseName: "Course name", courseUrl: "Course link",
  instructor: "Instructor", year: "Year", authors: "Authors", venue: "Venue", url: "Link", doiUrl: "DOI", arxivUrl: "arXiv",
  text: "Status", context: "Context", updatedAt: "Updated", at: "Date", links: "Links", compactMdx: "Collapsed content", layout: "Layout",
  scope: "Display scope", routes: "Pages", status: "Status", startsAt: "Starts", endsAt: "Ends", collapsible: "Collapsible",
  initialState: "Initial display", current: "Current status", history: "History", order: "Page order",
};
const IGNORED_FIELDS = new Set(["entryId", "id", "schemaVersion", "version", "updatedAt"]);
function readable(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(readable).join(", ");
  if (typeof value === "object") return Object.entries(value).map(([key, item]) => `${FIELD_LABELS[key] || key}: ${readable(item)}`).join("\n");
  return String(value).replace(/<[^>]+>/g, "").replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "Image: $1 ($2)")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)").replace(/^#{1,6}\s+/gm, "").trim();
}
function fieldChanges(before: Record<string, unknown>, after: Record<string, unknown>): PublicationFieldChange[] {
  const comparable = (value: unknown) => value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0) ? "" : JSON.stringify(value);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => !IGNORED_FIELDS.has(key) && comparable(before[key] ?? "") !== comparable(after[key] ?? ""))
    .map((key) => ({ label: FIELD_LABELS[key] || key.replace(/([A-Z])/g, " $1"), before: readable(before[key]), after: readable(after[key]) }));
}
type Row = Record<string, unknown>;
function rowTitle(row: Row) { return String(row.title || row.courseName || row.courseCode || row.role || row.dateIso || row.text || "Entry"); }
function naturalIdentity(row: Row) { return String(row.courseCode || (row.role ? `${row.role}|${row.affiliation || ""}` : row.title || row.dateIso || "")); }
function identity(row: Row) { return String(row.entryId || row.id || naturalIdentity(row)); }
function rowFingerprint(row: Row) { return JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key]) => key !== "entryId" && key !== "id"))); }
function entryChanges(before: Row[], after: Row[]) {
  const remaining = new Set(before.map((_, index) => index));
  const pairs: { old: number; next: number }[] = [];
  const unmatched: number[] = [];
  // Match unchanged rows before identities: legacy News can share dates.
  for (let next = 0; next < after.length; next++) {
    const exact = [...remaining].find((old) => rowFingerprint(before[old]) === rowFingerprint(after[next]));
    if (exact !== undefined) { remaining.delete(exact); pairs.push({ old: exact, next }); }
    else unmatched.push(next);
  }
  const entries: PublicationEntryChange[] = [];
  for (const next of unmatched) {
    const key = identity(after[next]);
    const matches = [...remaining].filter((old) => key && (identity(before[old]) === key ||
      ((!before[old].entryId || !after[next].entryId) && naturalIdentity(before[old]) === naturalIdentity(after[next]))));
    const unique = unmatched.filter((index) => identity(after[index]) === key).length === 1;
    const old = matches.length === 1 && unique ? matches[0] : undefined;
    if (old === undefined) entries.push({ kind: "added", title: rowTitle(after[next]), fields: fieldChanges({}, after[next]) });
    else {
      remaining.delete(old); pairs.push({ old, next });
      const fields = fieldChanges(before[old], after[next]);
      if (fields.length) entries.push({ kind: "changed", title: rowTitle(after[next]), fields });
    }
  }
  for (const old of remaining) entries.push({ kind: "deleted", title: rowTitle(before[old]), fields: fieldChanges(before[old], {}) });
  const order = pairs.sort((a, b) => a.next - b.next).map((pair) => pair.old);
  return { entries, reordered: order.some((old, index) => index > 0 && old < order[index - 1]) };
}
function documentFields(path: string, source: string): Row {
  if (!source) return {};
  if (path.endsWith(".json")) return JSON.parse(source) as Row;
  const parsed = matter(source);
  return { ...parsed.data, body: parsed.content };
}
function routeFor(path: string) {
  if (path === "home.json") return "/";
  if (path === "now.json") return "/now";
  if (path.startsWith("pages/")) return `/${path.slice(6, -4)}`;
  if (path.startsWith("posts/")) return `/blog/${path.slice(6, -4)}`;
  return "";
}
export function describePublicationChange(change: PublicationReview["changes"][number], current: PublicationSnapshot, baseline: PublicationSnapshot): PublicationChangeDetails {
  const details: PublicationChangeDetails = { summary: "", fields: [], entries: [], routes: [], siteWide: change.path.startsWith("filesystem/") };
  const definition = SITE_COMPONENT_DEFINITIONS.find((item) => change.path === item.sourcePath.replace(/^content\//, ""));
  try {
    const before = documentFields(change.path, change.before);
    const after = documentFields(change.path, change.after);
    if (change.path === "now.json") {
      const previous = (before.current || {}) as Row;
      const next = (after.current || {}) as Row;
      details.fields = fieldChanges(
        { text: previous.text, context: previous.context, location: previous.location, date: previous.updatedAt, links: before.links },
        { text: next.text, context: next.context, location: next.location, date: next.updatedAt, links: after.links },
      );
      const history = (document: Row, current: Row) => ((document.updates || []) as Row[]).filter((item) => item.text !== current.text || item.at !== current.updatedAt);
      details.entries = entryChanges(history(before, previous), history(after, next)).entries;
      details.summary = [...details.fields.map((field) => field.label), details.entries.length ? `${details.entries.length} history changes` : ""].filter(Boolean).join(", ") || "Status updated";
    } else if (definition || change.path === "filesystem/announcements.json") {
      const oldRows = definition ? parseComponentEntries(definition.name, change.before).entries : (before.items || []);
      const nextRows = definition ? parseComponentEntries(definition.name, change.after).entries : (after.items || []);
      const rows = entryChanges(oldRows as unknown as Row[], nextRows as unknown as Row[]);
      details.entries = rows.entries;
      const counts = ["added", "changed", "deleted"].map((kind) => {
        const count = rows.entries.filter((item) => item.kind === kind).length;
        return count ? `${count} ${kind}` : "";
      }).filter(Boolean);
      details.summary = [...counts, rows.reordered ? "Order changed" : ""].filter(Boolean).join(" · ") || "Layout or grouping changed";
      if (definition) details.routes.push(definition.primaryRoute);
    } else {
      details.fields = fieldChanges(before, after);
      details.summary = details.fields.map((field) => field.label).join(", ") || "Content changed";
    }
  } catch { details.summary = "Advanced source changed"; }
  for (const path of [change.path, change.oldPath]) {
    const route = routeFor(path);
    if (route) details.routes.push(route);
    if (path.startsWith("posts/")) details.routes.push("/blog");
  }
  if (definition) {
    for (const sources of [baseline.sources, current.sources]) for (const [path, source] of Object.entries(sources)) {
      const route = routeFor(path);
      if (!route) continue;
      const body = path === "home.json" ? (() => { try { return String(JSON.parse(source).bodyMdx || ""); } catch { return ""; } })() : source;
      if (new RegExp(`<${definition.embedTag}\\b`).test(body) ||
          (["works", "teaching"].includes(definition.name) && /<BioExperienceBlock\b/.test(body))) details.routes.push(route);
    }
  }
  details.routes = [...new Set(details.routes)].sort();
  return details;
}
