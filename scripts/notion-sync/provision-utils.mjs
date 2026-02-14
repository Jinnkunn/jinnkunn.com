import { notionRequest } from "../../lib/notion/index.mjs";
import { compactId } from "../../lib/shared/route-utils.mjs";

export function richText(content) {
  const c = String(content ?? "").trim();
  if (!c) return [];
  return [{ type: "text", text: { content: c } }];
}

export function richTextLink(label, url) {
  const l = String(label ?? "").trim();
  const u = String(url ?? "").trim();
  if (!l || !u) return richText(l);
  return [{ type: "text", text: { content: l, link: { url: u } } }];
}

export async function appendBlocks(parentBlockId, children) {
  if (!children.length) return;
  await notionRequest(`blocks/${parentBlockId}/children`, {
    method: "PATCH",
    body: { children },
  });
}

export async function updateBlock(blockId, patch) {
  await notionRequest(`blocks/${blockId}`, { method: "PATCH", body: patch });
}

export async function updateDatabase(databaseId, patch) {
  await notionRequest(`databases/${databaseId}`, { method: "PATCH", body: patch });
}

export async function getDatabase(databaseId) {
  return await notionRequest(`databases/${databaseId}`, { method: "GET" });
}

export async function archiveBlock(blockId) {
  await updateBlock(blockId, { archived: true });
}

export function findTextBlock(blocks, { type, includes }) {
  const want = String(includes || "").toLowerCase();
  for (const b of blocks) {
    if (b?.type !== type) continue;
    const rt = b?.[type]?.rich_text ?? [];
    const text = rt.map((x) => x?.plain_text ?? "").join("");
    if (text.toLowerCase().includes(want)) return b;
  }
  return null;
}

export function getTextFromBlock(block) {
  if (!block || typeof block !== "object") return "";
  const type = block.type;
  if (!type) return "";
  const rt = block?.[type]?.rich_text ?? [];
  if (!Array.isArray(rt)) return "";
  return rt.map((x) => x?.plain_text ?? "").join("").trim();
}

export function findHeadingBlock(blocks, { level, includes }) {
  const type = level === 1 ? "heading_1" : level === 2 ? "heading_2" : "heading_3";
  return findTextBlock(blocks, { type, includes });
}

export function findChildDatabaseBlock(blocks, title) {
  const want = String(title || "").trim().toLowerCase();
  for (const b of blocks) {
    if (b?.type !== "child_database") continue;
    const t = String(b.child_database?.title ?? "").trim().toLowerCase();
    if (t === want) return b;
  }
  return null;
}

export async function createInlineDatabase({
  parentPageId,
  title,
  properties,
}) {
  const db = await notionRequest("databases", {
    method: "POST",
    body: {
      parent: { type: "page_id", page_id: parentPageId },
      title: richText(title),
      is_inline: true,
      properties,
    },
  });
  return compactId(db?.id);
}

export async function createDatabaseRow({ databaseId, properties }) {
  await notionRequest("pages", {
    method: "POST",
    body: {
      parent: { database_id: databaseId },
      properties,
    },
  });
}
