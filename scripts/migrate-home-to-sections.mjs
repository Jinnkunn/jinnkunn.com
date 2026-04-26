#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const file = resolve(process.cwd(), "content/home.json");
const raw = JSON.parse(readFileSync(file, "utf8"));

if (raw && raw.schemaVersion >= 3 && Array.isArray(raw.sections)) {
  console.log("[home-migrate] content/home.json is already schema v3.");
  process.exit(0);
}

function splitIntroAndRest(body, introParagraphCount = 1) {
  const trimmed = String(body || "").trim();
  if (!trimmed) return { intro: "", rest: "" };
  const paragraphs = trimmed.split(/\n\s*\n/).map((it) => it.trim()).filter(Boolean);
  if (paragraphs.length <= introParagraphCount) {
    return { intro: paragraphs.join(" "), rest: "" };
  }
  return {
    intro: paragraphs.slice(0, introParagraphCount).join(" "),
    rest: paragraphs.slice(introParagraphCount).join("\n\n"),
  };
}

const title = typeof raw.title === "string" && raw.title.trim()
  ? raw.title.trim()
  : "Hi there!";
const { intro, rest } = splitIntroAndRest(raw.body, 2);
const sections = [];

sections.push({
  id: "classic-intro",
  type: "layout",
  enabled: true,
  variant: "classicIntro",
  columns: 2,
  gap: "standard",
  verticalAlign: "start",
  width: "standard",
  blocks: [
    {
      id: "classic-intro-image",
      type: "image",
      column: 1,
      url: typeof raw.profileImageUrl === "string" ? raw.profileImageUrl : "",
      alt: typeof raw.profileImageAlt === "string" ? raw.profileImageAlt : "",
      shape: "portrait",
      fit: "contain",
    },
    {
      id: "classic-intro-copy",
      type: "markdown",
      column: 2,
      body: intro,
      tone: "plain",
      textAlign: "left",
    },
  ].filter((block) => block.type !== "image" || block.url),
});

if (rest) {
  sections.push({
    id: "classic-body",
    type: "richText",
    enabled: true,
    variant: "classicBody",
    body: rest,
    tone: "plain",
    textAlign: "left",
    width: "standard",
  });
}

writeFileSync(
  file,
  `${JSON.stringify({ schemaVersion: 3, title, sections }, null, 2)}\n`,
);
console.log("[home-migrate] migrated content/home.json to schema v3.");
