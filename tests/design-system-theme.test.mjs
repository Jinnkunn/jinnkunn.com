import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  DESIGN_THEME_STORAGE_KEY,
  getDesignThemeInitScript,
  normalizeDesignTheme,
  readRequestedDesignTheme,
  resolveDesignTheme,
} from "../lib/design-system/theme.ts";

test("design-system-theme: normalizeDesignTheme accepts only light and dark", () => {
  assert.equal(normalizeDesignTheme("light"), "light");
  assert.equal(normalizeDesignTheme(" DARK "), "dark");
  assert.equal(normalizeDesignTheme("system"), null);
  assert.equal(normalizeDesignTheme(""), null);
});

test("design-system-theme: resolveDesignTheme prefers requested, then stored, then system", () => {
  assert.equal(
    resolveDesignTheme({ requested: "dark", stored: "light", system: "light" }),
    "dark",
  );
  assert.equal(
    resolveDesignTheme({ requested: null, stored: "dark", system: "light" }),
    "dark",
  );
  assert.equal(
    resolveDesignTheme({ requested: null, stored: null, system: "dark" }),
    "dark",
  );
  assert.equal(
    resolveDesignTheme({ requested: null, stored: null, system: null }),
    "light",
  );
});

test("design-system-theme: readRequestedDesignTheme parses query params safely", () => {
  assert.equal(readRequestedDesignTheme("?theme=dark"), "dark");
  assert.equal(readRequestedDesignTheme("?q=test&theme=light"), "light");
  assert.equal(readRequestedDesignTheme("?theme=sepia"), null);
});

test("design-system-theme: init script applies data-theme and storage key contract", () => {
  const script = getDesignThemeInitScript();
  assert.match(script, /data-theme/);
  assert.match(script, /theme-light/);
  assert.match(script, /theme-dark/);
  assert.match(script, new RegExp(DESIGN_THEME_STORAGE_KEY));
});

test("design-system-theme: global error shell bootstraps the shared theme init script", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "app/global-error.tsx"),
    "utf8",
  );
  assert.match(source, /getDesignThemeInitScript/);
  assert.match(source, /design-theme-init-error/);
});
