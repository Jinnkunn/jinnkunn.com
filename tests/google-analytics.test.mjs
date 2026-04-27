import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGoogleAnalyticsInitScript,
  isGoogleAnalyticsId,
  normalizeGoogleAnalyticsId,
} from "../lib/shared/google-analytics.ts";

test("google analytics: normalizes GA4 measurement ids", () => {
  assert.equal(normalizeGoogleAnalyticsId(" g-abc123def4 "), "G-ABC123DEF4");
  assert.equal(normalizeGoogleAnalyticsId(""), "");
  assert.equal(normalizeGoogleAnalyticsId("   "), "");
});

test("google analytics: rejects invalid ids", () => {
  assert.equal(normalizeGoogleAnalyticsId("G-ABCD"), null);
  assert.equal(normalizeGoogleAnalyticsId("G-ABC123DEF45"), null);
  assert.equal(normalizeGoogleAnalyticsId("UA-123456-1"), null);
  assert.equal(normalizeGoogleAnalyticsId("G-ABC 123"), null);
  assert.equal(normalizeGoogleAnalyticsId("G-ABC123');alert(1);//"), null);
  assert.equal(isGoogleAnalyticsId("G-ABC123DEF4"), true);
  assert.equal(isGoogleAnalyticsId("not-ga"), false);
});

test("google analytics: init script safely serializes the measurement id", () => {
  const script = buildGoogleAnalyticsInitScript("g-abc123def4");
  assert.match(script, /gtag\('config', "G-ABC123DEF4", \{ anonymize_ip: true \}\);/);
  assert.doesNotMatch(script, /'G-ABC123DEF4'/);
  assert.equal(buildGoogleAnalyticsInitScript("G-ABC123');alert(1);//"), "");
});
