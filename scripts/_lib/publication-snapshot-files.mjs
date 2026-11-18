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

export function validatePublishedSnapshot(value) {
  if (value?.version !== 1 || !value.sources || Array.isArray(value.sources) || typeof value.sources !== "object") {
    throw new Error("Invalid published content baseline.");
  }
  for (const [rel, body] of Object.entries(value.sources)) {
    if (!isPublicationSource(rel) || typeof body !== "string" || rel.includes("\\") ||
        rel.includes("\0") || rel.split("/").some((part) => part === ".." || part === "." || !part)) {
      throw new Error("Invalid path or source in published content baseline.");
    }
  }
  const snapshot = publicationSnapshot(value.sources);
  if (snapshot.sha !== value.sha) throw new Error("Published content baseline checksum mismatch.");
  return snapshot;
}

// Only call with an immutable release workspace, never the operator's checkout.
export function materializePublicationSnapshot(root, baseline) {
  const { sources, sha } = validatePublishedSnapshot(baseline);
  const content = path.join(root, "content");
  for (const rel of Object.keys(readPublicationSnapshot(root).sources)) {
    if (!Object.hasOwn(sources, rel)) fs.unlinkSync(path.join(content, rel));
  }
  for (const [rel, body] of Object.entries(sources)) {
    const file = path.join(content, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
  if (readPublicationSnapshot(root).sha !== sha) throw new Error("Could not reproduce the published content baseline.");
}
