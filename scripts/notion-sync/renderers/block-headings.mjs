import { compactId } from "../../../lib/shared/route-utils.mjs";
import { richTextPlain } from "../render-rich-text.mjs";

function collectHeadingsInto(blocks, out) {
  const list = Array.isArray(blocks) ? blocks : [];
  for (const b of list) {
    const id = compactId(b?.id);
    if (b?.type === "heading_1") out.push({ id, level: 1, text: richTextPlain(b.heading_1?.rich_text) });
    else if (b?.type === "heading_2") out.push({ id, level: 2, text: richTextPlain(b.heading_2?.rich_text) });
    else if (b?.type === "heading_3") out.push({ id, level: 3, text: richTextPlain(b.heading_3?.rich_text) });

    if (Array.isArray(b?.__children) && b.__children.length) collectHeadingsInto(b.__children, out);
  }
}

export function collectHeadings(blocks, out = []) {
  collectHeadingsInto(blocks, out);
  return out.filter((h) => h.text && h.text.trim());
}
