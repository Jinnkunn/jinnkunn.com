import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import {
  BADGE_DEFAULTS,
  BUTTON_DEFAULTS,
  BUTTON_SURFACES,
  CONTAINER_DEFAULTS,
  CONTAINER_SURFACES,
  DESIGN_DENSITIES,
  DESIGN_SIZES,
  DESIGN_TONES,
  DESIGN_VARIANTS,
  FIELD_DEFAULTS,
  ICON_BUTTON_DEFAULTS,
  STATUS_NOTICE_DEFAULTS,
} from "../lib/design-system/primitives.ts";

const ROOT = process.cwd();

test("design-system-contract: shared dimensions remain stable", () => {
  assert.deepEqual([...DESIGN_VARIANTS], ["solid", "ghost", "subtle", "nav"]);
  assert.deepEqual([...DESIGN_TONES], ["neutral", "accent", "success", "danger", "warning", "info"]);
  assert.deepEqual([...DESIGN_SIZES], ["sm", "md"]);
  assert.deepEqual([...DESIGN_DENSITIES], ["compact", "default"]);
  assert.deepEqual([...BUTTON_SURFACES], ["default", "inverse"]);
  assert.deepEqual([...CONTAINER_SURFACES], ["default", "elevated", "soft"]);
});

test("design-system-contract: primitive defaults stay within the shared contract", () => {
  assert.ok(DESIGN_VARIANTS.includes(BUTTON_DEFAULTS.variant));
  assert.ok(DESIGN_TONES.includes(BUTTON_DEFAULTS.tone));
  assert.ok(DESIGN_SIZES.includes(BUTTON_DEFAULTS.size));
  assert.ok(DESIGN_DENSITIES.includes(BUTTON_DEFAULTS.density));
  assert.ok(BUTTON_SURFACES.includes(BUTTON_DEFAULTS.surface));

  assert.ok(DESIGN_VARIANTS.includes(ICON_BUTTON_DEFAULTS.variant));
  assert.ok(DESIGN_TONES.includes(ICON_BUTTON_DEFAULTS.tone));
  assert.ok(DESIGN_SIZES.includes(ICON_BUTTON_DEFAULTS.size));
  assert.ok(DESIGN_DENSITIES.includes(ICON_BUTTON_DEFAULTS.density));
  assert.ok(BUTTON_SURFACES.includes(ICON_BUTTON_DEFAULTS.surface));

  assert.ok(DESIGN_TONES.includes(BADGE_DEFAULTS.tone));
  assert.ok(DESIGN_SIZES.includes(BADGE_DEFAULTS.size));
  assert.ok(DESIGN_DENSITIES.includes(BADGE_DEFAULTS.density));

  assert.ok(DESIGN_SIZES.includes(FIELD_DEFAULTS.size));
  assert.ok(DESIGN_DENSITIES.includes(FIELD_DEFAULTS.density));

  assert.ok(CONTAINER_SURFACES.includes(CONTAINER_DEFAULTS.surface));

  assert.ok(DESIGN_TONES.includes(STATUS_NOTICE_DEFAULTS.tone));
  assert.ok(DESIGN_SIZES.includes(STATUS_NOTICE_DEFAULTS.size));
  assert.ok(DESIGN_DENSITIES.includes(STATUS_NOTICE_DEFAULTS.density));
});

test("design-system-contract: core primitives import the shared contract module", async () => {
  const files = [
    "components/ui/button.tsx",
    "components/ui/icon-button.tsx",
    "components/ui/badge.tsx",
    "components/ui/field.tsx",
    "components/ui/card.tsx",
    "components/ui/status-notice.tsx",
  ];

  for (const relFile of files) {
    const source = await fs.readFile(path.join(ROOT, relFile), "utf8");
    assert.match(
      source,
      /@\/lib\/design-system\/primitives/,
      `${relFile} should import shared primitive contract`,
    );
  }
});
