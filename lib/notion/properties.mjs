/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * @typedef {import("./types.ts").NotionRichTextItem} NotionRichTextItem
 */

/**
 * @typedef {import("./types.ts").NotionProperty} NotionProperty
 */

/**
 * @typedef {import("./types.ts").NotionPageLike} NotionPageLike
 */

/**
 * @param {NotionRichTextItem[] | undefined | null} rt
 * @returns {string}
 */
export function richTextPlain(rt) {
  if (!Array.isArray(rt)) return "";
  return rt
    .map((x) => (isRecord(x) ? String(x.plain_text ?? "") : ""))
    .join("")
    .trim();
}

/**
 * Read a Notion property from a page and return a simple string (best-effort).
 * @param {NotionPageLike | null | undefined} page
 * @param {string} name
 * @returns {string}
 */
export function getPropString(page, name) {
  const props = page && isRecord(page.properties)
    ? /** @type {Record<string, NotionProperty>} */ (page.properties)
    : {};
  const p = props[name];
  if (!p || !isRecord(p)) return "";

  if (p.type === "title") return richTextPlain(Array.isArray(p.title) ? p.title : []);
  if (p.type === "rich_text") return richTextPlain(Array.isArray(p.rich_text) ? p.rich_text : []);
  if (p.type === "select") return isRecord(p.select) ? String(p.select.name ?? "").trim() : "";
  if (p.type === "url") return String(p.url ?? "").trim();
  return "";
}

/**
 * @param {NotionPageLike | null | undefined} page
 * @param {string} name
 * @returns {number | null}
 */
export function getPropNumber(page, name) {
  const props = page && isRecord(page.properties)
    ? /** @type {Record<string, NotionProperty>} */ (page.properties)
    : {};
  const p = props[name];
  if (!p || !isRecord(p)) return null;
  if (p.type !== "number") return null;
  return typeof p.number === "number" ? p.number : null;
}

/**
 * @param {NotionPageLike | null | undefined} page
 * @param {string} name
 * @returns {boolean | null}
 */
export function getPropCheckbox(page, name) {
  const props = page && isRecord(page.properties)
    ? /** @type {Record<string, NotionProperty>} */ (page.properties)
    : {};
  const p = props[name];
  if (!p || !isRecord(p)) return null;
  if (p.type !== "checkbox") return null;
  return typeof p.checkbox === "boolean" ? p.checkbox : null;
}
