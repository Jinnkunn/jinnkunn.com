import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseMdxBlocks, serializeMdxBlocks } from "./mdx-blocks";

const repoRoot = path.resolve(process.cwd(), "../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readHomeMdx(): string {
  const home = JSON.parse(readRepoFile("content/home.json")) as { bodyMdx?: string };
  return home.bodyMdx ?? "";
}

describe("content MDX block roundtrip contract", () => {
  const fixtures = [
    { name: "home", source: readHomeMdx },
    { name: "news page", source: () => readRepoFile("content/pages/news.mdx") },
    { name: "publications page", source: () => readRepoFile("content/pages/publications.mdx") },
    { name: "teaching page", source: () => readRepoFile("content/pages/teaching.mdx") },
    { name: "works page", source: () => readRepoFile("content/pages/works.mdx") },
    {
      name: "CSCI3141 archive page",
      source: () =>
        readRepoFile("content/pages/teaching/archive/2024-25-fall/csci3141.mdx"),
    },
  ];

  for (const fixture of fixtures) {
    it(`keeps ${fixture.name} serialization idempotent`, () => {
      const first = serializeMdxBlocks(parseMdxBlocks(fixture.source()));
      const second = serializeMdxBlocks(parseMdxBlocks(first));
      expect(second).toBe(first);
    });
  }

  it("keeps inline spaces around bold/link/gray/icon-link boundaries", () => {
    const source =
      '<span data-color="gray">research primarily focuses on</span> **Explainable AI**, <span data-color="gray">and</span> **Visualization**, plus **<span data-link-style="icon">[blog](/blog)</span>**';
    const serialized = serializeMdxBlocks(parseMdxBlocks(source)).trimEnd();
    expect(serialized).toBe(source);
  });
});
