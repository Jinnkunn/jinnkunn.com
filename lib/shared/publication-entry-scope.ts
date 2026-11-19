import { createProcessor } from "@mdx-js/mdx";
import remarkFrontmatter from "remark-frontmatter";
import { isPublicationsJson, readPublicationsDocument, type IdentifiedPublication } from "../../packages/content-core/src/publications.ts";

export const COLLECTION_ENTRY_ID = /^[a-z0-9][a-z0-9._:-]{0,95}$/i;
export const ENTRY_SCOPED_COLLECTIONS = ["teaching", "works", "publications"] as const;
export type EntryScopedCollection = (typeof ENTRY_SCOPED_COLLECTIONS)[number];

type Row = { id: string; group: string; label: string; comparison: string; raw: string };
type MdxRow = Row & { start: number; end: number };
type Position = { start?: { offset?: number }; end?: { offset?: number } };
type Element = { type: string; name?: string; position?: Position;
  attributes?: { type: string; name?: string; value?: unknown }[];
  children?: { position?: Position }[];
};

const mdxParser = createProcessor({ remarkPlugins: [[remarkFrontmatter, ["yaml"]]] });

function readMdxRows(source: string, kind: "teaching" | "works"): MdxRow[] {
  const tag = kind === "teaching" ? "TeachingEntry" : "WorksEntry";
  const tree = mdxParser.parse(source) as { children: Element[] };
  return tree.children.flatMap((node) => {
    if (node.type !== "mdxJsxFlowElement" || node.name !== tag) return [];
    const start = node.position?.start?.offset, end = node.position?.end?.offset;
    if (start === undefined || end === undefined) throw new Error("The collection entry has no stable source range.");
    const attrs = new Map<string, string>();
    for (const attribute of node.attributes ?? []) {
      if (attribute.type !== "mdxJsxAttribute" || typeof attribute.name !== "string" || typeof attribute.value !== "string" || attrs.has(attribute.name)) {
        throw new Error("Entries with custom or dynamic attributes require group review.");
      }
      attrs.set(attribute.name, attribute.value);
    }
    const id = attrs.get("entryId") || "";
    attrs.delete("entryId");
    const bodyStart = node.children?.[0]?.position?.start?.offset;
    const bodyEnd = node.children?.at(-1)?.position?.end?.offset;
    const body = bodyStart !== undefined && bodyEnd !== undefined ? source.slice(bodyStart, bodyEnd).trim() : "";
    return [{ id, start, end, group: attrs.get(kind === "teaching" ? "term" : "category") || "",
      label: kind === "teaching" ? [attrs.get("courseCode"), attrs.get("courseName")].filter(Boolean).join(" ") : attrs.get("role") || "",
      comparison: JSON.stringify([[...attrs].sort(([a], [b]) => a.localeCompare(b)), body]), raw: source.slice(start, end) }];
  });
}

function paperRow(entry: IdentifiedPublication): Row {
  const raw = JSON.stringify(entry);
  const { entryId, year, title, ...details } = entry;
  // Storage order of object fields does not constitute a paper edit.
  return { id: entryId, group: year, label: title, raw,
    comparison: JSON.stringify([title, year, Object.keys(details).sort().map((key) => [key, details[key as keyof typeof details]])]) };
}

function indexRows(rows: Row[]) {
  const index = new Map<string, number>();
  rows.forEach(({ id }, position) => {
    if (!id) return;
    if (!COLLECTION_ENTRY_ID.test(id) || index.has(id)) throw new Error("Entries must have unique stable IDs.");
    index.set(id, position);
  });
  return index;
}

function insertionIndex(saved: Row[], live: Row[], liveById: Map<string, number>, position: number) {
  if (!live.length || live.some(({ id }) => !id)) throw new Error("Publish the collection with stable entry IDs before inserting individual rows.");
  const prev = saved.slice(0, position).findLast(({ id }) => liveById.has(id));
  const next = saved.slice(position + 1).find(({ id }) => liveById.has(id));
  const left = prev ? liveById.get(prev.id)! : -1;
  const right = next ? liveById.get(next.id)! : live.length;
  if (right - left !== 1) throw new Error("This insertion depends on other ordering or deletion changes.");
  return right;
}

export function prepareEntryPublication(kind: EntryScopedCollection, before: string, after: string) {
  const papers = kind === "publications" ? (() => {
    if (!isPublicationsJson(after)) throw new Error("Save the structured Publications draft before selecting an entry.");
    return { live: readPublicationsDocument(before, { strict: true }), saved: readPublicationsDocument(after, { strict: true }) };
  })() : null;
  const mdx = kind !== "publications" ? { live: readMdxRows(before, kind), saved: readMdxRows(after, kind) } : null;
  const live = papers ? papers.live.entries.map(paperRow) : mdx!.live;
  const saved = papers ? papers.saved.entries.map(paperRow) : mdx!.saved;
  const liveById = indexRows(live), savedById = indexRows(saved);

  return {
    entries: saved.filter(({ id, comparison }) => id && live[liveById.get(id) ?? -1]?.comparison !== comparison),
    select(id: string) {
      const position = savedById.get(id) ?? -1;
      const row = saved[position];
      if (!row) throw new Error("This entry no longer exists in the saved draft.");
      const previousIndex = liveById.get(id);
      const previous = previousIndex === undefined ? undefined : live[previousIndex];
      if (previous?.comparison === row.comparison) throw new Error("This entry has no independent saved update.");
      if (previous && previous.group !== row.group) throw new Error("Moving an entry between groups requires group review.");
      if (previousIndex !== undefined && saved.some(({ id: otherId }, index) => {
        const old = liveById.get(otherId);
        return old !== undefined && (index < position) !== (old < previousIndex);
      })) throw new Error("Reordering this entry requires group review.");
      const index = previousIndex ?? insertionIndex(saved, live, liveById, position);

      let updated: string;
      if (papers) {
        const entries = [...papers.live.entries];
        entries.splice(index, previous ? 1 : 0, papers.saved.entries[position]);
        updated = `${JSON.stringify({ ...papers.live, entries }, null, 2)}\n`;
      } else {
        const rows = mdx!.live;
        if (previous) updated = before.slice(0, rows[index].start) + row.raw + before.slice(rows[index].end);
        else if (rows[index]) updated = before.slice(0, rows[index].start) + row.raw + "\n\n" + before.slice(rows[index].start);
        else updated = before.slice(0, rows[index - 1].end) + "\n\n" + row.raw + before.slice(rows[index - 1].end);
      }
      return { updated, reviewedText: row.raw };
    },
  };
}
