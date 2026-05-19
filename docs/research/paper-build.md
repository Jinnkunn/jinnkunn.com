# Research Paper Build Notes

This note describes the offline manuscript build path for the Guarded Agentic Release paper. It is research-only and does not touch the website, release scripts, Cloudflare, D1, staging, or production.

## Source Files

- Manuscript: `docs/research/paper.tex`
- Bibliography: `docs/research/references.bib`
- Reference PDFs: `docs/research/ref/*.pdf`
- Historical Markdown manuscript: `docs/research/paper.md`
- Longer working draft and appendix material: `docs/research/release-agent-paper-draft.md`

## Checks

Run:

```bash
npm run paper:research:check
```

This validates:

- `paper.tex` uses `references.bib`.
- `paper.tex` has the required manuscript sections.
- Every citation in `paper.tex` resolves to a BibTeX entry.
- Every BibTeX entry has a local PDF in `docs/research/ref/`.

## PDF Build

Run:

```bash
npm run paper:research:pdf
```

The generated PDF is written to:

```text
output/research/paper/guarded-agentic-release.pdf
```

The output directory is ignored by git and can be regenerated from the source files above.

The build uses LaTeX directly rather than Pandoc. The Markdown manuscript remains useful as prior working context, but the paper source of record is now `docs/research/paper.tex`.
