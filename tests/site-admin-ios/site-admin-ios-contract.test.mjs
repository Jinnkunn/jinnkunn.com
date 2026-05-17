import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function read(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("site-admin-ios: environments are Draft/Live with per-environment auth", async () => {
  const appSession = await read("apps/site-admin-ios/SiteAdminCompanion/AppShell/AppSession.swift");
  const rootTab = await read("apps/site-admin-ios/SiteAdminCompanion/AppShell/RootTabView.swift");

  assert.match(appSession, /return "Draft"/);
  assert.match(appSession, /return "Live"/);
  assert.match(appSession, /account: "site-admin-token-\\\(environment\.rawValue\)"/);
  assert.match(appSession, /func isSignedIn\(to environment: SiteAdminEnvironment\)/);
  assert.match(appSession, /func clearAllAuth\(\)/);
  const selectEnvironmentBody =
    /func selectEnvironment\(_ next: SiteAdminEnvironment\) \{(?<body>[\s\S]*?)\n    \}/.exec(
      appSession,
    )?.groups?.body ?? "";
  assert.doesNotMatch(
    selectEnvironmentBody,
    /clearAuth\(\)/,
    "switching Draft/Live should load the saved token, not sign out",
  );
  assert.match(rootTab, /Use Draft for editing and Live for the published site/);
});

test("site-admin-ios: Live mode is read-only for content edits", async () => {
  const appSession = await read("apps/site-admin-ios/SiteAdminCompanion/AppShell/AppSession.swift");
  const contentView = await read("apps/site-admin-ios/SiteAdminCompanion/Features/Content/ContentView.swift");
  const todayView = await read("apps/site-admin-ios/SiteAdminCompanion/Features/Today/TodayView.swift");

  assert.match(appSession, /var canEditContent: Bool/);
  assert.match(appSession, /Switch to Draft to edit site content/);
  assert.match(contentView, /Live is read-only/);
  assert.match(contentView, /\.disabled\(!session\.environment\.canEditContent\)/);
  assert.match(todayView, /Switch to Draft to update this status/);
});
