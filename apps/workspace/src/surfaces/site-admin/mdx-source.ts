// Helpers to round-trip between editor form state and MDX source string.
// No external deps — the YAML we emit is small and well-scoped enough to
// hand-serialize, and we only parse back the subset the editor cares about.

export interface PostFrontmatterForm {
  title: string;
  dateIso: string;
  description: string;
  draft: boolean;
  tags: string[];
}

export interface PageFrontmatterForm {
  title: string;
  description: string;
  draft: boolean;
  updated: string; // ISO date or empty
}

/** Frontmatter for the four reusable MDX components edited via the
 * Components admin panel (News / Teaching / Publications / Works).
 * The component file has no public URL, so the form is just the
 * display title — kept as a field for round-trip fidelity with the
 * existing `title:` line each component MDX already carries. */
export interface ComponentFrontmatterForm {
  title: string;
}

function escapeYamlString(value: string): string {
  // Always emit double-quoted to sidestep YAML's tricky scalar rules.
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

export function buildPostSource(form: PostFrontmatterForm, body: string): string {
  const lines: string[] = ["---"];
  lines.push(`title: ${escapeYamlString(form.title)}`);
  lines.push(`date: ${form.dateIso}`);
  if (form.description.trim()) {
    lines.push(`description: ${escapeYamlString(form.description.trim())}`);
  }
  if (form.draft) lines.push("draft: true");
  if (form.tags.length > 0) {
    lines.push("tags:");
    for (const tag of form.tags) lines.push(`  - ${escapeYamlString(tag)}`);
  }
  lines.push("---", "");
  return `${lines.join("\n")}\n${body.trimStart()}`;
}

export function buildPageSource(form: PageFrontmatterForm, body: string): string {
  const lines: string[] = ["---"];
  lines.push(`title: ${escapeYamlString(form.title)}`);
  if (form.description.trim()) {
    lines.push(`description: ${escapeYamlString(form.description.trim())}`);
  }
  if (form.draft) lines.push("draft: true");
  if (form.updated.trim()) lines.push(`updated: ${form.updated.trim()}`);
  lines.push("---", "");
  return `${lines.join("\n")}\n${body.trimStart()}`;
}

function splitFrontmatter(source: string): { raw: string; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/m.exec(source);
  if (!match) return { raw: "", body: source };
  return { raw: match[1], body: match[2] };
}

function parseScalar(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\\\/g, "\\");
  }
  return trimmed;
}

export function parsePostSource(source: string): {
  form: PostFrontmatterForm;
  body: string;
} {
  const { raw, body } = splitFrontmatter(source);
  const form: PostFrontmatterForm = {
    title: "",
    dateIso: "",
    description: "",
    draft: false,
    tags: [],
  };
  const lines = raw.split(/\r?\n/);
  let inTags = false;
  for (const line of lines) {
    if (inTags) {
      const m = /^\s*-\s+(.+)$/.exec(line);
      if (m) {
        form.tags.push(parseScalar(m[1]));
        continue;
      }
      inTags = false;
    }
    if (/^tags\s*:/i.test(line)) {
      const inlineMatch = /^tags\s*:\s*\[(.+)\]\s*$/i.exec(line);
      if (inlineMatch) {
        form.tags = inlineMatch[1]
          .split(",")
          .map((s) => parseScalar(s))
          .filter(Boolean);
      } else {
        inTags = true;
      }
      continue;
    }
    const kv = /^(\w+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const value = kv[2];
    if (key === "title") form.title = parseScalar(value);
    else if (key === "date") form.dateIso = parseScalar(value);
    else if (key === "description") form.description = parseScalar(value);
    else if (key === "draft") form.draft = /true/i.test(parseScalar(value));
  }
  return { form, body };
}

export function buildComponentSource(
  form: ComponentFrontmatterForm,
  body: string,
): string {
  const lines: string[] = ["---"];
  lines.push(`title: ${escapeYamlString(form.title)}`);
  lines.push("---", "");
  return `${lines.join("\n")}\n${body.trimStart()}`;
}

export function parseComponentSource(source: string): {
  form: ComponentFrontmatterForm;
  body: string;
} {
  const { raw, body } = splitFrontmatter(source);
  const form: ComponentFrontmatterForm = { title: "" };
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const kv = /^(\w+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const value = kv[2];
    if (key === "title") form.title = parseScalar(value);
  }
  return { form, body };
}

export function parsePageSource(source: string): {
  form: PageFrontmatterForm;
  body: string;
} {
  const { raw, body } = splitFrontmatter(source);
  const form: PageFrontmatterForm = {
    title: "",
    description: "",
    draft: false,
    updated: "",
  };
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const kv = /^(\w+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const value = kv[2];
    if (key === "title") form.title = parseScalar(value);
    else if (key === "description") form.description = parseScalar(value);
    else if (key === "draft") form.draft = /true/i.test(parseScalar(value));
    else if (key === "updated") form.updated = parseScalar(value);
  }
  return { form, body };
}
