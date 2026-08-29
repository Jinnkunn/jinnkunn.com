import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import { getActiveMemorial } from "../../lib/memorial.ts";

const active = {
  enabled: true,
  scope: "all-public",
  eyebrow: "In remembrance",
  title: "For those affected by the Gyirong mudslide",
  context: "August 26, 2026 · Gyirong County, Shigatse, Tibet",
  englishTitle: "In memory of those who lost their lives in the Gyirong mudslide.",
  message: "Rescue work is ongoing.",
  chineseTitle: "谨悼日喀则吉隆泥石流灾害遇难者",
  chineseMessage: "相关信息请以官方通报为准。",
  sourceLabel: "Latest Updates",
  sourceUrl: "https://www.xizang.gov.cn/example",
  sourceChineseLabel: "最新消息",
  sourceChineseUrl: "https://www.xizang.gov.cn/example-zh",
  startsAt: "2026-08-29",
  endsAt: "",
};

test("memorial mode observes its configured date window", () => {
  assert.equal(getActiveMemorial(active, new Date("2026-08-28T12:00:00-03:00")), null);
  assert.equal(
    getActiveMemorial(active, new Date("2026-08-29T12:00:00-03:00"))?.scope,
    "all-public",
  );
  assert.equal(
    getActiveMemorial({ ...active, endsAt: "2026-08-30" }, new Date("2026-08-31T00:01:00-03:00")),
    null,
  );
});

test("active site memorial identifies the event without freezing casualty figures", async () => {
  const config = JSON.parse(await fs.readFile("content/filesystem/site-config.json", "utf8"));
  assert.equal(config.memorial.enabled, true);
  assert.equal(config.memorial.eyebrow, "");
  assert.equal(config.memorial.title, "日喀则 · 吉隆");
  assert.equal(config.memorial.context, "Shigatse · Gyirong");
  assert.match(config.memorial.englishTitle, /In memory of those who lost their lives/i);
  assert.match(config.memorial.message, /mudslide struck the Gyirong Port area/i);
  assert.match(config.memorial.message, /Rescue efforts are ongoing/i);
  assert.match(config.memorial.chineseTitle, /日喀则吉隆泥石流/);
  assert.match(config.memorial.chineseMessage, /2026年8月26日/);
  assert.match(config.memorial.sourceUrl, /^https:\/\/so\.news\.cn\/\?lang=en/);
  assert.match(config.memorial.sourceChineseUrl, /^https:\/\/so\.news\.cn\/#search/);
  assert.doesNotMatch(
    `${config.memorial.message} ${config.memorial.chineseMessage}`,
    /\b558\b|3\s*人遇难|2\s*人/,
  );
});

test("classic public layout scopes memorial mode away from Site Admin", async () => {
  const [layout, home, notice, css] = await Promise.all([
    fs.readFile("app/(classic)/layout.tsx", "utf8"),
    fs.readFile("components/home/home-view.tsx", "utf8"),
    fs.readFile("components/memorial-notice.tsx", "utf8"),
    fs.readFile("app/(classic)/memorial.css", "utf8"),
  ]);
  assert.match(layout, /data-memorial-mode/);
  assert.match(home, /variant="home"/);
  assert.match(notice, /memorial\.context/);
  assert.match(notice, /memorial-notice__compact-context/);
  assert.match(notice, /memorial-notice__inner--compact/);
  assert.match(notice, /memorial-notice__inner--home/);
  assert.match(notice, /memorial\.context \|\| memorial\.title/);
  assert.match(notice, /memorial\.englishTitle/);
  assert.match(notice, /memorial-notice__secondary-location/);
  assert.match(notice, /memorial-notice__column-source/);
  assert.match(css, /grayscale\(1\)/);
  assert.match(css, /--navbar-background-color: var\(--ds-memorial-surface-page\)/);
  assert.match(css, /:is\(img, video, svg, canvas, \.notion-icon\)/);
  assert.match(css, /--ds-memorial-banner-surface/);
  assert.match(css, /max-width: 1120px/);
  assert.match(css, /\.notion-header__cover\.no-cover/);
  assert.match(css, /body:has\(\.super-root\[data-memorial-mode="true"\]\)/);
  assert.match(css, /footer\.super-footer/);
  assert.match(await fs.readFile("app/design-system.css", "utf8"), /html\[data-theme="dark"\][\s\S]*--ds-memorial-surface-page/);
  assert.doesNotMatch(await fs.readFile("app/layout.tsx", "utf8"), /data-memorial-mode/);
});
