import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  DESIGN_THEMES,
  designThemeMeta,
  designThemeTokens,
  designViewportThemeColors,
  legacyBridgeVarNames,
} from "../lib/design-system/tokens.ts";

const ROOT = process.cwd();
const DESIGN_SYSTEM_CSS = fs.readFileSync(
  path.join(ROOT, "app/design-system.css"),
  "utf8",
);
const CLASSIC_BRIDGE_CSS = fs.readFileSync(
  path.join(ROOT, "app/(classic)/design-system-bridge.css"),
  "utf8",
);
function readWorkspaceCssBundle() {
  const stylesRoot = path.join(ROOT, "apps/workspace/src/styles");
  const parts = [
    fs.readFileSync(path.join(ROOT, "apps/workspace/src/index.css"), "utf8"),
  ];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && entry.name.endsWith(".css")) {
        parts.push(fs.readFileSync(abs, "utf8"));
      }
    }
  };
  walk(stylesRoot);
  return parts.join("\n");
}

const WORKSPACE_CSS = readWorkspaceCssBundle();

test("design-system-tokens: each theme exposes foundation, semantic, and component sections", () => {
  assert.deepEqual([...DESIGN_THEMES], ["light", "dark"]);

  for (const theme of DESIGN_THEMES) {
    const sections = Object.keys(designThemeTokens[theme]).sort();
    assert.deepEqual(sections, ["component", "foundation", "semantic"]);
    assert.ok(Object.keys(designThemeTokens[theme].foundation).length > 0);
    assert.ok(Object.keys(designThemeTokens[theme].semantic).length > 0);
    assert.ok(Object.keys(designThemeTokens[theme].component).length > 0);
  }
});

test("design-system-tokens: legacy bridge variables are emitted in both bridge stylesheets", () => {
  for (const variableName of legacyBridgeVarNames) {
    assert.ok(
      DESIGN_SYSTEM_CSS.includes(`${variableName}:`),
      `missing ${variableName} in app/design-system.css`,
    );
    assert.ok(
      CLASSIC_BRIDGE_CSS.includes(`${variableName}:`),
      `missing ${variableName} in app/(classic)/design-system-bridge.css`,
    );
  }
});

test("design-system-tokens: theme metadata stays aligned with surface-page tokens", () => {
  assert.equal(
    designThemeMeta.light.themeColor,
    designThemeTokens.light.semantic.surfacePage,
  );
  assert.equal(
    designThemeMeta.dark.themeColor,
    designThemeTokens.dark.semantic.surfacePage,
  );
  assert.deepEqual(
    designViewportThemeColors,
    [
      {
        media: "(prefers-color-scheme: light)",
        color: designThemeMeta.light.themeColor,
      },
      {
        media: "(prefers-color-scheme: dark)",
        color: designThemeMeta.dark.themeColor,
      },
    ],
  );
});

test("design-system-tokens: Tauri workspace exposes shared semantic aliases", () => {
  const requiredAliases = [
    "--ds-surface-page: var(--color-bg-window)",
    "--ds-surface-panel: var(--color-bg-surface)",
    "--ds-text-primary: var(--color-text-primary)",
    "--ds-text-muted: var(--color-text-muted)",
    "--ds-border-subtle: var(--color-border-subtle)",
    "--ds-accent: var(--color-accent)",
  ];

  for (const alias of requiredAliases) {
    assert.ok(WORKSPACE_CSS.includes(alias), `missing workspace alias ${alias}`);
  }
});
