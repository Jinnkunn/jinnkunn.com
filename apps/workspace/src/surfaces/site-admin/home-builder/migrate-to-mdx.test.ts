import { describe, expect, it } from "vitest";

import type {
  HomeFeaturedPagesSection,
  HomeHeroSection,
  HomeLayoutSection,
  HomeLinkListSection,
  HomeRichTextSection,
  HomeData,
} from "../types";
import { parseMdxBlocks } from "../mdx-blocks";

import { homeSectionsToMdx } from "./migrate-to-mdx";

function dataOf(...sections: HomeData["sections"]): HomeData {
  return { schemaVersion: 3, title: "T", sections };
}

const baseHero: HomeHeroSection = {
  id: "h",
  type: "hero",
  enabled: true,
  title: "Welcome",
  body: "Glad you're here.",
  profileImageUrl: "/uploads/me.jpg",
  profileImageAlt: "Me",
  imagePosition: "left",
  textAlign: "center",
  width: "standard",
};

const baseRich: HomeRichTextSection = {
  id: "r",
  type: "richText",
  enabled: true,
  title: "About",
  body: "Some prose.",
  variant: "standard",
  tone: "plain",
  textAlign: "left",
  width: "standard",
};

const baseLinkList: HomeLinkListSection = {
  id: "l",
  type: "linkList",
  enabled: true,
  title: "Find me",
  body: "Reach out.",
  layout: "grid",
  links: [
    { label: "GitHub", href: "https://github.com/x" },
    { label: "Email", href: "mailto:x@example.com", description: "fastest" },
  ],
  width: "standard",
};

const baseFeatured: HomeFeaturedPagesSection = {
  id: "f",
  type: "featuredPages",
  enabled: true,
  title: "Highlights",
  body: undefined,
  columns: 3,
  items: [
    { label: "Posts", href: "/posts", description: "Notes" },
    { label: "Works", href: "/works" },
  ],
  width: "standard",
};

const baseLayout: HomeLayoutSection = {
  id: "L",
  type: "layout",
  enabled: true,
  title: "Two columns",
  blocks: [
    { id: "L1", type: "markdown", column: 1, title: "Left", body: "Left side", tone: "plain", textAlign: "left" },
    { id: "L2", type: "markdown", column: 2, title: "Right", body: "Right side", tone: "plain", textAlign: "left" },
  ],
  variant: "standard",
  columns: 2,
  gap: "standard",
  verticalAlign: "start",
  width: "standard",
};

describe("homeSectionsToMdx", () => {
  it("returns empty mdx when there are no enabled sections", () => {
    const result = homeSectionsToMdx(dataOf());
    expect(result.mdx).toBe("");
    expect(result.notes).toEqual([]);
  });

  it("converts a hero with all attrs and notes that body moved", () => {
    const result = homeSectionsToMdx(dataOf(baseHero));
    expect(result.mdx).toContain(
      `<HeroBlock title="Welcome" imageUrl="/uploads/me.jpg" imageAlt="Me" imagePosition="left" textAlign="center" />`,
    );
    expect(result.mdx).toContain("Glad you're here.");
    expect(result.notes[0]).toMatch(/Hero body markdown moved/);
  });

  it("omits hero default imagePosition + textAlign", () => {
    const result = homeSectionsToMdx(
      dataOf({
        ...baseHero,
        imagePosition: "right",
        textAlign: "left",
        body: "",
      }),
    );
    expect(result.mdx).toContain(
      `<HeroBlock title="Welcome" imageUrl="/uploads/me.jpg" imageAlt="Me" />`,
    );
    expect(result.mdx).not.toMatch(/imagePosition/);
    expect(result.mdx).not.toMatch(/textAlign/);
  });

  it("converts a richText section to a heading + body", () => {
    const result = homeSectionsToMdx(dataOf(baseRich));
    expect(result.mdx).toContain("## About");
    expect(result.mdx).toContain("Some prose.");
    expect(result.notes).toEqual([]);
  });

  it("notes when richText tone/variant/textAlign are non-default (lossy)", () => {
    const result = homeSectionsToMdx(
      dataOf({ ...baseRich, tone: "panel", variant: "classicBody" }),
    );
    expect(result.notes[0]).toMatch(/tone\/variant\/textAlign/);
  });

  it("converts a linkList section to a LinkListBlock with intro and items", () => {
    const result = homeSectionsToMdx(dataOf(baseLinkList));
    expect(result.mdx).toContain("Reach out.");
    expect(result.mdx).toContain(
      `<LinkListBlock title="Find me" layout="grid" items='[{"label":"GitHub","href":"https://github.com/x"},{"label":"Email","href":"mailto:x@example.com","description":"fastest"}]' />`,
    );
  });

  it("omits LinkListBlock layout when it's the default 'stack'", () => {
    const result = homeSectionsToMdx(
      dataOf({ ...baseLinkList, layout: "stack", body: undefined }),
    );
    expect(result.mdx).not.toMatch(/layout=/);
  });

  it("converts a featuredPages section to a FeaturedPagesBlock with items + columns", () => {
    const result = homeSectionsToMdx(dataOf(baseFeatured));
    expect(result.mdx).toContain(
      `<FeaturedPagesBlock title="Highlights" columns={3} items='[{"label":"Posts","href":"/posts","description":"Notes"},{"label":"Works","href":"/works"}]' />`,
    );
  });

  it("flattens a layout section into single-column markdown with a note", () => {
    const result = homeSectionsToMdx(dataOf(baseLayout));
    expect(result.mdx).toContain("## Two columns");
    expect(result.mdx).toContain("### Left");
    expect(result.mdx).toContain("Left side");
    expect(result.mdx).toContain("### Right");
    expect(result.mdx).toContain("Right side");
    expect(result.notes[0]).toMatch(/multi-column structure flattened/);
  });

  it("skips disabled sections", () => {
    const disabledHero: HomeHeroSection = { ...baseHero, enabled: false };
    const result = homeSectionsToMdx(dataOf(disabledHero, baseRich));
    expect(result.mdx).not.toMatch(/HeroBlock/);
    expect(result.mdx).toContain("## About");
  });

  it("escapes apostrophes in item values via JSON unicode escape", () => {
    const linkList: HomeLinkListSection = {
      ...baseLinkList,
      body: undefined,
      links: [{ label: "Don't", href: "/x" }],
    };
    const result = homeSectionsToMdx(dataOf(linkList));
    expect(result.mdx).toContain("Don\\u0027t");
    expect(result.mdx).not.toMatch(/'Don't'/);
  });

  it("produces MDX that round-trips through parseMdxBlocks", () => {
    const result = homeSectionsToMdx(
      dataOf(baseHero, baseRich, baseLinkList, baseFeatured),
    );
    const blocks = parseMdxBlocks(result.mdx);
    const types = blocks.map((b) => b.type);
    expect(types).toContain("hero-block");
    expect(types).toContain("link-list-block");
    expect(types).toContain("featured-pages-block");
    expect(types).toContain("heading"); // ## About from richText
  });
});
