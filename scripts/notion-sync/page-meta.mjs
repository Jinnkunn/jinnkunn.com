import { notionRequest } from "../../lib/notion/index.mjs";
import { compactId, normalizeRoutePath } from "../../lib/shared/route-utils.mjs";

function readTitleFromProperties(properties) {
  const props = properties && typeof properties === "object" ? properties : {};
  for (const v of Object.values(props)) {
    if (v && typeof v === "object" && v.type === "title") {
      const title = (Array.isArray(v.title) ? v.title : [])
        .map((x) => x?.plain_text ?? "")
        .join("")
        .trim();
      if (title) return title;
    }
  }
  return "Untitled";
}

export function normalizeHref(href) {
  const raw = String(href || "").trim();
  if (!raw) return "";

  // Keep absolute/external links intact.
  if (/^(https?:\/\/|mailto:|tel:|#)/i.test(raw)) return raw;

  // Treat everything else as an internal route.
  return normalizeRoutePath(raw);
}

export async function getPageInfo(pageId) {
  const pid = compactId(pageId);
  if (!pid) return { id: "", title: "Untitled", lastEdited: "" };
  const data = await notionRequest(`pages/${pid}`);
  const lastEdited = String(data?.last_edited_time || "").trim();
  const title = readTitleFromProperties(data?.properties);
  return { id: pid, title, lastEdited };
}

export async function getPageTitle(pageId) {
  const info = await getPageInfo(pageId);
  return info.title || "Untitled";
}

export function getTitleFromPageObject(page) {
  return readTitleFromProperties(page?.properties);
}
