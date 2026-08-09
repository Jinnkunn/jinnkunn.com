// Request bodies for the two public-calendar writers.
//
// Lives outside the route handlers (same reason as now-commands.ts /
// routes-command.ts): route modules can't be imported outside Next, so a
// parser that stays in the handler can only ever be "tested" by matching its
// own source text. The optimistic-lock rule these encode — expectedFileSha is
// required, "" means "nothing published yet" — is worth a real test.

import {
  normalizePublicCalendarData,
  type PublicCalendarData,
} from "../shared/public-calendar.ts";
import type { ParseResult } from "./request-types.ts";

export type SiteAdminCalendarPublicSaveCommand = {
  data: PublicCalendarData;
  expectedFileSha: string;
};

/** Both writers replace the whole projection, so a body without a version
 * token can only ever be an unconditional write — i.e. the second publisher
 * wins by luck. Reject it instead, and name the endpoint that mints the
 * token so the message is actionable. */
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
      // Legacy callers POST the bare document; newer ones wrap it in `data`.
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
