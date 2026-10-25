import { announcementProblems, normalizeAnnouncement } from "./announcements.ts";
import { contentInventory, type ContentProblem, type ContentInventoryItem } from "./content-inventory.ts";

export type PublicationProblem = ContentProblem & { path: string };
export type PublicationValidation = { blockers: PublicationProblem[]; warnings: PublicationProblem[] };

export function publicationValidation(sources: Record<string, string>, inventory: ContentInventoryItem[] = contentInventory(sources)): PublicationValidation {
  const blockers: PublicationProblem[] = [];
  const warnings: PublicationProblem[] = [];
  for (const item of inventory) {
    for (const issue of item.issues) {
      const target = item.hidden && !["source", "cover", "ogImage"].includes(issue.field) ? warnings : blockers;
      target.push({ path: item.path, ...issue });
    }
  }
  for (const [path, source] of Object.entries(sources)) {
    if (!path.endsWith(".json")) continue;
    try {
      const value = JSON.parse(source);
      if (!value || typeof value !== "object") throw new Error("Expected a JSON document.");
      if (path === "home.json") {
        if (typeof value.title !== "string" || !value.title.trim()) blockers.push({ path, field: "title", message: "Add a home page title before publishing." });
      }
      if (path === "filesystem/announcements.json") {
        if (!Array.isArray(value.items)) throw new Error("Expected announcement items.");
        for (const raw of value.items) {
          const item = normalizeAnnouncement(raw);
          if (!item) throw new Error("Invalid announcement entry.");
          for (const issue of announcementProblems({ ...item, title: typeof raw.title === "string" ? raw.title : "" })) {
            (item.status === "published" ? blockers : warnings).push({ path, entryId: item.id, ...issue });
          }
        }
      }
    } catch {
      blockers.push({ path, field: "source", message: "This JSON document could not be read. Repair it before publishing." });
    }
  }
  return { blockers, warnings };
}

export function assertPublicationReady(snapshot: { sources: Record<string, string> }) {
  const result = publicationValidation(snapshot.sources);
  if (result.blockers.length) {
    throw new Error(`PUBLICATION_VALIDATION_FAILED: ${result.blockers.map((issue) => `${issue.path}${issue.entryId ? ` (${issue.entryId})` : ""} / ${issue.field}: ${issue.message}`).join("\n")}`);
  }
  return result;
}
