import "server-only";

export type NotionRichTextToken = {
  type: "text";
  text: { content: string };
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function notionRichText(content: string): NotionRichTextToken[] {
  const c = String(content ?? "").trim();
  return c ? [{ type: "text", text: { content: c } }] : [];
}

export function normalizeHttpUrl(input: string): string {
  const s = String(input || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s.replace(/^\/+/, "")}`;
}

export function redactUrlQueryParams(
  input: string,
  params: string[] = ["token"],
): string {
  const s = String(input || "");
  if (!s) return "";
  try {
    const url = new URL(s);
    for (const key of params) {
      if (url.searchParams.has(key)) url.searchParams.set(key, "[redacted]");
    }
    return url.toString();
  } catch {
    let out = s;
    for (const key of params) {
      const keyRe = escapeRegExp(String(key || "").trim());
      if (!keyRe) continue;
      out = out.replace(new RegExp(`${keyRe}=[^&\\s]+`, "gi"), `${key}=[redacted]`);
    }
    return out;
  }
}
