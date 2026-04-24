#!/usr/bin/env node
// One-shot: parse content/pages/teaching.mdx into content/teaching.json.
//
// Source MDX has:
// - A blockquote intro line
// - A "Archived Course Pages | Rate My Professors" header-link line
// - A bullet list of entries with inline **bold** role + course link
//   patterns that parse reliably via regex (format is consistent).
// - Footer links at the bottom ("Appointment", "Feedback", "Archive").

import fs from "node:fs/promises";
import path from "node:path";

const SOURCE = "content/pages/teaching.mdx";
const DEST = "content/teaching.json";

function stripFrontmatter(source) {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/m.exec(source);
  return match ? match[2] : source;
}

function readFrontmatterField(source, key) {
  const match = new RegExp(`^${key}\\s*:\\s*"?([^"\\n]+)"?`, "m").exec(source);
  return match ? match[1].trim() : "";
}

// Pull every [label](href) from a chunk of markdown.
function extractLinks(line) {
  const out = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    const label = m[1].replace(/\*+/g, "").trim();
    const href = m[2].trim();
    if (label && href) out.push({ label, href });
  }
  return out;
}

// Parse a single bullet-list entry. Shape (copied from current MDX):
//   **<term>** <period> **<role>** for <CODE>[optional (url)]? (<name>, **<instructor>**)
function parseBulletEntry(raw) {
  // Strip leading "-   " and normalize whitespace.
  const line = raw.replace(/^-\s+/, "").trim();
  if (!line) return null;

  // 1) Term (first **...**): the text between the first pair of ** markers.
  const termMatch = /^\*\*([^*]+)\*\*\s+([\s\S]*)$/.exec(line);
  if (!termMatch) return null;
  const term = termMatch[1].trim();
  let rest = termMatch[2];

  // 2) Period = text up to the next **...** (the role).
  const roleMatch = /^(.+?)\s+\*\*([^*]+)\*\*\s+for\s+([\s\S]*)$/.exec(rest);
  if (!roleMatch) return null;
  const period = roleMatch[1].trim();
  const role = roleMatch[2].trim();
  rest = roleMatch[3];

  // 3) Course code — either bare token or linked [CODE](url).
  let courseCode = "";
  let courseUrl = undefined;
  const codeLinkMatch = /^\*\*\[([^\]]+)\]\(([^)]+)\)\*\*\s*([\s\S]*)$/.exec(rest);
  const codeBareMatch = /^([A-Z]+\d+[A-Za-z]?)\s*([\s\S]*)$/.exec(rest);
  if (codeLinkMatch) {
    courseCode = codeLinkMatch[1].trim();
    courseUrl = codeLinkMatch[2].trim();
    rest = codeLinkMatch[3];
  } else if (codeBareMatch) {
    courseCode = codeBareMatch[1].trim();
    rest = codeBareMatch[2];
  }

  // 4) Parenthetical tail: (CourseName[, **Instructor**]).
  let courseName = "";
  let instructor = undefined;
  const parenMatch = /^\(([^)]+)\)\s*$/.exec(rest.trim());
  if (parenMatch) {
    const inner = parenMatch[1];
    // Split on the last comma that's followed by ` **...**` (instructor).
    const instructorMatch = /^(.*?),\s*\*\*([^*]+)\*\*\s*$/.exec(inner.trim());
    if (instructorMatch) {
      courseName = instructorMatch[1].trim();
      instructor = instructorMatch[2].trim();
    } else {
      courseName = inner.trim();
    }
  } else {
    // No parenthetical — leftover string is the name.
    courseName = rest.replace(/\*\*/g, "").trim();
  }

  const entry = { term, period, role, courseCode, courseName };
  if (courseUrl) entry.courseUrl = courseUrl;
  if (instructor) entry.instructor = instructor;
  return entry;
}

async function main() {
  const raw = await fs.readFile(SOURCE, "utf8").catch((err) => {
    console.error(`Cannot read ${SOURCE}: ${err.message}`);
    process.exit(1);
  });

  const body = stripFrontmatter(raw);
  const title = readFrontmatterField(raw, "title") || "Teaching";
  const description = readFrontmatterField(raw, "description") || undefined;

  const lines = body.split(/\r?\n/);
  let intro = "";
  const headerLinks = [];
  const entries = [];
  const footerLinks = [];

  // Walk lines: quote → intro; bullet list → entries; plain links-only
  // lines become header or footer links depending on position.
  let sawBullets = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith(">")) {
      const note = trimmed.replace(/^>\s*/, "");
      intro = intro ? `${intro}\n${note}` : note;
      continue;
    }
    if (/^-\s+/.test(trimmed)) {
      sawBullets = true;
      const entry = parseBulletEntry(trimmed);
      if (entry) entries.push(entry);
      continue;
    }
    // Plain link lines: extract any markdown links.
    if (/\[[^\]]+\]\([^)]+\)/.test(trimmed)) {
      const found = extractLinks(trimmed);
      (sawBullets ? footerLinks : headerLinks).push(...found);
      continue;
    }
    // Other paragraphs — fold into intro if we haven't hit bullets yet.
    if (!sawBullets) {
      intro = intro ? `${intro}\n\n${trimmed}` : trimmed;
    }
  }

  const data = {
    title,
    ...(description ? { description } : {}),
    ...(intro ? { intro } : {}),
    headerLinks,
    entries,
    footerLinks,
  };
  const outPath = path.resolve(DEST);
  await fs.writeFile(outPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(
    `Wrote ${DEST}: ${entries.length} entries, ${headerLinks.length} header + ${footerLinks.length} footer links.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
