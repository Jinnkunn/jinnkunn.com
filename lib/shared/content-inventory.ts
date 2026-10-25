import matter from "gray-matter";
import { isSiteComponentName } from "../site-admin/component-registry.ts";
import { documentFieldProblems } from "./document-fields.ts";
import { frontmatterProblems } from "./document-draft-validation.ts";
import {
  parseNewsComponentDraft, parseTeachingComponentDraft, parseWorksComponentDraft, parsePublicationsComponentDraft,
  newsEntryIssues, teachingEntryIssues, worksEntryIssues, publicationEntryIssues,
} from "../../app/site-admin/site-admin-structured-collection-model.ts";

export type ContentProblem = { field: string; message: string; entryId?: string };
export type ContentInventoryItem = { path: string; modifiedAt: string | null; hidden: boolean; issues: ContentProblem[] };

export function documentProblems(source: string, kind: "posts" | "pages"): ContentProblem[] {
  try {
    const { data, content } = matter(source, {});
    const structural = frontmatterProblems(data);
    if (structural.length) return structural;
    return documentFieldProblems({ ...data, body: content }, kind);
  } catch { return [{ field: "source", message: "Frontmatter could not be read. Review the source." }]; }
}

export function contentInventory(sources: Record<string, string>, modified: Record<string, number> = {}): ContentInventoryItem[] {
  return Object.entries(sources).filter(([path]) => /^(posts|pages|components)\/.+\.mdx$/.test(path)).map(([path, source]) => {
    const timestamp = modified[path];
    let hidden = false;
    try { hidden = matter(source, {}).data.draft === true; } catch { /* Reported below. */ }
    let issues: ContentProblem[];
    if (!path.startsWith("components/")) issues = documentProblems(source, path.startsWith("posts/") ? "posts" : "pages");
    else {
      const name = path.slice(11, -4);
      issues = [];
      if (isSiteComponentName(name)) {
        try {
        // These models are framework-free: list badges use the editor's exact rules.
        if (name === "news") issues = parseNewsComponentDraft(source).items.flatMap((item) => item.type === "entry" ? newsEntryIssues(item) : []);
        else if (name === "teaching") issues = parseTeachingComponentDraft(source).items.flatMap(teachingEntryIssues);
        else if (name === "works") issues = parseWorksComponentDraft(source).items.flatMap(worksEntryIssues);
        else {
          const draft = parsePublicationsComponentDraft(source);
          issues = draft.items.flatMap(publicationEntryIssues);
          if ((source.match(/<PublicationsEntry\b/g)?.length || 0) > draft.items.length) issues.push({ field: "source", message: "A publication entry could not be read. Review the source before saving." });
        }
        } catch { issues = [{ field: "source", message: "An entry could not be read. Review the source before saving." }]; }
      }
    }
    return { path, hidden, issues, modifiedAt: Number.isFinite(timestamp) && timestamp > 0 && timestamp <= 8.64e15 ? new Date(timestamp).toISOString() : null };
  });
}
