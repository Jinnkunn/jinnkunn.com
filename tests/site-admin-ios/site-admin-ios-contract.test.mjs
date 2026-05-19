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
  const nowSheet = await read("apps/site-admin-ios/SiteAdminCompanion/Features/Today/NowQuickUpdateSheet.swift");
  const client = await read("apps/site-admin-ios/SiteAdminCompanion/Services/SiteAdminClient.swift");
  const models = await read("apps/site-admin-ios/SiteAdminCompanion/Models/SiteAdminModels.swift");

  assert.match(appSession, /var canEditContent: Bool/);
  assert.match(appSession, /guard environment\.canEditContent/);
  assert.match(appSession, /func loadNowDetail\(\)/);
  assert.match(appSession, /func updateNowHistory\(/);
  assert.match(appSession, /func deleteNowHistory\(/);
  assert.doesNotMatch(contentView, /Live is read-only/);
  assert.doesNotMatch(contentView, /SiteAdminEnvironmentPicker/);
  assert.doesNotMatch(todayView, /Live is read-only/);
  assert.doesNotMatch(todayView, /Switch to Draft/);
  assert.match(todayView, /Publish Draft to Live/);
  assert.match(nowSheet, /DatePicker/);
  assert.match(nowSheet, /History/);
  assert.match(nowSheet, /NowHistoryEditSheet/);
  assert.match(client, /func nowDetail\(\)/);
  assert.match(client, /"update-history"/);
  assert.match(client, /"delete-history"/);
  assert.match(models, /struct SiteAdminNowPayload/);
  assert.match(models, /struct SiteAdminNowUpdate: Decodable, Identifiable/);
});

test("site-admin-ios: calendar sync uploads EventKit observations to Draft", async () => {
  const appSession = await read("apps/site-admin-ios/SiteAdminCompanion/AppShell/AppSession.swift");
  const app = await read("apps/site-admin-ios/SiteAdminCompanion/SiteAdminCompanionApp.swift");
  const rootTab = await read("apps/site-admin-ios/SiteAdminCompanion/AppShell/RootTabView.swift");
  const client = await read("apps/site-admin-ios/SiteAdminCompanion/Services/SiteAdminClient.swift");
  const service = await read("apps/site-admin-ios/SiteAdminCompanion/Services/CalendarObservationSyncService.swift");
  const calendarView = await read("apps/site-admin-ios/SiteAdminCompanion/Features/Calendar/CalendarView.swift");
  const settings = await read("apps/site-admin-ios/SiteAdminCompanion/Features/Settings/SettingsView.swift");
  const plist = await read("apps/site-admin-ios/SiteAdminCompanion/Info.plist");

  assert.match(service, /import EventKit/);
  assert.match(service, /requestFullAccessToEvents/);
  assert.match(service, /syncMode: "snapshot"/);
  assert.match(service, /providerName\(for sourceType: EKSourceType\)/);
  assert.match(service, /collectorId = "ios:/);
  assert.match(service, /hasFullCalendarAccess/);
  assert.match(service, /noteMaxLength = 1_500/);
  assert.match(service, /compactNotes\(event\.notes\)/);
  assert.match(service, /limitedString\(event\.url\?\.absoluteString/);

  assert.match(client, /\/api\/site-admin\/calendar-observations/);
  assert.match(client, /\/api\/site-admin\/calendar-observations\/publish-live/);
  assert.match(client, /\/api\/public\/calendar/);
  assert.match(client, /func calendarSyncHealth\(\)/);
  assert.match(client, /func publishCalendarObservationsToLive\(\)/);
  assert.match(client, /static func publicCalendarPreview\(\)/);
  assert.match(appSession, /func syncCalendarsFromDevice\(\)/);
  assert.match(appSession, /func syncCalendarsIfNeeded\(reason: String\)/);
  assert.match(appSession, /calendarAutoSyncCooldownSeconds/);
  assert.match(appSession, /publishLatestCalendarObservationsToLive/);
  assert.match(appSession, /refreshPublicCalendarPreview/);
  assert.match(appSession, /func refreshCalendarSyncHealth/);
  assert.match(appSession, /calendarSyncStatusKey/);
  assert.match(appSession, /guard environment\.canEditContent/);
  assert.match(app, /scenePhase/);
  assert.match(app, /syncCalendarsIfNeeded\(reason: "foreground"\)/);
  assert.match(rootTab, /CalendarView\(\)/);
  assert.match(calendarView, /Sync Now/);
  assert.match(calendarView, /Live Public Calendar/);
  assert.match(calendarView, /Source Health/);
  assert.match(settings, /Calendar sync lives in the Calendar tab/);
  assert.doesNotMatch(settings, /Sync iPhone Calendars/);

  assert.match(plist, /NSCalendarsFullAccessUsageDescription/);
});
