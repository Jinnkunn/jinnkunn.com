import matter from "gray-matter";
import { parseDocument } from "yaml";

export type EditableKind = "posts" | "pages" | "components";
export type EditableContentForm = {
  title: string; description: string; date: string; updated: string; draft: boolean;
  tags: string; cover: string; ogImage: string; body: string; frontmatterKeys: string[];
  sourceBase?: string;
};
export type DocumentDetailPayload = {
  raw?: boolean; title?: string; source: string; body?: string;
};
export const EMPTY_CONTENT_FORM: EditableContentForm = {
  title: "", description: "", date: "", updated: "", draft: false,
  tags: "", cover: "", ogImage: "", body: "", frontmatterKeys: [],
};
const string = (value: unknown) => typeof value === "string" ? value : "";

function dateInput(value: unknown) {
  const raw = value instanceof Date ? value.toISOString() : string(value);
  const time = Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : raw;
}

export function tagArrayFromText(value: string) {
  return value.split(",").map((tag) => tag.trim()).filter(Boolean);
}
export function frontmatterString(value: string) { return JSON.stringify(value.trim()); }
export function frontmatterLine(key: string, value: string) {
  return value.trim() ? [`${key}: ${frontmatterString(value)}`] : [];
}

function splitDocument(source: string) {
  const parsed = matter(source, {});
  const prefix = source.slice(0, source.length - parsed.content.length);
  return { data: parsed.data as Record<string, unknown>, body: parsed.content, prefix };
}

export function formFromEditablePayload(kind: EditableKind, id: string, payload: DocumentDetailPayload): EditableContentForm {
  if (kind === "components" || payload.raw) return { ...EMPTY_CONTENT_FORM, title: payload.title || id, body: payload.source, sourceBase: payload.source };
  const { data, body } = splitDocument(payload.source);
  return {
    title: string(data.title), description: string(data.description), date: dateInput(data.date), updated: dateInput(data.updated),
    draft: data.draft === true, tags: Array.isArray(data.tags) ? data.tags.filter((tag) => typeof tag === "string").join(", ") : "",
    cover: string(data.cover), ogImage: string(data.ogImage), body,
    frontmatterKeys: Object.keys(data), sourceBase: payload.source,
  };
}

/** Updates only edited fields; an unchanged header stays byte-for-byte intact. */
export function sourceForEditedContent(kind: EditableKind, form: EditableContentForm, fallbackSource = "") {
  if (kind === "components") return form.body;
  const source = form.sourceBase ?? fallbackSource;
  const original = splitDocument(source);
  const baseline = formFromEditablePayload(kind, "", { source });
  const fields = ["title", "description", "draft", "cover", "ogImage", ...(kind === "posts" ? ["date", "tags"] : ["updated"])] as const;
  const changes = fields.filter((field) => form[field as keyof EditableContentForm] !== baseline[field as keyof EditableContentForm]);
  if (!changes.length) return original.prefix + form.body;

  const fence = /^(\uFEFF?---[^\S\r\n]*\r?\n)([\s\S]*?)(\r?\n(?:---|\.\.\.)[^\S\r\n]*(?:\r?\n|$))$/.exec(original.prefix);
  if (original.prefix && !fence) throw new Error("This frontmatter format requires source editing.");
  const doc = parseDocument(fence?.[2] || "", { keepSourceTokens: true });
  if (doc.errors.length) throw new Error("Repair the frontmatter before editing metadata.");
  for (const field of changes) {
    const value = form[field as keyof EditableContentForm];
    doc.set(field, field === "tags" ? tagArrayFromText(form.tags) : typeof value === "string" ? value.trim() : value);
  }
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const header = doc.toString().replace(/\n/g, eol).replace(new RegExp(`${eol}$`), "");
  return `${fence?.[1] || `---${eol}`}${header}${fence?.[3] || `${eol}---${eol}`}${form.body}`;
}

export function restoreDocumentForm(_kind: EditableKind, form: EditableContentForm, source: string): EditableContentForm {
  // Recovery copies written before sourceBase existed still carry full MDX.
  return { ...form, sourceBase: form.sourceBase ?? source, frontmatterKeys: form.frontmatterKeys || [] };
}
