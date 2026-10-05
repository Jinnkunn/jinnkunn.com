import fs from "node:fs";
import path from "node:path";
import { isPublicationSource, publicationSnapshot } from "../../lib/shared/publication-snapshot.mjs";

export function readPublicationSnapshot(root) {
  const sources = {};
  function walk(dir, prefix = "") {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = `${prefix}${entry.name}`;
      if (entry.isDirectory() && ["posts", "pages", "components", "filesystem"].includes(rel.split("/")[0])) walk(path.join(dir, entry.name), `${rel}/`);
      else if (entry.isFile() && isPublicationSource(rel)) sources[rel] = fs.readFileSync(path.join(dir, entry.name), "utf8");
    }
  }
  walk(path.join(root, "content"));
  return publicationSnapshot(sources);
}
