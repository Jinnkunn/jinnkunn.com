import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeGithubUser,
  normalizeGithubUserList,
  parseGithubUserCsv,
} from "../lib/shared/github-users.ts";

test("normalizeGithubUser: strips @ prefix and lowercases", () => {
  assert.equal(normalizeGithubUser("@JinnKunn"), "jinnkunn");
  assert.equal(normalizeGithubUser("  @Someone "), "someone");
  assert.equal(normalizeGithubUser("Plain"), "plain");
});

test("normalizeGithubUser: returns empty for nullish or non-string inputs", () => {
  assert.equal(normalizeGithubUser(null), "");
  assert.equal(normalizeGithubUser(undefined), "");
  assert.equal(normalizeGithubUser(123), "123");
  assert.equal(normalizeGithubUser(""), "");
});

test("normalizeGithubUserList: deduplicates after normalization", () => {
  const out = normalizeGithubUserList(["@Jinnkunn", "jinnkunn", "@SOMEONE", "someone"]);
  assert.deepEqual(out.sort(), ["jinnkunn", "someone"]);
});

test("normalizeGithubUserList: non-array input returns empty", () => {
  assert.deepEqual(normalizeGithubUserList("jinnkunn"), []);
  assert.deepEqual(normalizeGithubUserList(null), []);
  assert.deepEqual(normalizeGithubUserList({}), []);
});

test("parseGithubUserCsv: splits on commas and normalizes each entry", () => {
  const out = parseGithubUserCsv(" @Jinnkunn , someone , ,@bob ");
  assert.deepEqual(out, ["jinnkunn", "someone", "bob"]);
});

test("parseGithubUserCsv: empty/missing input returns empty list", () => {
  assert.deepEqual(parseGithubUserCsv(""), []);
  assert.deepEqual(parseGithubUserCsv(null), []);
  assert.deepEqual(parseGithubUserCsv(undefined), []);
});
