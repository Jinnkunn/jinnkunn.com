export type DocumentFieldProblem = { field: string; message: string };
type DocumentFields = { title?: unknown; date?: unknown; updated?: unknown; cover?: unknown; ogImage?: unknown; body?: unknown };

function validImageReference(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (/^\/(?!\/)/.test(value)) return !/[\r\n\\]/.test(value);
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password; }
  catch { return false; }
}

export function documentDraftProblems(fields: DocumentFields, kind: "posts" | "pages"): DocumentFieldProblem[] {
  const issues: DocumentFieldProblem[] = [];
  for (const field of kind === "posts" ? ["cover", "ogImage"] as const : []) {
    if (fields[field] && !validImageReference(fields[field])) issues.push({ field, message: "Use an HTTP(S) URL or a site-relative image path." });
  }
  return issues;
}

export function documentFieldProblems(fields: DocumentFields, kind: "posts" | "pages"): DocumentFieldProblem[] {
  const issues: DocumentFieldProblem[] = [];
  if (typeof fields.title !== "string" || !fields.title.trim()) issues.push({ field: "title", message: "Add a title." });
  if (kind === "posts" && !Number.isFinite(Date.parse(String(fields.date || "")))) issues.push({ field: "date", message: "Choose a valid publication date." });
  if (typeof fields.body !== "string" || !fields.body.trim()) issues.push({ field: "body", message: "Add body content." });
  if (kind === "pages" && fields.updated && !Number.isFinite(Date.parse(String(fields.updated)))) issues.push({ field: "updated", message: "Choose a valid updated date or leave it empty." });
  return [...issues, ...documentDraftProblems(fields, kind)];
}
