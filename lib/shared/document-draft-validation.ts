import matter from "gray-matter";
import { documentDraftProblems } from "./document-fields.ts";

export function frontmatterProblems(data: unknown): { field: string; message: string }[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [{ field: "source", message: "Frontmatter must be a readable mapping." }];
  const fields = data as Record<string, unknown>;
  const invalid = ["title", "description", "cover", "ogImage"].some((key) => fields[key] !== undefined && fields[key] !== null && typeof fields[key] !== "string")
    || ["date", "updated"].some((key) => fields[key] !== undefined && fields[key] !== null && typeof fields[key] !== "string" && !(fields[key] instanceof Date))
    || (fields.draft !== undefined && typeof fields.draft !== "boolean")
    || (fields.tags !== undefined && (!Array.isArray(fields.tags) || fields.tags.some((tag) => typeof tag !== "string")));
  return invalid ? [{ field: "source", message: "Metadata has an invalid field type. Review the frontmatter source." }] : [];
}

export function documentSourceProblems(source: string): { field: string; message: string }[] {
  try {
    const { data } = matter(source, {});
    return frontmatterProblems(data);
  } catch { return [{ field: "source", message: "Frontmatter must be a readable mapping." }]; }
}

export function assertDocumentDraftSource(source: string, kind: "posts" | "pages") {
  const structural = documentSourceProblems(source);
  if (structural.length) throw new Error(structural[0].message);
  const { data } = matter(source, {});
  const problems = documentDraftProblems(data, kind);
  if (problems.length) throw new Error(problems.map((issue) => issue.message).join(" "));
}
