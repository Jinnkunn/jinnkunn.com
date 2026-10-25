export type DocumentFieldProblem = { field: string; message: string };
export function documentFieldProblems(fields: { title?: unknown; date?: unknown; cover?: unknown; ogImage?: unknown; body?: unknown }, kind: "posts" | "pages"): DocumentFieldProblem[] {
  const issues: DocumentFieldProblem[] = [];
  if (typeof fields.title !== "string" || !fields.title.trim()) issues.push({ field: "title", message: "Add a title." });
  if (kind === "posts" && !Number.isFinite(Date.parse(String(fields.date || "")))) issues.push({ field: "date", message: "Choose a valid publication date." });
  if (typeof fields.body !== "string" || !fields.body.trim()) issues.push({ field: "body", message: "Add body content." });
  for (const field of kind === "posts" ? ["cover", "ogImage"] as const : []) {
    if (fields[field] && !/^(https?:\/\/|\/(?!\/))/.test(String(fields[field]))) issues.push({ field, message: "Use an HTTP(S) URL or a site-relative image path." });
  }
  return issues;
}
