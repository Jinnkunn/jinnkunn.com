import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

async function read(relPath) {
  return await fs.readFile(path.join(ROOT, relPath), "utf8");
}

test("tauri-ui-engineering: Home builder is split into maintainable panels", async () => {
  const homePanel = await read("apps/workspace/src/surfaces/site-admin/HomePanel.tsx");
  const panels = await read(
    "apps/workspace/src/surfaces/site-admin/home-builder/HomeBuilderPanels.tsx",
  );
  const previewHook = await read(
    "apps/workspace/src/surfaces/site-admin/home-builder/useHomePreview.ts",
  );

  for (const symbol of [
    "HomeSectionRail",
    "HomePreviewPane",
    "HomeInspectorShell",
    "useHomePreview",
    "usePersistentUiState",
  ]) {
    assert.match(homePanel, new RegExp(symbol), `HomePanel should use ${symbol}`);
  }

  assert.match(panels, /export function HomeSectionRail/);
  assert.match(panels, /export function HomePreviewPane/);
  assert.match(panels, /export function HomeInspectorShell/);
  assert.match(previewHook, /api\/site-admin\/preview\/home/);
});

test("tauri-ui-engineering: Post and Page editors share MDX controller primitives", async () => {
  const controller = await read(
    "apps/workspace/src/surfaces/site-admin/use-mdx-editor-controller.ts",
  );
  assert.match(controller, /useMdxImageUploadDrop/);
  assert.match(controller, /useUnsavedChangesBeforeUnload/);
  assert.match(controller, /useConfirmingBack/);

  for (const relPath of [
    "apps/workspace/src/surfaces/site-admin/PostEditor.tsx",
    "apps/workspace/src/surfaces/site-admin/PageEditor.tsx",
  ]) {
    const source = await read(relPath);
    assert.match(source, /useMdxImageUploadDrop/, `${relPath} should share upload/drop`);
    assert.match(
      source,
      /useUnsavedChangesBeforeUnload/,
      `${relPath} should share beforeunload guard`,
    );
    assert.match(source, /useConfirmingBack/, `${relPath} should share exit guard`);
    assert.match(source, /usePersistentUiState/, `${relPath} should persist preview mode`);
    assert.doesNotMatch(source, /uploadImageFile/, `${relPath} should not own upload flow`);
    assert.doesNotMatch(
      source,
      /insertMarkdownImage/,
      `${relPath} should not own insertion flow`,
    );
  }
});

test("tauri-ui-engineering: workspace primitives exist for future UI migration", async () => {
  const source = await read("apps/workspace/src/surfaces/site-admin/ui.tsx");
  for (const symbol of [
    "Button",
    "IconButton",
    "Field",
    "TextareaField",
    "Panel",
    "Toolbar",
    "StatusNotice",
  ]) {
    assert.match(source, new RegExp(`export function ${symbol}`));
  }
});

test("tauri-ui-engineering: static Notion toggles do not expose fake buttons", async () => {
  for (const relPath of [
    "components/works/works-view.tsx",
    "components/publications/publication-list.tsx",
  ]) {
    const source = await read(relPath);
    assert.doesNotMatch(source, /role="button"/);
    assert.doesNotMatch(source, /tabIndex=\{0\}/);
    assert.doesNotMatch(source, /aria-expanded="false"/);
  }
});

test("tauri-ui-engineering: root package exposes workspace UI smoke", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.scripts["check:workspace-ui"], "node scripts/workspace-ui-smoke.mjs");
});
