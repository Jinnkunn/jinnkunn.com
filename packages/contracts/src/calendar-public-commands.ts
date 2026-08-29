import {
  normalizePublicCalendarData,
  type PublicCalendarData,
} from "@jinnkunn/calendar-core/public";

import type { ParseResult } from "./parse-result.ts";

export type SiteAdminCalendarPublicSaveCommand = {
  data: PublicCalendarData;
  expectedFileSha: string;
};

function expectedShaRequired(readPath: string, emptyMeans: string): string {
  return (
    `expectedFileSha is required. GET ${readPath} first and send back its ` +
    `sourceVersion.fileSha ("" when ${emptyMeans}).`
  );
}

export const CALENDAR_PUBLIC_EXPECTED_SHA_REQUIRED = expectedShaRequired(
  "/api/site-admin/calendar-public",
  "no projection exists yet",
);

export const CALENDAR_PUBLIC_LIVE_EXPECTED_SHA_REQUIRED = expectedShaRequired(
  "/api/site-admin/calendar-public/live",
  "nothing is published yet",
);

function parseSaveCommand(
  raw: Record<string, unknown>,
  error: string,
): ParseResult<SiteAdminCalendarPublicSaveCommand> {
  if (typeof raw.expectedFileSha !== "string") {
    return { ok: false, error, status: 400 };
  }
  return {
    ok: true,
    value: {
      data: normalizePublicCalendarData(raw.data ?? raw),
      expectedFileSha: raw.expectedFileSha.trim(),
    },
  };
}

export function parseSiteAdminCalendarPublicSaveCommand(
  raw: Record<string, unknown>,
): ParseResult<SiteAdminCalendarPublicSaveCommand> {
  return parseSaveCommand(raw, CALENDAR_PUBLIC_EXPECTED_SHA_REQUIRED);
}

export function parseSiteAdminCalendarPublicLiveSaveCommand(
  raw: Record<string, unknown>,
): ParseResult<SiteAdminCalendarPublicSaveCommand> {
  return parseSaveCommand(raw, CALENDAR_PUBLIC_LIVE_EXPECTED_SHA_REQUIRED);
}
