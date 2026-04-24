import test from "node:test";
import assert from "node:assert/strict";

import { normalizeHomeData } from "../lib/site-admin/home-normalize.ts";
import { normalizeNewsData } from "../lib/site-admin/news-normalize.ts";
import { normalizePublicationsData } from "../lib/site-admin/publications-normalize.ts";
import { normalizeTeachingData } from "../lib/site-admin/teaching-normalize.ts";
import { normalizeWorksData } from "../lib/site-admin/works-normalize.ts";

// ----------------------------------------------------------------------------
// Home
// ----------------------------------------------------------------------------

const emptyHome = {
  schemaVersion: 3,
  title: "Hi there!",
  sections: [
    {
      id: "home-empty",
      type: "richText",
      enabled: true,
      body: "",
      variant: "standard",
      tone: "plain",
      textAlign: "left",
      width: "standard",
    },
  ],
};

test("normalizeHomeData: returns empty template for non-object input", () => {
  assert.deepEqual(normalizeHomeData(null), emptyHome);
  assert.deepEqual(normalizeHomeData(undefined), emptyHome);
  assert.deepEqual(normalizeHomeData("nope"), emptyHome);
  assert.deepEqual(normalizeHomeData(42), emptyHome);
});

test("normalizeHomeData: uses sections as the only content source", () => {
  const result = normalizeHomeData({
    title: "Welcome",
    sections: [
      {
        id: "intro",
        type: "layout",
        enabled: true,
        variant: "classicIntro",
        columns: 2,
        gap: "standard",
        verticalAlign: "start",
        width: "standard",
        blocks: [
          {
            id: "portrait",
            type: "image",
            column: 1,
            url: "/notion-assets/abc.png",
            alt: "Portrait",
            shape: "portrait",
            fit: "contain",
          },
          {
            id: "copy",
            type: "markdown",
            column: 2,
            body: "# Hi",
            tone: "plain",
            textAlign: "left",
          },
        ],
      },
    ],
  });
  assert.equal(result.title, "Welcome");
  assert.equal(result.schemaVersion, 3);
  assert.equal(result.sections[0].type, "layout");
  assert.equal(result.sections[0].variant, "classicIntro");
  assert.equal(result.sections[0].blocks[0].fit, "contain");
});

test("normalizeHomeData: falls back to default title when blank or wrong type", () => {
  assert.equal(normalizeHomeData({ title: "   " }).title, "Hi there!");
  assert.equal(normalizeHomeData({ title: 123 }).title, "Hi there!");
});

test("normalizeHomeData: ignores legacy top-level body and image fields", () => {
  const result = normalizeHomeData({
    title: "T",
    body: "legacy body",
    profileImageUrl: "   ",
    profileImageAlt: "",
  });
  assert.equal(result.sections[0].type, "richText");
  assert.equal(result.sections[0].body, "");
  assert.ok(!("profileImageUrl" in result));
  assert.ok(!("profileImageAlt" in result));
});

test("normalizeHomeData: falls back to an empty section when sections are missing", () => {
  assert.deepEqual(normalizeHomeData({ title: "T", body: 42 }).sections, [
    {
      id: "home-empty",
      type: "richText",
      enabled: true,
      body: "",
      variant: "standard",
      tone: "plain",
      textAlign: "left",
      width: "standard",
    },
  ]);
});

test("normalizeHomeData: preserves normalized home sections", () => {
  const result = normalizeHomeData({
    title: "Legacy",
    sections: [
      {
        id: "intro",
        type: "hero",
        enabled: true,
        title: "Custom",
        body: "Custom body",
        imagePosition: "right",
        textAlign: "center",
        width: "wide",
      },
      {
        id: "quick-links",
        type: "linkList",
        enabled: false,
        layout: "inline",
        links: [{ label: "Works", href: "/works", description: "Selected work" }],
      },
    ],
  });
  assert.equal(result.title, "Legacy");
  assert.equal(result.sections.length, 2);
  assert.equal(result.sections[0].type, "hero");
  assert.equal(result.sections[0].imagePosition, "right");
  assert.equal(result.sections[0].textAlign, "center");
  assert.equal(result.sections[0].width, "wide");
  assert.equal(result.sections[1].type, "linkList");
  assert.equal(result.sections[1].enabled, false);
  assert.equal(result.sections[1].links[0].href, "/works");
});

test("normalizeHomeData: preserves generic layout sections", () => {
  const result = normalizeHomeData({
    title: "Home",
    body: "Intro",
    sections: [
      {
        id: "image-text",
        type: "layout",
        enabled: true,
        title: "About",
        variant: "classicIntro",
        columns: 2,
        gap: "loose",
        verticalAlign: "center",
        width: "wide",
        blocks: [
          {
            id: "portrait",
            type: "image",
            column: 1,
            url: "/uploads/2026/04/portrait.png",
            alt: "Portrait",
            caption: "Lab photo",
            shape: "portrait",
            fit: "cover",
          },
          {
            id: "copy",
            type: "markdown",
            column: 2,
            title: "Hi",
            body: "Markdown body",
            tone: "panel",
            textAlign: "left",
          },
        ],
      },
    ],
  });
  assert.equal(result.sections[0].type, "layout");
  assert.equal(result.sections[0].variant, "classicIntro");
  assert.equal(result.sections[0].columns, 2);
  assert.equal(result.sections[0].gap, "loose");
  assert.equal(result.sections[0].verticalAlign, "center");
  assert.equal(result.sections[0].blocks.length, 2);
  assert.equal(result.sections[0].blocks[0].type, "image");
  assert.equal(result.sections[0].blocks[0].url, "/uploads/2026/04/portrait.png");
  assert.equal(result.sections[0].blocks[1].type, "markdown");
  assert.equal(result.sections[0].blocks[1].tone, "panel");
});

// ----------------------------------------------------------------------------
// News
// ----------------------------------------------------------------------------

test("normalizeNewsData: empty template for non-object input", () => {
  const out = normalizeNewsData(null);
  assert.equal(out.title, "News");
  assert.deepEqual(out.entries, []);
});

test("normalizeNewsData: drops entries missing dateIso or body", () => {
  const out = normalizeNewsData({
    entries: [
      { dateIso: "2026-01-01", body: "valid" },
      { dateIso: "", body: "no date" },
      { dateIso: "2026-02-01", body: "   " },
      { dateIso: "2026-03-01" },
      { body: "orphan" },
      null,
      "not-an-object",
    ],
  });
  assert.equal(out.entries.length, 1);
  assert.equal(out.entries[0].dateIso, "2026-01-01");
  assert.equal(out.entries[0].body, "valid");
});

test("normalizeNewsData: sorts entries newest-first by dateIso", () => {
  const out = normalizeNewsData({
    entries: [
      { dateIso: "2025-05-01", body: "older" },
      { dateIso: "2026-01-10", body: "newer" },
      { dateIso: "2025-12-31", body: "mid" },
    ],
  });
  assert.deepEqual(
    out.entries.map((e) => e.dateIso),
    ["2026-01-10", "2025-12-31", "2025-05-01"],
  );
});

test("normalizeNewsData: trims body whitespace", () => {
  const out = normalizeNewsData({
    entries: [{ dateIso: "2026-01-01", body: "  trimmed  " }],
  });
  assert.equal(out.entries[0].body, "trimmed");
});

test("normalizeNewsData: preserves custom title + description", () => {
  const out = normalizeNewsData({
    title: "Updates",
    description: "Latest news",
    entries: [],
  });
  assert.equal(out.title, "Updates");
  assert.equal(out.description, "Latest news");
});

// ----------------------------------------------------------------------------
// Publications
// ----------------------------------------------------------------------------

test("normalizePublicationsData: empty template for non-object input", () => {
  const out = normalizePublicationsData(null);
  assert.equal(out.title, "Publications");
  assert.deepEqual(out.profileLinks, []);
  assert.deepEqual(out.entries, []);
});

test("normalizePublicationsData: drops profile links missing label or href", () => {
  const out = normalizePublicationsData({
    profileLinks: [
      { label: "Scholar", href: "https://scholar.google.com" },
      { label: "", href: "https://example.com" },
      { label: "No URL", href: "" },
      { label: "Scholar" },
      null,
      "bad",
    ],
  });
  assert.equal(out.profileLinks.length, 1);
  assert.equal(out.profileLinks[0].label, "Scholar");
});

test("normalizePublicationsData: keeps hostname when string, strips otherwise", () => {
  const out = normalizePublicationsData({
    profileLinks: [
      { label: "A", href: "https://a.com", hostname: "a.com" },
      { label: "B", href: "https://b.com", hostname: 42 },
    ],
  });
  assert.equal(out.profileLinks[0].hostname, "a.com");
  assert.equal(out.profileLinks[1].hostname, undefined);
});

test("normalizePublicationsData: drops entries without title", () => {
  const out = normalizePublicationsData({
    entries: [
      { title: "Good paper", year: "2025", url: "", labels: [] },
      { title: "", year: "2025", url: "", labels: [] },
      { year: "2025" },
      null,
    ],
  });
  assert.equal(out.entries.length, 1);
  assert.equal(out.entries[0].title, "Good paper");
});

test("normalizePublicationsData: filters non-string label/author items", () => {
  const out = normalizePublicationsData({
    entries: [
      {
        title: "Paper",
        year: "2025",
        url: "",
        labels: ["conference", 42, null, "journal"],
        authors: ["A. Author", 0, "B. Author"],
        externalUrls: ["https://example.com", null, 123],
      },
    ],
  });
  assert.deepEqual(out.entries[0].labels, ["conference", "journal"]);
  assert.deepEqual(out.entries[0].authors, ["A. Author", "B. Author"]);
  assert.deepEqual(out.entries[0].externalUrls, ["https://example.com"]);
});

test("normalizePublicationsData: coerces authorsRich into {name,isSelf} entries", () => {
  const out = normalizePublicationsData({
    entries: [
      {
        title: "Paper",
        year: "2025",
        url: "",
        labels: [],
        authorsRich: [
          { name: "Jinkun Chen", isSelf: true },
          { name: "Collaborator", isSelf: false },
          { name: "", isSelf: true },
          { isSelf: true },
          null,
        ],
      },
    ],
  });
  assert.deepEqual(out.entries[0].authorsRich, [
    { name: "Jinkun Chen", isSelf: true },
    { name: "Collaborator", isSelf: false },
  ]);
});

test("normalizePublicationsData: keeps optional string fields (doi/arxiv/venue)", () => {
  const out = normalizePublicationsData({
    entries: [
      {
        title: "Paper",
        year: "2025",
        url: "",
        labels: [],
        doiUrl: "https://doi.org/...",
        arxivUrl: "https://arxiv.org/abs/...",
        venue: "NeurIPS 2025",
      },
    ],
  });
  assert.equal(out.entries[0].doiUrl, "https://doi.org/...");
  assert.equal(out.entries[0].arxivUrl, "https://arxiv.org/abs/...");
  assert.equal(out.entries[0].venue, "NeurIPS 2025");
});

// ----------------------------------------------------------------------------
// Teaching
// ----------------------------------------------------------------------------

test("normalizeTeachingData: empty template for non-object input", () => {
  const out = normalizeTeachingData(null);
  assert.equal(out.title, "Teaching");
  assert.deepEqual(out.headerLinks, []);
  assert.deepEqual(out.entries, []);
  assert.deepEqual(out.footerLinks, []);
});

test("normalizeTeachingData: drops entries with neither term nor courseCode", () => {
  const out = normalizeTeachingData({
    entries: [
      {
        term: "2025/26 Fall",
        courseCode: "CSCI1234",
        courseName: "Intro",
        period: "Sep-Dec",
        role: "TA",
      },
      { term: "", courseCode: "", courseName: "no id" },
      null,
    ],
  });
  assert.equal(out.entries.length, 1);
  assert.equal(out.entries[0].courseCode, "CSCI1234");
});

test("normalizeTeachingData: keeps optional courseUrl + instructor only when non-empty", () => {
  const out = normalizeTeachingData({
    entries: [
      {
        term: "Fall",
        courseCode: "X",
        courseName: "Y",
        period: "",
        role: "",
        courseUrl: "/teaching/x",
        instructor: "Prof",
      },
      {
        term: "Fall",
        courseCode: "Z",
        courseName: "W",
        period: "",
        role: "",
        courseUrl: "   ",
        instructor: "",
      },
    ],
  });
  assert.equal(out.entries[0].courseUrl, "/teaching/x");
  assert.equal(out.entries[0].instructor, "Prof");
  assert.equal(out.entries[1].courseUrl, undefined);
  assert.equal(out.entries[1].instructor, undefined);
});

test("normalizeTeachingData: drops header/footer links missing label or href", () => {
  const out = normalizeTeachingData({
    headerLinks: [
      { label: "A", href: "/a" },
      { label: "", href: "/b" },
      { label: "C" },
    ],
    footerLinks: [
      { label: "D", href: "/d" },
      null,
      { label: "E", href: "" },
    ],
  });
  assert.equal(out.headerLinks.length, 1);
  assert.equal(out.headerLinks[0].label, "A");
  assert.equal(out.footerLinks.length, 1);
  assert.equal(out.footerLinks[0].label, "D");
});

test("normalizeTeachingData: keeps intro only when non-whitespace string", () => {
  assert.equal(normalizeTeachingData({ intro: "Hi." }).intro, "Hi.");
  assert.equal(normalizeTeachingData({ intro: "  " }).intro, undefined);
  assert.equal(normalizeTeachingData({ intro: 42 }).intro, undefined);
});

// ----------------------------------------------------------------------------
// Works
// ----------------------------------------------------------------------------

test("normalizeWorksData: empty template for non-object input", () => {
  const out = normalizeWorksData(null);
  assert.equal(out.title, "Works");
  assert.deepEqual(out.entries, []);
});

test("normalizeWorksData: drops entries without a role", () => {
  const out = normalizeWorksData({
    entries: [
      { category: "recent", role: "Research Assistant", period: "2025-" },
      { category: "passed", role: "   ", period: "2024" },
      { role: "" },
      null,
    ],
  });
  assert.equal(out.entries.length, 1);
  assert.equal(out.entries[0].role, "Research Assistant");
});

test("normalizeWorksData: coerces category to 'recent' or 'passed' (defaults to passed)", () => {
  const out = normalizeWorksData({
    entries: [
      { category: "Recent", role: "A", period: "" },
      { category: "passed", role: "B", period: "" },
      { category: "unknown", role: "C", period: "" },
      { role: "D", period: "" }, // missing category
    ],
  });
  assert.deepEqual(
    out.entries.map((e) => e.category),
    ["recent", "passed", "passed", "passed"],
  );
});

test("normalizeWorksData: keeps affiliation/location/description only when non-empty", () => {
  const out = normalizeWorksData({
    entries: [
      {
        category: "recent",
        role: "A",
        period: "",
        affiliation: "Dalhousie",
        affiliationUrl: "https://dal.ca",
        location: "Halifax",
        description: "Body text",
      },
      {
        category: "passed",
        role: "B",
        period: "",
        affiliation: "   ",
        affiliationUrl: "",
        location: "",
        description: "",
      },
    ],
  });
  assert.equal(out.entries[0].affiliation, "Dalhousie");
  assert.equal(out.entries[0].affiliationUrl, "https://dal.ca");
  assert.equal(out.entries[0].location, "Halifax");
  assert.equal(out.entries[0].description, "Body text");
  assert.equal(out.entries[1].affiliation, undefined);
  assert.equal(out.entries[1].affiliationUrl, undefined);
  assert.equal(out.entries[1].location, undefined);
  assert.equal(out.entries[1].description, undefined);
});

test("normalizeWorksData: keeps intro + note only when non-whitespace", () => {
  const out = normalizeWorksData({
    intro: "Hello",
    note: "   ",
  });
  assert.equal(out.intro, "Hello");
  assert.equal(out.note, undefined);
});
