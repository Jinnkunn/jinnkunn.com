import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("site-admin web UI keeps the visual editor and mobile content navigation complete", async () => {
  const [visualEditor, consoleSource, styles] = await Promise.all([
    read("app/site-admin/site-admin-visual-editor.tsx"),
    read("app/site-admin/site-admin-web-console.tsx"),
    read("app/site-admin/site-admin-dashboard.module.css"),
  ]);

  assert.match(visualEditor, /@milkdown\/crepe\/theme\/common\/style\.css/);
  assert.match(consoleSource, /className=\{styles\.mobileContentPicker\}/);
  assert.match(consoleSource, /id="site-admin-editor-panel"/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.sidePanel \{[\s\S]*?position: static/);
  assert.match(styles, /\.sidePanel \.contentNavSection \{\s*display: none/);
});

test("site-admin web UI exposes explicit draft and navigation controls", async () => {
  const [settingsPanel, settingsForm, collectionEditor, announcementsPanel] = await Promise.all([
    read("app/site-admin/site-admin-settings-panel.tsx"),
    read("components/site-admin/config/settings-form.tsx"),
    read("app/site-admin/site-admin-structured-collection-editor.tsx"),
    read("app/site-admin/site-admin-announcements-panel.tsx"),
  ]);

  assert.match(settingsPanel, /Move .* up/);
  assert.match(settingsPanel, /Move .* down/);
  assert.doesNotMatch(settingsPanel, />\s*Save row\s*</);
  assert.match(settingsForm, /Changes are ready to save/);
  assert.match(settingsForm, /Search preview/);
  assert.match(settingsPanel, /Appearance/);
  assert.match(settingsForm, /Monochrome appearance/);
  assert.match(announcementsPanel, /SiteAdminMarkdownEditor/);
  assert.match(announcementsPanel, /Single flexible flow/);
  assert.match(announcementsPanel, /Two columns/);
  assert.match(collectionEditor, /Changes remain in this draft until you use Save/);
  assert.match(collectionEditor, /aria-hidden="true"/);
});
