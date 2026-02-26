import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeAccessMode,
  normalizeProtectedAccessMode,
  parseAccessMode,
  parseProtectedAccessMode,
} from "../lib/shared/access.ts";

test("shared-access: parseAccessMode handles nullish, casing, whitespace and unknown", () => {
  assert.equal(parseAccessMode(undefined), null);
  assert.equal(parseAccessMode(null), null);
  assert.equal(parseAccessMode(""), null);
  assert.equal(parseAccessMode("   "), null);
  assert.equal(parseAccessMode(" PUBLIC "), "public");
  assert.equal(parseAccessMode("gItHuB"), "github");
  assert.equal(parseAccessMode("typo"), null);
});

test("shared-access: parseProtectedAccessMode handles nullish, casing, whitespace and unknown", () => {
  assert.equal(parseProtectedAccessMode(undefined), null);
  assert.equal(parseProtectedAccessMode(null), null);
  assert.equal(parseProtectedAccessMode(""), null);
  assert.equal(parseProtectedAccessMode("   "), null);
  assert.equal(parseProtectedAccessMode(" PASSWORD "), "password");
  assert.equal(parseProtectedAccessMode("GiThUb"), "github");
  assert.equal(parseProtectedAccessMode("public"), null);
  assert.equal(parseProtectedAccessMode("typo"), null);
});

test("shared-access: normalizeAccessMode and normalizeProtectedAccessMode keep fallback behavior", () => {
  assert.equal(normalizeAccessMode("password"), "password");
  assert.equal(normalizeAccessMode("typo"), "public");
  assert.equal(normalizeAccessMode("typo", "github"), "github");

  assert.equal(normalizeProtectedAccessMode("github"), "github");
  assert.equal(normalizeProtectedAccessMode("typo"), "password");
  assert.equal(normalizeProtectedAccessMode("typo", "github"), "github");
});
