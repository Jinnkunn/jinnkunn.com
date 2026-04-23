import { describe, expect, it } from "vitest";
import {
  clone,
  decodeJwtPayload,
  defaultSettings,
  formatPendingDeploy,
  isNavDirty,
  isOverrideDirty,
  isProtectedDirty,
  navPatch,
  normalizeNavRow,
  normalizeOverride,
  normalizeProtected,
  normalizeSettings,
  normalizeString,
  serializeJson,
  settingsPatch,
  stripTrailingSlash,
  toInteger,
  toIsoFromEpochSeconds,
} from "./utils";
import type { NavRow, OverrideRow, ProtectedRow } from "./types";

describe("normalizeString", () => {
  it("trims whitespace", () => {
    expect(normalizeString("  hi  ")).toBe("hi");
  });

  it("coerces nullish to empty", () => {
    expect(normalizeString(null)).toBe("");
    expect(normalizeString(undefined)).toBe("");
  });

  it("coerces numbers to trimmed strings", () => {
    expect(normalizeString(42)).toBe("42");
  });
});

describe("toInteger", () => {
  it("parses valid integers", () => {
    expect(toInteger("7")).toBe(7);
    expect(toInteger("-3")).toBe(-3);
  });

  it("returns fallback for non-numeric input", () => {
    expect(toInteger("abc")).toBe(0);
    expect(toInteger("abc", 99)).toBe(99);
  });

  it("truncates decimals (parseInt behavior)", () => {
    expect(toInteger("3.9")).toBe(3);
  });
});

describe("stripTrailingSlash", () => {
  it("strips single trailing slash", () => {
    expect(stripTrailingSlash("https://x/")).toBe("https://x");
  });

  it("strips repeated trailing slashes", () => {
    expect(stripTrailingSlash("https://x////")).toBe("https://x");
  });

  it("leaves slashless input alone", () => {
    expect(stripTrailingSlash("https://x")).toBe("https://x");
  });
});

describe("clone", () => {
  it("deep-copies nested objects", () => {
    const original = { a: 1, b: { c: [1, 2, 3] } };
    const copy = clone(original);
    copy.b.c.push(4);
    expect(original.b.c).toEqual([1, 2, 3]);
  });
});

describe("serializeJson", () => {
  it("pretty-prints with 2-space indent", () => {
    expect(serializeJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});

describe("decodeJwtPayload", () => {
  // Payload: {"sub":"jinnkunn","exp":1700000000}
  // header/signature arbitrary since we don't verify.
  const token =
    "eyJhbGciOiJIUzI1NiJ9." +
    "eyJzdWIiOiJqaW5ua3VubiIsImV4cCI6MTcwMDAwMDAwMH0." +
    "signature";

  it("decodes a valid payload", () => {
    const payload = decodeJwtPayload(token);
    expect(payload).toEqual({ sub: "jinnkunn", exp: 1700000000 });
  });

  it("returns null for malformed token", () => {
    expect(decodeJwtPayload("not.a.jwt.extra")).toBeNull();
    expect(decodeJwtPayload("single-segment")).toBeNull();
    expect(decodeJwtPayload("")).toBeNull();
  });
});

describe("toIsoFromEpochSeconds", () => {
  it("converts a positive epoch second count", () => {
    expect(toIsoFromEpochSeconds(0)).toBe("");
    expect(toIsoFromEpochSeconds(1700000000)).toBe("2023-11-14T22:13:20.000Z");
  });

  it("returns empty for invalid input", () => {
    expect(toIsoFromEpochSeconds("nope")).toBe("");
    expect(toIsoFromEpochSeconds(-1)).toBe("");
    expect(toIsoFromEpochSeconds(null)).toBe("");
  });
});

describe("normalizeSettings", () => {
  it("returns defaults for non-object input", () => {
    expect(normalizeSettings(null)).toEqual(defaultSettings());
    expect(normalizeSettings("string")).toEqual(defaultSettings());
  });

  it("defaults lang to en when missing", () => {
    const out = normalizeSettings({});
    expect(out.lang).toBe("en");
  });

  it("preserves explicit fields", () => {
    const out = normalizeSettings({
      siteName: "Test",
      sitemapAutoExcludeEnabled: false,
    });
    expect(out.siteName).toBe("Test");
    expect(out.sitemapAutoExcludeEnabled).toBe(false);
  });
});

describe("normalizeNavRow", () => {
  it("coerces group to 'top' or 'more'", () => {
    expect(normalizeNavRow({ group: "top" }).group).toBe("top");
    expect(normalizeNavRow({ group: "bogus" }).group).toBe("more");
  });

  it("falls back to zero order on non-numeric input", () => {
    expect(normalizeNavRow({ order: "x" }).order).toBe(0);
  });
});

describe("normalizeOverride", () => {
  it("uses pageId as rowId fallback", () => {
    const r = normalizeOverride({ pageId: "home" });
    expect(r.rowId).toBe("home");
  });
});

describe("normalizeProtected", () => {
  it("defaults auth to 'password' when missing", () => {
    expect(normalizeProtected({ pageId: "a" }).auth).toBe("password");
  });

  it("allows 'github' and 'public' values through", () => {
    expect(normalizeProtected({ pageId: "a", auth: "github" }).auth).toBe("github");
    expect(normalizeProtected({ pageId: "a", auth: "public" }).auth).toBe("public");
  });

  it("coerces unknown auth values back to 'password'", () => {
    expect(normalizeProtected({ pageId: "a", auth: "wat" }).auth).toBe("password");
  });

  it("never populates password from the network payload", () => {
    expect(normalizeProtected({ pageId: "a", password: "leaked" }).password).toBe("");
  });
});

describe("settingsPatch", () => {
  it("returns an empty patch when draft matches base", () => {
    const base = defaultSettings();
    expect(settingsPatch(base, { ...base })).toEqual({});
  });

  it("picks up only the changed fields", () => {
    const base = defaultSettings();
    const draft = { ...base, siteName: "New", lang: "zh" };
    expect(settingsPatch(base, draft)).toEqual({ siteName: "New", lang: "zh" });
  });
});

describe("navPatch + isNavDirty", () => {
  const base: NavRow = {
    rowId: "r1",
    label: "Home",
    href: "/",
    group: "top",
    order: 0,
    enabled: true,
  };

  it("detects no change", () => {
    expect(isNavDirty(base, { ...base })).toBe(false);
    expect(navPatch(base, { ...base })).toEqual({});
  });

  it("detects label change", () => {
    const draft = { ...base, label: "Homepage" };
    expect(isNavDirty(base, draft)).toBe(true);
    expect(navPatch(base, draft)).toEqual({ label: "Homepage" });
  });

  it("detects multiple changes at once", () => {
    const draft = { ...base, group: "more" as const, order: 5 };
    expect(navPatch(base, draft)).toEqual({ group: "more", order: 5 });
  });
});

describe("isOverrideDirty", () => {
  const base: OverrideRow = {
    rowId: "home",
    pageId: "home",
    routePath: "/",
    enabled: true,
  };

  it("returns false when unchanged", () => {
    expect(isOverrideDirty(base, { ...base })).toBe(false);
  });

  it("returns true when routePath changes", () => {
    expect(isOverrideDirty(base, { ...base, routePath: "/home" })).toBe(true);
  });

  it("ignores whitespace-only diffs", () => {
    expect(isOverrideDirty(base, { ...base, routePath: " / " })).toBe(false);
  });
});

describe("isProtectedDirty", () => {
  const base: ProtectedRow = {
    rowId: "r1",
    pageId: "admin",
    path: "/admin",
    mode: "prefix",
    auth: "password",
    password: "",
    enabled: true,
  };

  it("returns false when unchanged and password blank", () => {
    expect(isProtectedDirty(base, { ...base })).toBe(false);
  });

  it("returns true on path change", () => {
    expect(isProtectedDirty(base, { ...base, path: "/secret" })).toBe(true);
  });

  it("returns true on auth change", () => {
    expect(isProtectedDirty(base, { ...base, auth: "github" })).toBe(true);
  });

  it("returns true when password is set under password auth", () => {
    expect(isProtectedDirty(base, { ...base, password: "hunter2" })).toBe(true);
  });

  it("ignores password when auth is not password", () => {
    const next: ProtectedRow = { ...base, auth: "github", password: "hunter2" };
    // auth change already makes it dirty — regardless of password.
    expect(isProtectedDirty(base, next)).toBe(true);
  });
});

describe("formatPendingDeploy", () => {
  it("maps booleans", () => {
    expect(formatPendingDeploy({ pendingDeploy: true })).toBe("Yes");
    expect(formatPendingDeploy({ pendingDeploy: false })).toBe("No");
  });

  it("falls back to 'Unknown' with reason when undefined", () => {
    expect(formatPendingDeploy({})).toBe("Unknown");
    expect(formatPendingDeploy({ pendingDeployReason: "boot" })).toBe(
      "Unknown (boot)",
    );
  });
});
