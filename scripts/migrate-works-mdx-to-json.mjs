#!/usr/bin/env node
// Best-effort migration of content/pages/works.mdx into
// content/works.json. The MDX uses a loose Notion-ish structure:
//
//   > intro quote
//   # Recent Works
//   ‣
//   **Role** **[Affiliation](url)** [extra], Location Period
//   Description paragraph...
//   ‣
//   ...
//   # Passed Works
//   ‣
//   ...
//   > note quote
//
// The regexes here capture role / affiliation / affiliationUrl / location /
// period on a best-effort basis — the user can refine each entry via the
// site-admin Works panel after migration.

import fs from "node:fs/promises";
import path from "node:path";

const SOURCE = "content/pages/works.mdx";
const DEST = "content/works.json";

function stripFrontmatter(source) {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/m.exec(source);
  return match ? match[2] : source;
}

function readFrontmatterField(source, key) {
  const match = new RegExp(`^${key}\\s*:\\s*"?([^"\\n]+)"?`, "m").exec(source);
  return match ? match[1].trim() : "";
}

function parseHeaderLine(line) {
  // Pattern target:
  //   **Role** **[AffLabel](url)** **(ExtraBoldText),** Location Period
  // We split into tokens by tracking bold spans and plain runs.
  const out = { role: "", affiliation: "", affiliationUrl: "", location: "", period: "" };

  // Step 1: pull the FIRST **...** as the role (strip internal markdown formatting).
  const roleMatch = /^\*\*(.+?)\*\*\s*([\s\S]*)$/.exec(line);
  if (!roleMatch) {
    // No bold marker — dump raw into role.
    out.role = line.replace(/\*\*/g, "").trim();
    return out;
  }
  out.role = roleMatch[1].replace(/\*\*/g, "").trim();
  let rest = roleMatch[2];

  // Step 2: capture the SECOND **...** (may contain a [label](url) pair)
  // as the affiliation.
  const affMatch = /^\*\*(.+?)\*\*\s*([\s\S]*)$/.exec(rest);
  if (affMatch) {
    const affBlob = affMatch[1];
    rest = affMatch[2];
    // Inline link inside affiliation?
    const linkMatch = /\[([^\]]+)\]\(([^)]+)\)/.exec(affBlob);
    if (linkMatch) {
      out.affiliation = linkMatch[1].replace(/\*+/g, "").trim();
      out.affiliationUrl = linkMatch[2].trim();
    } else {
      out.affiliation = affBlob.replace(/\*+/g, "").trim();
    }
    // Step 2b: optional trailing bold like "(Donut Labs),". Swallow.
    const tailMatch = /^\*\*([^*]+)\*\*\s*([\s\S]*)$/.exec(rest);
    if (tailMatch) {
      const extra = tailMatch[1].replace(/[(),]/g, "").trim();
      if (extra && out.affiliation) {
        out.affiliation = `${out.affiliation} (${extra})`;
      }
      rest = tailMatch[2];
    }
  }

  // Step 3: remainder split — the period is the tail (contains a year
  // or "Now"). Everything before it is location.
  rest = rest.replace(/^[,.\s]+/, "").trim();
  // Match "Month YYYY - Month YYYY" / "Month YYYY - **Now**" / similar.
  const periodMatch = /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}\s*-\s*(?:\*\*Now\*\*|\*\*Present\*\*|Now|Present|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}))\s*$/.exec(rest);
  if (periodMatch) {
    out.period = periodMatch[1].replace(/\*\*/g, "").trim();
    const before = rest.slice(0, periodMatch.index).trim();
    out.location = before.replace(/,\s*$/, "").trim();
  } else {
    // Fallback: whole remainder is location.
    out.location = rest.replace(/\*\*/g, "").trim();
  }

  return out;
}

async function main() {
  const raw = await fs.readFile(SOURCE, "utf8").catch((err) => {
    console.error(`Cannot read ${SOURCE}: ${err.message}`);
    process.exit(1);
  });

  const body = stripFrontmatter(raw);
  const title = readFrontmatterField(raw, "title") || "Works";
  const description = readFrontmatterField(raw, "description") || undefined;

  // Split by the "‣" bullet marker. Each chunk between bullets is one
  // entry's (header + description) pair. Section headers (`# Recent Works`,
  // `# Passed Works`) toggle the current category.
  const lines = body.split(/\r?\n/);
  let intro = "";
  let note = "";
  let introDone = false;
  let currentCategory = "passed";
  let currentEntry = null;
  const entries = [];
  let collectingBody = false;

  const pushCurrent = () => {
    if (!currentEntry) return;
    if (currentEntry.description) {
      currentEntry.description = currentEntry.description.trim();
    }
    entries.push(currentEntry);
    currentEntry = null;
  };

  for (const rawLine of lines) {
    const line = rawLine;
    const trimmed = line.trim();
    if (!trimmed) {
      // Blank lines inside a description keep paragraph spacing.
      if (currentEntry && collectingBody && currentEntry.description) {
        currentEntry.description += "\n\n";
      }
      continue;
    }

    if (trimmed.startsWith("# ")) {
      // Section heading — closes current entry + toggles category.
      pushCurrent();
      const name = trimmed.slice(2).toLowerCase();
      currentCategory = name.includes("recent") ? "recent" : "passed";
      collectingBody = false;
      continue;
    }

    if (trimmed === "‣") {
      pushCurrent();
      currentEntry = {
        category: currentCategory,
        role: "",
        period: "",
      };
      collectingBody = false;
      introDone = true;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteText = trimmed.replace(/^>\s*/, "");
      if (!introDone) {
        intro = intro ? `${intro}\n${quoteText}` : quoteText;
      } else {
        note = note ? `${note}\n${quoteText}` : quoteText;
      }
      continue;
    }

    if (currentEntry) {
      if (!currentEntry.role) {
        // First non-blank line after "‣" = header line.
        const parsed = parseHeaderLine(trimmed);
        currentEntry.role = parsed.role;
        if (parsed.affiliation) currentEntry.affiliation = parsed.affiliation;
        if (parsed.affiliationUrl) currentEntry.affiliationUrl = parsed.affiliationUrl;
        if (parsed.location) currentEntry.location = parsed.location;
        if (parsed.period) currentEntry.period = parsed.period;
        collectingBody = true;
        continue;
      }
      // Subsequent non-blank lines = description.
      currentEntry.description = currentEntry.description
        ? `${currentEntry.description}\n${trimmed}`
        : trimmed;
    } else if (!introDone) {
      // Non-blockquote text before the first bullet — fold into intro.
      intro = intro ? `${intro}\n${trimmed}` : trimmed;
    }
  }
  pushCurrent();

  const data = {
    title,
    ...(description ? { description } : {}),
    ...(intro ? { intro } : {}),
    ...(note ? { note } : {}),
    entries,
  };
  const outPath = path.resolve(DEST);
  await fs.writeFile(outPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  const recent = entries.filter((e) => e.category === "recent").length;
  const passed = entries.filter((e) => e.category === "passed").length;
  console.log(
    `Wrote ${DEST}: ${entries.length} entries (${recent} recent + ${passed} passed).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
