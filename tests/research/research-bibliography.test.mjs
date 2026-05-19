import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const PAPER_DRAFT = "docs/research/release-agent-paper-draft.md";
const PAPER_MANUSCRIPT = "docs/research/paper.tex";
const REFERENCES_BIB = "docs/research/references.bib";

function unique(values) {
  return [...new Set(values)].sort();
}

function markdownCitationKeys(text) {
  return unique([...text.matchAll(/@([A-Za-z0-9_:-]+)/g)].map((match) => match[1]));
}

function latexCitationKeys(text) {
  const keys = [];
  for (const match of text.matchAll(/\\cite[a-zA-Z]*(?:\[[^\]]*\]){0,2}\{([^}]+)\}/g)) {
    keys.push(...match[1].split(",").map((key) => key.trim()).filter(Boolean));
  }
  return unique(keys);
}

test("research bibliography: paper citations resolve to BibTeX entries", () => {
  const bib = fs.readFileSync(REFERENCES_BIB, "utf8");
  const entries = unique([...bib.matchAll(/^@\w+\{([^,]+),/gm)].map((match) => match[1]));
  const paperFiles = [
    { file: PAPER_DRAFT, citationKeys: markdownCitationKeys },
    { file: PAPER_MANUSCRIPT, citationKeys: latexCitationKeys },
  ];

  for (const { file, citationKeys } of paperFiles) {
    const paper = fs.readFileSync(file, "utf8");
    const citations = citationKeys(paper);

    assert.equal(citations.length, 19, file);
    assert.equal(entries.length, 19);
    assert.deepEqual(
      citations.filter((citation) => !entries.includes(citation)),
      [],
      file,
    );
  }
});

test("research bibliography: every BibTeX file field points to a local PDF", () => {
  const bib = fs.readFileSync(REFERENCES_BIB, "utf8");
  const filePaths = [...bib.matchAll(/file = \{([^}]+)\}/g)].map((match) => match[1]);

  assert.equal(filePaths.length, 19);
  for (const filePath of filePaths) {
    assert.equal(fs.existsSync(filePath), true, `${filePath} is missing`);
    assert.equal(filePath.startsWith("docs/research/ref/"), true, filePath);
    assert.equal(filePath.endsWith(".pdf"), true, filePath);
  }
});
