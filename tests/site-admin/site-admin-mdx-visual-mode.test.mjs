import test from "node:test";
import assert from "node:assert/strict";

import { isVisualModeAvailable } from "../../lib/site-admin/mdx-visual-mode.ts";

test("Write mode remains available for Markdown emitted by the active visual editor", () => {
  assert.equal(
    isVisualModeAvailable({
      visualEditing: true,
      compatible: false,
      mode: "visual",
      value: "transient visual output",
      lastVisualValue: "transient visual output",
    }),
    true,
  );
});

test("unsupported MDX loaded from outside still falls back to Source mode", () => {
  assert.equal(
    isVisualModeAvailable({
      visualEditing: true,
      compatible: false,
      mode: "visual",
      value: "<Columns>external source</Columns>",
      lastVisualValue: null,
    }),
    false,
  );
  assert.equal(
    isVisualModeAvailable({
      visualEditing: true,
      compatible: false,
      mode: "source",
      value: "transient visual output",
      lastVisualValue: "transient visual output",
    }),
    false,
  );
});
