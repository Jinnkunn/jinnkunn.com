import { isRecord, readTrimmedString } from "./coerce.ts";
import type { NotionPageLike, NotionProperty, NotionRichTextItem } from "./types.ts";

function readProperties(page: NotionPageLike | null | undefined): Record<string, NotionProperty> {
  if (!page || !isRecord(page.properties)) return {};
  return page.properties as Record<string, NotionProperty>;
}

export function richTextPlain(rt: NotionRichTextItem[] | undefined | null): string {
  if (!Array.isArray(rt)) return "";
  return rt
    .map((item) => (isRecord(item) ? readTrimmedString(item.plain_text) : ""))
    .join("")
    .trim();
}

export function getPropString(
  page: NotionPageLike | null | undefined,
  name: string,
): string {
  const prop = readProperties(page)[name];
  if (!prop || !isRecord(prop)) return "";

  if (prop.type === "title") return richTextPlain(Array.isArray(prop.title) ? prop.title : []);
  if (prop.type === "rich_text") {
    return richTextPlain(Array.isArray(prop.rich_text) ? prop.rich_text : []);
  }
  if (prop.type === "select") return isRecord(prop.select) ? readTrimmedString(prop.select.name) : "";
  if (prop.type === "url") return readTrimmedString(prop.url);
  return "";
}

export function getPropNumber(
  page: NotionPageLike | null | undefined,
  name: string,
): number | null {
  const prop = readProperties(page)[name];
  if (!prop || !isRecord(prop) || prop.type !== "number") return null;
  return typeof prop.number === "number" && Number.isFinite(prop.number) ? prop.number : null;
}

export function getPropCheckbox(
  page: NotionPageLike | null | undefined,
  name: string,
): boolean | null {
  const prop = readProperties(page)[name];
  if (!prop || !isRecord(prop) || prop.type !== "checkbox") return null;
  return typeof prop.checkbox === "boolean" ? prop.checkbox : null;
}
