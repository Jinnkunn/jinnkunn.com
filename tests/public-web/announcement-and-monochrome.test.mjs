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
  const [layout, frame, announcementCss, monochromeCss, settingsForm] = await Promise.all([
    fs.readFile("app/(classic)/layout.tsx", "utf8"),
    fs.readFile("components/site-announcement-frame.tsx", "utf8"),
    fs.readFile("app/(classic)/announcement.css", "utf8"),
    fs.readFile("app/(classic)/monochrome.css", "utf8"),
    fs.readFile("components/site-admin/config/settings-form.tsx", "utf8"),
  ]);

  assert.match(layout, /data-announcement-active/);
  assert.match(layout, /data-monochrome-mode/);
  assert.match(layout, /<SiteAnnouncement announcement=\{announcement\}/);
  assert.match(frame, /Collapse announcement/);
  assert.match(frame, /Expand announcement/);
  assert.match(frame, /site-announcement__panel-shell--compact/);
  assert.match(frame, /site-announcement__panel-shell--expanded/);
  assert.match(announcementCss, /site-announcement__layout/);
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
