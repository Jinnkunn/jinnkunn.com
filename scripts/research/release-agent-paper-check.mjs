#!/usr/bin/env node

import fs from "node:fs";

const PAPER_FILE = "docs/research/paper.tex";
const BIB_FILE = "docs/research/references.bib";
const REQUIRED_SECTIONS = [
  "\\section{Introduction}",
  "\\section{System Design}",
  "\\section{Benchmark Design}",
  "\\section{Experimental Setup}",
  "\\section{Results}",
  "\\section{Failure Analysis}",
  "\\section{Related Work}",
  "\\section{Discussion}",
  "\\section{Limitations}",
  "\\section{Conclusion}",
];

function unique(values) {
  return [...new Set(values)].sort();
}

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function citationKeys(latex) {
  const keys = [];
  for (const match of latex.matchAll(/\\cite[a-zA-Z]*(?:\[[^\]]*\]){0,2}\{([^}]+)\}/g)) {
    keys.push(...match[1].split(",").map((key) => key.trim()).filter(Boolean));
  }
  return unique(keys);
}

function bibKeys(bib) {
  return unique([...bib.matchAll(/^@\w+\{([^,]+),/gm)].map((match) => match[1]));
}

function bibFileFields(bib) {
  return [...bib.matchAll(/file = \{([^}]+)\}/g)].map((match) => match[1]);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const paper = readText(PAPER_FILE);
  const bib = readText(BIB_FILE);
  const citations = citationKeys(paper);
  const entries = bibKeys(bib);
  const fileFields = bibFileFields(bib);

  assert(paper.includes("\\bibliography{references}"), "paper.tex must use references.bib");
  assert(paper.includes("\\bibliographystyle{plainnat}"), "paper.tex must set a bibliography style");
  assert(!paper.includes("Paper Draft"), "paper.tex should not use draft title text");
  for (const section of REQUIRED_SECTIONS) {
    assert(paper.includes(section), `${section} is missing`);
  }

  const missingEntries = citations.filter((citation) => !entries.includes(citation));
  assert(missingEntries.length === 0, `missing BibTeX entries: ${missingEntries.join(", ")}`);
  assert(citations.length === entries.length, "paper citations and BibTeX entries should stay one-to-one");

  const missingFiles = fileFields.filter((file) => !fs.existsSync(file));
  assert(missingFiles.length === 0, `missing local PDFs: ${missingFiles.join(", ")}`);
  assert(fileFields.length === entries.length, "each BibTeX entry should include a local file field");

  console.log(
    JSON.stringify(
      {
        bibEntries: entries.length,
        citations: citations.length,
        localPdfFiles: fileFields.length,
        paper: PAPER_FILE,
      },
      null,
      2,
    ),
  );
}

main();
