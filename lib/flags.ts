import "server-only";

import { createHash } from "node:crypto";
import { flag } from "flags/next";
import { reportValue } from "flags";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  if (!raw) return defaultValue;
  return TRUE_VALUES.has(raw);
}

function ensureFlagsSecret(): void {
  const current = String(process.env.FLAGS_SECRET || "").trim();
  if (current) return;
  const seed = String(process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "").trim();
  if (!seed) return;
  process.env.FLAGS_SECRET = createHash("sha256").update(seed).digest("base64url");
}

function withReport<T>(key: string, value: T): T {
  try {
    reportValue(key, value);
  } catch {
    // Report is best-effort only; never block feature execution.
  }
  return value;
}

ensureFlagsSecret();

export const searchRichSnippetsFlag = flag<boolean>({
  key: "search-rich-snippets",
  description: "Controls whether search results include contextual text snippets.",
  origin: "https://jinkunchen.com/site-admin/config",
  options: [
    { label: "On", value: true },
    { label: "Off", value: false },
  ],
  async decide() {
    return withReport("search-rich-snippets", envFlag("FLAG_SEARCH_RICH_SNIPPETS", true));
  },
});

export const siteAdminStatusBannerFlag = flag<boolean>({
  key: "site-admin-status-banner",
  description: "Controls whether status banner is shown on /site-admin.",
  origin: "https://jinkunchen.com/site-admin",
  options: [
    { label: "On", value: true },
    { label: "Off", value: false },
  ],
  async decide() {
    return withReport("site-admin-status-banner", envFlag("FLAG_SITE_ADMIN_STATUS_BANNER", true));
  },
});

export const ALL_SERVER_FLAGS = [searchRichSnippetsFlag, siteAdminStatusBannerFlag] as const;
