import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function read(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("site-admin-ios: Draft is the visible workspace and Live is a release target", async () => {
  const appSession = await read("apps/site-admin-ios/SiteAdminCompanion/AppShell/AppSession.swift");
  const rootTab = await read("apps/site-admin-ios/SiteAdminCompanion/AppShell/RootTabView.swift");
  const settingsView = await read("apps/site-admin-ios/SiteAdminCompanion/Features/Settings/SettingsView.swift");
  const releaseView = await read("apps/site-admin-ios/SiteAdminCompanion/Features/Release/ReleaseView.swift");

  assert.match(appSession, /return "Draft"/);
  assert.match(appSession, /return "Live"/);
  assert.match(appSession, /environment = \.staging/);
  assert.match(appSession, /baseURLString = SiteAdminEnvironment\.staging\.baseURLString/);
  assert.match(appSession, /account: "site-admin-token-\\\(environment\.rawValue\)"/);
  assert.match(appSession, /func clearAllAuth\(\)/);

  assert.doesNotMatch(rootTab, /Picker\(/);
  assert.match(rootTab, /Draft Workspace/);
  assert.match(rootTab, /Live is updated from the Release tab/);

  assert.doesNotMatch(settingsView, /SiteAdminEnvironmentPicker/);
  assert.match(settingsView, /Editing source", value: "Draft"/);
  assert.match(settingsView, /Published site", value: "Live"/);
  assert.match(settingsView, /Direct Live editing is intentionally hidden/);

  assert.match(releaseView, /Publish Draft to Live/);
  assert.match(releaseView, /The app always edits Draft/);
});

test("site-admin-ios: content editing does not expose a Live mode switch", async () => {
  const appSession = await read("apps/site-admin-ios/SiteAdminCompanion/AppShell/AppSession.swift");
  const contentView = await read("apps/site-admin-ios/SiteAdminCompanion/Features/Content/ContentView.swift");
  const todayView = await read("apps/site-admin-ios/SiteAdminCompanion/Features/Today/TodayView.swift");

  assert.match(appSession, /var canEditContent: Bool/);
  assert.match(appSession, /guard environment\.canEditContent/);
  assert.doesNotMatch(contentView, /Live is read-only/);
  assert.doesNotMatch(contentView, /SiteAdminEnvironmentPicker/);
  assert.doesNotMatch(todayView, /Live is read-only/);
  assert.doesNotMatch(todayView, /Switch to Draft/);
  assert.match(todayView, /Publish Draft to Live/);
});
