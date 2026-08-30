import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { getActiveMonochromeAppearance } from "../../lib/appearance.ts";
import {
  getActiveAnnouncement,
  normalizeAnnouncementsDocument,
  splitAnnouncementColumns,
} from "../../lib/shared/announcements.ts";

test("site announcements observe status and their configured date window", () => {
  const data = normalizeAnnouncementsDocument({
    version: 1,
    items: [
      {
        id: "notice",
        title: "Notice",
        status: "published",
        scope: "all-public",
        bodyMdx: "A public notice.",
        startsAt: "2026-08-29",
        endsAt: "2026-08-30",
      },
    ],
  });

  assert.equal(getActiveAnnouncement(data, new Date("2026-08-28T12:00:00-03:00")), null);
  assert.equal(
    getActiveAnnouncement(data, new Date("2026-08-29T12:00:00-03:00"))?.id,
    "notice",
  );
  assert.equal(getActiveAnnouncement(data, new Date("2026-08-31T00:01:00-03:00")), null);
});

test("announcement content supports flexible prose and explicit two-column separation", () => {
  assert.deepEqual(splitAnnouncementColumns("English\n\n---\n\n中文"), ["English", "中文"]);
  assert.deepEqual(splitAnnouncementColumns("English\n\n***\n\n中文"), ["English", "中文"]);
  assert.deepEqual(splitAnnouncementColumns("English\n\n___\n\n中文"), ["English", "中文"]);
  assert.deepEqual(splitAnnouncementColumns("English\n\n***\n\n中文\n\n---\n\nMore"), [
    "English",
    "中文\n\n---\n\nMore",
  ]);
  assert.deepEqual(splitAnnouncementColumns("English\n\n中文"), ["English\n\n中文"]);
});

test("the current announcement is content, not appearance configuration", async () => {
  const [rawAnnouncements, rawConfig] = await Promise.all([
    fs.readFile("content/filesystem/announcements.json", "utf8"),
    fs.readFile("content/filesystem/site-config.json", "utf8"),
  ]);
  const announcements = normalizeAnnouncementsDocument(JSON.parse(rawAnnouncements));
  const config = JSON.parse(rawConfig);
  const current = announcements.items[0];

  assert.equal(current.status, "published");
  assert.match(current.bodyMdx, /Shigatse · Gyirong/);
  assert.match(current.bodyMdx, /日喀则 · 吉隆/);
  assert.match(current.bodyMdx, /Latest Updates/);
  assert.match(current.bodyMdx, /最新消息/);
  assert.equal(config.appearance?.announcement, undefined);

  // Release snapshots may temporarily contain the previous D1 config shape.
  // Runtime migration reads only its display state; announcement prose always
  // comes from announcements.json and the next settings save removes it.
  const monochrome = config.appearance?.monochrome ?? config.memorial;
  assert.equal(monochrome.enabled, true);
  assert.equal(monochrome.scope, "all-public");
});

test("monochrome appearance has its own independent schedule", () => {
  const appearance = {
    enabled: true,
    scope: "all-public",
    desaturateMedia: true,
    startsAt: "2026-08-29",
    endsAt: "2026-08-30",
  };
  assert.equal(
    getActiveMonochromeAppearance(appearance, new Date("2026-08-28T12:00:00-03:00")),
    null,
  );
  assert.equal(
    getActiveMonochromeAppearance(appearance, new Date("2026-08-29T12:00:00-03:00"))
      ?.desaturateMedia,
    true,
  );
});

test("classic layout renders announcements and monochrome appearance independently", async () => {
  const [layout, announcement, frame, announcementCss, monochromeCss, settingsForm] = await Promise.all([
    fs.readFile("app/(classic)/layout.tsx", "utf8"),
    fs.readFile("components/site-announcement.tsx", "utf8"),
    fs.readFile("components/site-announcement-frame.tsx", "utf8"),
    fs.readFile("app/(classic)/announcement.css", "utf8"),
    fs.readFile("app/(classic)/monochrome.css", "utf8"),
    fs.readFile("components/site-admin/config/settings-form.tsx", "utf8"),
  ]);

  assert.match(layout, /data-announcement-active/);
  assert.match(layout, /data-monochrome-mode/);
  assert.match(layout, /<SiteAnnouncement announcement=\{announcement\}/);
  assert.match(announcement, /renderSimpleMarkdown/);
  assert.doesNotMatch(announcement, /compilePostMdx/);
  assert.match(frame, /Collapse announcement/);
  assert.match(frame, /Expand announcement/);
  assert.match(frame, /site-announcement__panel-shell--compact/);
  assert.match(frame, /site-announcement__panel-shell--expanded/);
  assert.match(announcementCss, /site-announcement__layout/);
  assert.match(
    announcementCss,
    /\.site-announcement__mdx--compact\s*\{[^}]*display:\s*grid/s,
  );
  assert.match(
    announcementCss,
    /\.site-announcement__mdx\.site-announcement__mdx--compact p\s*\{[^}]*margin:\s*0/s,
  );
  assert.match(announcementCss, /grid-template-rows 420ms/);
  assert.match(announcementCss, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(
    announcementCss,
    /\.site-announcement--expanded\s*\{[^}]*margin-top/s,
  );
  assert.match(monochromeCss, /data-monochrome-mode="true"/);
  assert.match(settingsForm, /Monochrome appearance/);
  assert.doesNotMatch(settingsForm, /Memorial mode/);
});

test("monochrome appearance uses neutral surfaces and remaps semantic content hues", async () => {
  const [designSystem, monochromeCss] = await Promise.all([
    fs.readFile("app/design-system.css", "utf8"),
    fs.readFile("app/(classic)/monochrome.css", "utf8"),
  ]);

  for (const token of [
    "--ds-monochrome-surface-page: #f4f4f4",
    "--ds-monochrome-surface-elevated: #fafafa",
    "--ds-monochrome-announcement-surface: #e7e7e7",
    "--ds-monochrome-surface-page: #181818",
    "--ds-monochrome-surface-elevated: #232323",
    "--ds-monochrome-announcement-surface: #242424",
  ]) {
    assert.match(designSystem, new RegExp(token));
  }

  for (const tone of [
    "gray",
    "brown",
    "orange",
    "yellow",
    "green",
    "blue",
    "purple",
    "pink",
    "red",
  ]) {
    assert.match(
      monochromeCss,
      new RegExp(`--color-text-${tone}: var\\(--ds-monochrome-text-muted\\)`),
    );
    assert.match(
      monochromeCss,
      new RegExp(`--color-bg-${tone}: var\\(--ds-monochrome-surface-soft-strong\\)`),
    );
  }

  for (const state of ["success", "danger", "warning", "info"]) {
    assert.match(
      monochromeCss,
      new RegExp(`--ds-${state}-text: var\\(--ds-monochrome-text-secondary\\)`),
    );
  }

  assert.match(
    monochromeCss,
    /--ds-announcement-surface:\s*var\(--ds-monochrome-announcement-surface\)/,
  );
  for (const bridgeToken of [
    "--ds-interactive-hover: var(--ds-monochrome-surface-soft)",
    "--ds-interactive-active: var(--ds-monochrome-surface-soft-strong)",
    "--color-text-default: var(--ds-monochrome-text-primary)",
    "--color-text-default-light: var(--ds-monochrome-text-faint)",
    "--color-border-default: var(--ds-monochrome-border-subtle)",
    "--navbar-text-color: var(--ds-monochrome-text-primary)",
    "--footer-text-color: var(--ds-monochrome-text-primary)",
  ]) {
    assert.match(monochromeCss, new RegExp(bridgeToken.replace(/[()]/g, "\\$&")));
  }
  assert.match(
    monochromeCss,
    /span\[data-link-style="icon"\]\s*>\s*a\.notion-link\.link::before/,
  );
  assert.match(monochromeCss, /filter:\s*grayscale\(1\) saturate\(0\)/);
  assert.doesNotMatch(monochromeCss, /:is\(a, button, img, video, svg, canvas/);
});
