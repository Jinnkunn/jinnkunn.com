import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import {
  MdxDocumentEditor,
  type MdxDocumentEditorAdapter,
  type MdxDocumentPropertiesProps,
} from "./MdxDocumentEditor";
import {
  buildComponentSource,
  parseComponentSource,
  type ComponentFrontmatterForm,
} from "./mdx-source";
import {
  createMdxBlock,
  parseMdxBlocks,
  serializeMdxBlocks,
  type MdxBlock,
} from "./mdx-blocks";
import { useSiteAdmin } from "./state";
import {
  SITE_COMPONENT_DEFINITIONS,
  getSiteComponentDefinition,
  type SiteComponentDefinition,
  type SiteComponentName,
} from "../../../../../lib/site-admin/component-registry.ts";

export type ComponentName = SiteComponentName;

type ComponentUsage = {
  kind: string;
  sourcePath: string;
  routePath: string;
  title: string;
  embedTag: string;
};

type ComponentInfo = {
  definition: SiteComponentDefinition;
  summary: {
    count: number;
    entryLabel: string;
    rows: Array<{ title: string; detail?: string; href?: string }>;
  };
  usage: ComponentUsage[];
};

type PubEntryData = {
  title?: string;
  year?: string;
  url?: string;
  doiUrl?: string;
  arxivUrl?: string;
  labels?: string[];
  authorsRich?: { name: string; isSelf?: boolean }[];
  venues?: { type?: string; text?: string; url?: string }[];
  highlights?: string[];
  externalUrls?: string[];
};

export interface ComponentEditorProps {
  name: ComponentName;
  onExit: (action: "saved" | "deleted" | "cancel", slug?: string) => void;
}

function blankForm(): ComponentFrontmatterForm {
  return { title: "" };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asUsage(value: unknown): ComponentUsage[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = asRecord(item);
    return {
      kind: asString(row.kind),
      sourcePath: asString(row.sourcePath),
      routePath: asString(row.routePath),
      title: asString(row.title),
      embedTag: asString(row.embedTag),
    };
  });
}

function parseInfo(name: ComponentName, rawData: unknown): ComponentInfo {
  const data = asRecord(rawData);
  const rawSummary = asRecord(data.summary);
  const rows = Array.isArray(rawSummary.rows)
    ? rawSummary.rows.map((item) => {
        const row = asRecord(item);
        return {
          title: asString(row.title),
          detail: asString(row.detail) || undefined,
          href: asString(row.href) || undefined,
        };
      })
    : [];
  return {
    definition: getSiteComponentDefinition(name),
    summary: {
      count: typeof rawSummary.count === "number" ? rawSummary.count : 0,
      entryLabel: asString(rawSummary.entryLabel) || "Entry",
      rows,
    },
    usage: asUsage(data.usage),
  };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultEntryBlock(name: ComponentName): MdxBlock {
  if (name === "news") {
    return {
      ...createMdxBlock("news-entry"),
      dateIso: todayIso(),
      children: [createMdxBlock("paragraph")],
    };
  }
  if (name === "teaching") {
    return {
      ...createMdxBlock("teaching-entry"),
      teachingTerm: "",
      teachingPeriod: "",
      teachingRole: "",
      teachingCourseCode: "",
      teachingCourseName: "",
    };
  }
  if (name === "publications") {
    return {
      ...createMdxBlock("publications-entry"),
      pubData: JSON.stringify({
        title: "Untitled publication",
        year: String(new Date().getFullYear()),
        url: "",
        labels: [],
        authorsRich: [],
        venues: [],
      }),
    };
  }
  return {
    ...createMdxBlock("works-entry"),
    worksCategory: "recent",
    worksRole: "",
    worksPeriod: "",
    children: [createMdxBlock("paragraph")],
  };
}

function isBlankParagraph(block: MdxBlock): boolean {
  return block.type === "paragraph" && !(block.text ?? "").trim();
}

function appendEntry(body: string, name: ComponentName): string {
  const parsed = parseMdxBlocks(body);
  const blocks =
    parsed.length === 1 && isBlankParagraph(parsed[0]) ? [] : parsed.slice();
  blocks.push(defaultEntryBlock(name));
  return serializeMdxBlocks(blocks);
}

function sortEntries(body: string, name: ComponentName): string {
  const blocks = parseMdxBlocks(body);
  const definition = getSiteComponentDefinition(name);
  const entries = blocks.filter((block) => block.type === definition.entryType);
  const rest = blocks.filter((block) => block.type !== definition.entryType);
  if (entries.length < 2) return body;
  const sorted = entries.slice().sort((a, b) => {
    if (name === "news") return (b.dateIso ?? "").localeCompare(a.dateIso ?? "");
    if (name === "works") {
      const ac = a.worksCategory === "passed" ? 1 : 0;
      const bc = b.worksCategory === "passed" ? 1 : 0;
      if (ac !== bc) return ac - bc;
      return (a.worksPeriod ?? "").localeCompare(b.worksPeriod ?? "");
    }
    if (name === "publications") {
      const ay = publicationYear(a.pubData);
      const by = publicationYear(b.pubData);
      return String(by).localeCompare(String(ay));
    }
    return 0;
  });
  return serializeMdxBlocks([...sorted, ...rest]);
}

function publicationYear(raw: string | undefined): string {
  try {
    return String(JSON.parse(raw || "{}")?.year ?? "");
  } catch {
    return "";
  }
}

function blockText(block: MdxBlock): string {
  const own = block.text ?? "";
  const children = (block.children ?? []).map(blockText).join(" ");
  return [own, children].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function parsePubData(raw: string | undefined): PubEntryData {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as PubEntryData;
  } catch {
    // fall through
  }
  return {};
}

function compactStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items.map((value) => value.trim()).filter(Boolean)) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function commaList(value: string | undefined): string[] {
  return compactStrings(String(value ?? "").split(","));
}

function formatCommaList(items: string[] | undefined): string {
  return (items ?? []).join(", ");
}

function formatAuthors(authors: PubEntryData["authorsRich"]): string {
  return (authors ?? [])
    .map((author) => `${author.name}${author.isSelf ? " *" : ""}`)
    .join("; ");
}

function parseAuthors(raw: string): PubEntryData["authorsRich"] {
  return compactStrings(raw.split(";")).map((item) => {
    const isSelf = /\*$/.test(item.trim());
    return {
      name: item.replace(/\*$/, "").trim(),
      isSelf,
    };
  });
}

function formatVenues(venues: PubEntryData["venues"]): string {
  return (venues ?? [])
    .map((venue) =>
      [venue.type ?? "", venue.text ?? "", venue.url ?? ""]
        .map((item) => item.trim())
        .filter(Boolean)
        .join(" | "),
    )
    .join("\n");
}

function parseVenues(raw: string): PubEntryData["venues"] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [type = "", text = "", url = ""] = line.split("|").map((part) => part.trim());
      return {
        type: type || undefined,
        text: text || type || undefined,
        url: url || undefined,
      };
    });
}

function formatLines(items: string[] | undefined): string {
  return (items ?? []).join("\n");
}

function parseLines(raw: string): string[] {
  return compactStrings(raw.split("\n"));
}

function setPublicationField(
  block: MdxBlock,
  patcher: (data: PubEntryData) => PubEntryData,
): MdxBlock {
  const next = patcher(parsePubData(block.pubData));
  return { ...block, pubData: JSON.stringify(next) };
}

function getEntryRows(name: ComponentName, body: string): Array<{ block: MdxBlock; index: number; ordinal: number }> {
  const definition = getSiteComponentDefinition(name);
  const blocks = parseMdxBlocks(body);
  const rows: Array<{ block: MdxBlock; index: number; ordinal: number }> = [];
  blocks.forEach((block, index) => {
    if (block.type !== definition.entryType) return;
    rows.push({ block, index, ordinal: rows.length });
  });
  return rows;
}

function patchEntry(
  body: string,
  name: ComponentName,
  ordinal: number,
  patcher: (block: MdxBlock) => MdxBlock,
): string {
  const blocks = parseMdxBlocks(body);
  const rows = getEntryRows(name, body);
  const row = rows[ordinal];
  if (!row) return body;
  blocks[row.index] = patcher(blocks[row.index]);
  return serializeMdxBlocks(blocks);
}

function removeEntry(body: string, name: ComponentName, ordinal: number): string {
  const blocks = parseMdxBlocks(body);
  const row = getEntryRows(name, body)[ordinal];
  if (!row) return body;
  blocks.splice(row.index, 1);
  return serializeMdxBlocks(blocks.length ? blocks : [createMdxBlock("paragraph")]);
}

function moveEntry(body: string, name: ComponentName, ordinal: number, direction: -1 | 1): string {
  const blocks = parseMdxBlocks(body);
  const rows = getEntryRows(name, body);
  const row = rows[ordinal];
  const target = rows[ordinal + direction];
  if (!row || !target) return body;
  [blocks[row.index], blocks[target.index]] = [blocks[target.index], blocks[row.index]];
  return serializeMdxBlocks(blocks);
}

function validationIssues(name: ComponentName, body: string): string[] {
  const rows = getEntryRows(name, body);
  const issues: string[] = [];
  rows.forEach(({ block }, index) => {
    const label = `#${index + 1}`;
    if (block.type === "news-entry") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(block.dateIso ?? "")) {
        issues.push(`${label} date must be YYYY-MM-DD`);
      }
      if (!blockText(block)) issues.push(`${label} body missing`);
      return;
    }
    if (block.type === "teaching-entry") {
      if (!(block.teachingCourseCode ?? "").trim()) issues.push(`${label} course code missing`);
      if (!(block.teachingCourseName ?? "").trim()) issues.push(`${label} course name missing`);
      return;
    }
    if (block.type === "works-entry") {
      if (!(block.worksRole ?? "").trim()) issues.push(`${label} role missing`);
      if (!(block.worksPeriod ?? "").trim()) issues.push(`${label} period missing`);
      return;
    }
    if (block.type === "publications-entry") {
      const data = parsePubData(block.pubData);
      if (!String(data.title ?? "").trim()) issues.push(`${label} title missing`);
      if (!String(data.year ?? "").trim()) issues.push(`${label} year missing`);
      if (!data.authorsRich?.some((author) => author.name.trim())) {
        issues.push(`${label} author missing`);
      }
      return;
    }
  });
  return issues;
}

function summarizeLiveBlocks(
  name: ComponentName,
  body: string,
): { count: number; invalid: number; issues: string[] } {
  const rows = getEntryRows(name, body);
  const issues = validationIssues(name, body);
  return { count: rows.length, invalid: issues.length, issues };
}

const ENABLE_COMPONENT_COLLECTION_TABLE = false;

function usesStructuredCollectionTable(name: ComponentName): boolean {
  return (
    ENABLE_COMPONENT_COLLECTION_TABLE &&
    (name === "teaching" || name === "publications")
  );
}

function EntryActions({
  canMoveDown,
  canMoveUp,
  onMoveDown,
  onMoveUp,
  onRemove,
}: {
  canMoveDown: boolean;
  canMoveUp: boolean;
  onMoveDown: () => void;
  onMoveUp: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="component-collection-table__actions">
      <button type="button" onClick={onMoveUp} disabled={!canMoveUp} aria-label="Move entry up">
        ↑
      </button>
      <button type="button" onClick={onMoveDown} disabled={!canMoveDown} aria-label="Move entry down">
        ↓
      </button>
      <button type="button" onClick={onRemove} aria-label="Remove entry">
        ×
      </button>
    </div>
  );
}

function ComponentCollectionTable({
  body,
  name,
  setBody,
}: {
  body: string;
  name: ComponentName;
  setBody: Dispatch<SetStateAction<string>>;
}) {
  const definition = getSiteComponentDefinition(name);
  const rows = getEntryRows(name, body);
  const patch = (ordinal: number, patcher: (block: MdxBlock) => MdxBlock) =>
    setBody((current) => patchEntry(current, name, ordinal, patcher));
  const remove = (ordinal: number) =>
    setBody((current) => removeEntry(current, name, ordinal));
  const move = (ordinal: number, direction: -1 | 1) =>
    setBody((current) => moveEntry(current, name, ordinal, direction));

  return (
    <details className="component-collection-table" open>
      <summary>
        <span>{definition.entryLabel}s</span>
        <strong>{rows.length}</strong>
      </summary>
      <div className="component-collection-table__body">
        {rows.length === 0 ? (
          <p className="component-collection-table__empty">No entries.</p>
        ) : null}
        {rows.map(({ block, ordinal }) => {
          const common = (
            <EntryActions
              canMoveDown={ordinal < rows.length - 1}
              canMoveUp={ordinal > 0}
              onMoveDown={() => move(ordinal, 1)}
              onMoveUp={() => move(ordinal, -1)}
              onRemove={() => remove(ordinal)}
            />
          );

          if (name === "news") {
            return (
              <div className="component-collection-table__row component-collection-table__row--news" key={block.id}>
                <label>
                  <span>Date</span>
                  <input
                    value={block.dateIso ?? ""}
                    onChange={(event) =>
                      patch(ordinal, (current) => ({ ...current, dateIso: event.target.value }))
                    }
                    aria-invalid={!/^\d{4}-\d{2}-\d{2}$/.test(block.dateIso ?? "") || undefined}
                  />
                </label>
                <div className="component-collection-table__summary">
                  <strong>{blockText(block) || "Empty news body"}</strong>
                </div>
                {common}
              </div>
            );
          }

          if (name === "teaching") {
            return (
              <div className="component-collection-table__row component-collection-table__row--teaching" key={block.id}>
                <label>
                  <span>Term</span>
                  <input
                    value={block.teachingTerm ?? ""}
                    onChange={(event) =>
                      patch(ordinal, (current) => ({ ...current, teachingTerm: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>Code</span>
                  <input
                    value={block.teachingCourseCode ?? ""}
                    onChange={(event) =>
                      patch(ordinal, (current) => ({ ...current, teachingCourseCode: event.target.value }))
                    }
                    aria-invalid={!(block.teachingCourseCode ?? "").trim() || undefined}
                  />
                </label>
                <label>
                  <span>Name</span>
                  <input
                    value={block.teachingCourseName ?? ""}
                    onChange={(event) =>
                      patch(ordinal, (current) => ({ ...current, teachingCourseName: event.target.value }))
                    }
                    aria-invalid={!(block.teachingCourseName ?? "").trim() || undefined}
                  />
                </label>
                <label>
                  <span>Role</span>
                  <input
                    value={block.teachingRole ?? ""}
                    onChange={(event) =>
                      patch(ordinal, (current) => ({ ...current, teachingRole: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>Period</span>
                  <input
                    value={block.teachingPeriod ?? ""}
                    onChange={(event) =>
                      patch(ordinal, (current) => ({ ...current, teachingPeriod: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>URL</span>
                  <input
                    value={block.teachingCourseUrl ?? ""}
                    onChange={(event) =>
                      patch(ordinal, (current) => ({
                        ...current,
                        teachingCourseUrl: event.target.value || undefined,
                      }))
                    }
                  />
                </label>
                {common}
              </div>
            );
          }

          if (name === "works") {
            return (
              <div className="component-collection-table__row component-collection-table__row--works" key={block.id}>
                <label>
                  <span>Type</span>
                  <select
                    value={block.worksCategory ?? "recent"}
                    onChange={(event) =>
                      patch(ordinal, (current) => ({
                        ...current,
                        worksCategory: event.target.value === "passed" ? "passed" : "recent",
                      }))
                    }
                  >
                    <option value="recent">Recent</option>
                    <option value="passed">Past</option>
                  </select>
                </label>
                <label>
                  <span>Role</span>
                  <input
                    value={block.worksRole ?? ""}
                    onChange={(event) =>
                      patch(ordinal, (current) => ({ ...current, worksRole: event.target.value }))
                    }
                    aria-invalid={!(block.worksRole ?? "").trim() || undefined}
                  />
                </label>
                <label>
                  <span>Affiliation</span>
                  <input
                    value={block.worksAffiliation ?? ""}
                    onChange={(event) =>
                      patch(ordinal, (current) => ({
                        ...current,
                        worksAffiliation: event.target.value || undefined,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>Period</span>
                  <input
                    value={block.worksPeriod ?? ""}
                    onChange={(event) =>
                      patch(ordinal, (current) => ({ ...current, worksPeriod: event.target.value }))
                    }
                    aria-invalid={!(block.worksPeriod ?? "").trim() || undefined}
                  />
                </label>
                {common}
              </div>
            );
          }

          const data = parsePubData(block.pubData);
          return (
            <div className="component-collection-table__row component-collection-table__row--publication" key={block.id}>
              <label>
                <span>Title</span>
                <input
                  value={data.title ?? ""}
                  onChange={(event) =>
                    patch(ordinal, (current) =>
                      setPublicationField(current, (item) => ({
                        ...item,
                        title: event.target.value,
                      })),
                    )
                  }
                  aria-invalid={!data.title?.trim() || undefined}
                />
              </label>
              <label>
                <span>Year</span>
                <input
                  value={data.year ?? ""}
                  onChange={(event) =>
                    patch(ordinal, (current) =>
                      setPublicationField(current, (item) => ({
                        ...item,
                        year: event.target.value,
                      })),
                    )
                  }
                  aria-invalid={!data.year?.trim() || undefined}
                />
              </label>
              <label>
                <span>Authors</span>
                <input
                  value={formatAuthors(data.authorsRich)}
                  onChange={(event) =>
                    patch(ordinal, (current) =>
                      setPublicationField(current, (item) => ({
                        ...item,
                        authorsRich: parseAuthors(event.target.value),
                      })),
                    )
                  }
                  aria-invalid={!data.authorsRich?.length || undefined}
                />
              </label>
              <label>
                <span>Labels</span>
                <input
                  value={formatCommaList(data.labels)}
                  onChange={(event) =>
                    patch(ordinal, (current) =>
                      setPublicationField(current, (item) => ({
                        ...item,
                        labels: commaList(event.target.value),
                      })),
                    )
                  }
                />
              </label>
              <label>
                <span>URL</span>
                <input
                  value={data.url ?? ""}
                  onChange={(event) =>
                    patch(ordinal, (current) =>
                      setPublicationField(current, (item) => ({
                        ...item,
                        url: event.target.value || undefined,
                      })),
                    )
                  }
                />
              </label>
              <details className="component-collection-table__advanced">
                <summary>More</summary>
                <label>
                  <span>Venues</span>
                  <textarea
                    rows={3}
                    value={formatVenues(data.venues)}
                    onChange={(event) =>
                      patch(ordinal, (current) =>
                        setPublicationField(current, (item) => ({
                          ...item,
                          venues: parseVenues(event.target.value),
                        })),
                      )
                    }
                  />
                </label>
                <label>
                  <span>Highlights</span>
                  <input
                    value={formatCommaList(data.highlights)}
                    onChange={(event) =>
                      patch(ordinal, (current) =>
                        setPublicationField(current, (item) => ({
                          ...item,
                          highlights: commaList(event.target.value),
                        })),
                      )
                    }
                  />
                </label>
                <label>
                  <span>External URLs</span>
                  <textarea
                    rows={2}
                    value={formatLines(data.externalUrls)}
                    onChange={(event) =>
                      patch(ordinal, (current) =>
                        setPublicationField(current, (item) => ({
                          ...item,
                          externalUrls: parseLines(event.target.value),
                        })),
                      )
                    }
                  />
                </label>
              </details>
              {common}
            </div>
          );
        })}
      </div>
    </details>
  );
}

function ComponentEmbedPreview({
  body,
  name,
}: {
  body: string;
  name: ComponentName;
}) {
  const { request } = useSiteAdmin();
  const [state, setState] = useState({ html: "", loading: false, error: "" });
  const isEmpty = !body.trim();

  useEffect(() => {
    if (!body.trim()) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setState((current) => ({ ...current, loading: true, error: "" }));
      const response = await request(
        `/api/site-admin/components/${encodeURIComponent(name)}/preview`,
        "POST",
        { source: body },
      );
      if (cancelled) return;
      if (!response.ok) {
        setState({
          html: "",
          loading: false,
          error: `${response.code}: ${response.error}`,
        });
        return;
      }
      const data = asRecord(response.data);
      setState({
        html: asString(data.html),
        loading: false,
        error: "",
      });
    }, 550);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [body, name, request]);

  return (
    <details className="component-embed-preview">
      <summary>
        <span>Embedded preview</span>
        {state.loading ? <strong>Rendering</strong> : null}
      </summary>
      {isEmpty ? (
        <p className="component-embed-preview__error">No content to preview.</p>
      ) : state.error ? (
        <p className="component-embed-preview__error">{state.error}</p>
      ) : (
        <div
          className="notion-root mdx-post__body component-embed-preview__body"
          dangerouslySetInnerHTML={{ __html: state.html }}
        />
      )}
    </details>
  );
}

function ComponentDocumentTools({
  body,
  name,
  setBody,
}: {
  body: string;
  name: ComponentName;
  setBody: Dispatch<SetStateAction<string>>;
}) {
  const definition = getSiteComponentDefinition(name);
  return (
    <>
      <div className="component-editor-tools">
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => setBody((current) => appendEntry(current, name))}
        >
          Add {definition.entryLabel}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => setBody((current) => sortEntries(current, name))}
        >
          Normalize order
        </button>
        <span>
          Stored in <code>{definition.sourcePath}</code>
        </span>
      </div>
      {usesStructuredCollectionTable(name) ? (
        <>
          <ComponentCollectionTable body={body} name={name} setBody={setBody} />
          <ComponentEmbedPreview body={body} name={name} />
        </>
      ) : null}
    </>
  );
}

function ComponentProperties({
  name,
  info,
  props,
}: {
  name: ComponentName;
  info: ComponentInfo | null;
  props: MdxDocumentPropertiesProps<ComponentFrontmatterForm>;
}) {
  const definition = getSiteComponentDefinition(name);
  const { connection } = useSiteAdmin();
  const live = summarizeLiveBlocks(name, props.body);
  const usage = info?.usage ?? [];
  const rows = info?.summary.rows ?? [];

  return (
    <div className="component-editor-properties">
      <section>
        <span className="home-builder__eyebrow">Registry</span>
        <dl className="component-editor-properties__list">
          <div>
            <dt>Embed</dt>
            <dd>
              <code>&lt;{definition.embedTag} /&gt;</code>
            </dd>
          </div>
          <div>
            <dt>Entry</dt>
            <dd>{definition.entryLabel}</dd>
          </div>
          <div>
            <dt>Primary route</dt>
            <dd>{definition.primaryRoute}</dd>
          </div>
        </dl>
      </section>

      <section>
        <span className="home-builder__eyebrow">Entries</span>
        <div className="component-editor-properties__stat">
          <strong>{live.count}</strong>
          <span>{definition.entryLabel}s in this draft</span>
        </div>
        {live.invalid > 0 ? (
          <p className="component-editor-properties__warn">
            {live.invalid} issue{live.invalid === 1 ? "" : "s"} need attention before save.
          </p>
        ) : null}
        {live.issues.length > 0 ? (
          <ul className="component-editor-properties__issues">
            {live.issues.slice(0, 6).map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        ) : null}
        {rows.length > 0 ? (
          <ul className="component-editor-properties__rows">
            {rows.map((row) => (
              <li key={`${row.title}-${row.detail ?? ""}`}>
                <strong>{row.title}</strong>
                {row.detail ? <span>{row.detail}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section>
        <span className="home-builder__eyebrow">Used by</span>
        {usage.length > 0 ? (
          <ul className="component-editor-properties__rows">
            {usage.map((item) => (
              <li key={`${item.kind}-${item.sourcePath}`}>
                <strong>{item.title || item.routePath}</strong>
                <span>
                  {item.routePath} · {item.sourcePath}
                </span>
                {connection.baseUrl && item.routePath ? (
                  <a
                    href={`${connection.baseUrl.replace(/\/+$/, "")}${item.routePath}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="component-editor-properties__empty">
            No page currently embeds this collection.
          </p>
        )}
      </section>
    </div>
  );
}

/** Editor for one of the four reusable MDX components. Uses the same
 * MdxDocumentEditor as Posts/Pages but with a stripped-down adapter:
 * no slug field (the four names are fixed), no draft toggle, no SEO
 * panel, no description — just a title and the block-edited body. */
export function ComponentEditor({ name, onExit }: ComponentEditorProps) {
  const definition = getSiteComponentDefinition(name);
  const infoRef = useRef<ComponentInfo | null>(null);
  const [, setInfoRevision] = useState(0);
  const adapter = useMemo<MdxDocumentEditorAdapter<ComponentFrontmatterForm>>(
    () => ({
      buildSource: buildComponentSource,
      // The MDX body must be non-empty (an empty file would be an
      // invalid component). The title is also expected to be present
      // — every shipped component file already carries one.
      canSave: ({ body, form }) => {
        if (!form.title.trim()) return false;
        if (!body.trim()) return false;
        if (validationIssues(name, body).length > 0) return false;
        return true;
      },
      contentPath: (slug) => `content/components/${slug}.mdx`,
      createBlankForm: blankForm,
      defaultBody: "",
      getTitle: (form) => form.title,
      kind: "component",
      loadDocument: async ({ request, slug }) => {
        const response = await request(
          `/api/site-admin/components/${encodeURIComponent(slug)}`,
          "GET",
        );
        if (!response.ok) {
          return {
            ok: false,
            code: response.code || "LOAD_FAILED",
            error: response.error || "Failed to load component",
          };
        }
        infoRef.current = parseInfo(name, response.data);
        setInfoRevision((current) => current + 1);
        const data = asRecord(response.data);
        const source = asString(data.source);
        const version = asString(data.version);
        if (!source || !version) {
          return {
            ok: false,
            code: "BAD_RESPONSE",
            error: "Component response is missing source or version",
          };
        }
        return { ok: true, source, version };
      },
      parseSource: parseComponentSource,
      renderDocumentTools: ({ body, setBody }) => (
        <ComponentDocumentTools body={body} name={name} setBody={setBody} />
      ),
      renderProperties: (props) => (
        <ComponentProperties name={name} info={infoRef.current} props={props} />
      ),
      routeBase: "/api/site-admin/components",
      setTitle: (form, title) => ({ ...form, title }),
      titleNoun: `${definition.label} collection`,
    }),
    [definition.label, name],
  );

  // Components are always edited (never created or deleted) — the
  // four names are fixed by code. Pin mode to "edit" and pass the
  // component name as the slug.
  return (
    <MdxDocumentEditor
      adapter={adapter}
      mode="edit"
      slug={name}
      onExit={onExit}
    />
  );
}

export { SITE_COMPONENT_DEFINITIONS };
