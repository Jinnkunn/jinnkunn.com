import assert from "node:assert/strict";
import test from "node:test";

import {
  countDirtyNavRows,
  deriveEditorStatus,
  hasNavRowDraftChanges,
  hasRouteAccessDraftChanges,
  hasRouteOverrideDraftChanges,
  hasSiteSettingsChanges,
  mapEditorErrorToResult,
} from "../lib/site-admin/editor-state.ts";

test("site-admin-editor-state: conflict and error results override dirty state", () => {
  const conflict = deriveEditorStatus({
    hasUnsavedChanges: true,
    result: {
      kind: "conflict",
      message: "Reload latest before saving again.",
    },
    dirtyMessage: "Unsaved changes",
  });
  assert.deepEqual(conflict, {
    kind: "conflict",
    message: "Reload latest before saving again.",
  });

  const saving = deriveEditorStatus({
    hasUnsavedChanges: true,
    result: {
      kind: "saving",
      message: "Saving...",
    },
    dirtyMessage: "Unsaved changes",
  });
  assert.deepEqual(saving, {
    kind: "saving",
    message: "Saving...",
  });
});

test("site-admin-editor-state: dirty and saved states derive correctly", () => {
  const dirty = deriveEditorStatus({
    hasUnsavedChanges: true,
    result: {
      kind: "saved",
      message: "Saved to main.",
    },
    dirtyMessage: "Unsaved route changes",
  });
  assert.deepEqual(dirty, {
    kind: "dirty",
    message: "Unsaved route changes",
  });

  const saved = deriveEditorStatus({
    hasUnsavedChanges: false,
    result: {
      kind: "saved",
      message: "Saved to main.",
    },
    dirtyMessage: "Unsaved route changes",
  });
  assert.deepEqual(saved, {
    kind: "saved",
    message: "Saved to main.",
  });
});

test("site-admin-editor-state: SOURCE_CONFLICT maps to conflict result", () => {
  assert.deepEqual(
    mapEditorErrorToResult({
      code: "SOURCE_CONFLICT",
      message: "Request failed",
      conflictMessage: "Reload latest before saving again.",
    }),
    {
      kind: "conflict",
      message: "Reload latest before saving again.",
    },
  );

  assert.deepEqual(
    mapEditorErrorToResult({
      code: "REQUEST_FAILED",
      message: "Network request failed",
      conflictMessage: "ignored",
    }),
    {
      kind: "error",
      message: "Network request failed",
    },
  );
});

test("site-admin-editor-state: site settings dirty detection compares persisted fields", () => {
  const baseline = {
    rowId: "settings-row",
    siteName: "Example",
    lang: "en",
    seoTitle: "Example",
    seoDescription: "Example site",
    favicon: "/favicon.ico",
    ogImage: "/og.png",
    seoPageOverrides: "",
    googleAnalyticsId: "",
    contentGithubUsers: "jinnkunn",
    sitemapExcludes: "",
    sitemapAutoExcludeEnabled: true,
    sitemapAutoExcludeSections: "",
    sitemapAutoExcludeDepthPages: "5",
    sitemapAutoExcludeDepthBlog: "5",
    sitemapAutoExcludeDepthPublications: "5",
    sitemapAutoExcludeDepthTeaching: "5",
    rootPageId: "",
    homePageId: "",
  };

  assert.equal(hasSiteSettingsChanges(baseline, { ...baseline }), false);
  assert.equal(
    hasSiteSettingsChanges(baseline, {
      ...baseline,
      seoDescription: "Updated description",
    }),
    true,
  );
});

test("site-admin-editor-state: nav draft helpers ignore unchanged partial rows", () => {
  const row = {
    rowId: "nav-1",
    label: "Home",
    href: "/",
    group: "top",
    order: 0,
    enabled: true,
  };

  assert.equal(hasNavRowDraftChanges(row, undefined), false);
  assert.equal(hasNavRowDraftChanges(row, { label: "Home" }), false);
  assert.equal(hasNavRowDraftChanges(row, { label: "Start" }), true);

  assert.equal(
    countDirtyNavRows([row], {
      [row.rowId]: { href: "/" },
    }),
    0,
  );
  assert.equal(
    countDirtyNavRows([row], {
      [row.rowId]: { href: "/index" },
    }),
    1,
  );
});

test("site-admin-editor-state: route dirty helpers normalize overrides and protect inherited access", () => {
  assert.equal(hasRouteOverrideDraftChanges("/blog", "/blog/"), false);
  assert.equal(hasRouteOverrideDraftChanges("/blog", "/notes"), true);

  assert.equal(
    hasRouteAccessDraftChanges({
      inheritedProtected: true,
      baselineAccess: "password",
      selectedAccess: "github",
      passwordDraft: "secret",
    }),
    false,
  );
  assert.equal(
    hasRouteAccessDraftChanges({
      inheritedProtected: false,
      baselineAccess: "public",
      selectedAccess: "github",
      passwordDraft: "",
    }),
    true,
  );
  assert.equal(
    hasRouteAccessDraftChanges({
      inheritedProtected: false,
      baselineAccess: "password",
      selectedAccess: "password",
      passwordDraft: "next-secret",
    }),
    true,
  );
});
