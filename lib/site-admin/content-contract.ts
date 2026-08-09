// Response contracts for the single-file content endpoints (/now, /home,
// /calendar-public, /calendar-public/live).
//
// These endpoints predate the parser + guard convention that config, routes,
// status and deploy follow, so every client hand-copied their types and then
// guessed at the envelope at runtime — the desktop app falls back to
// `data ?? body`, the iOS app treats a null `data` as a crash. One parser per
// endpoint gives all of them the same flattened `{ ok: true, ... }` shape.
//
// The parsers normalise the document itself (same normalisers the server
// writes through), so a client never has to defend against a half-populated
// payload. `null` means "this response isn't a valid ack" — surface it as a
// transport error rather than pretending it succeeded.

import { isRecord } from "../client/api-guards.ts";
import { normalizePublicCalendarData } from "../shared/public-calendar.ts";
import type {
  SiteAdminApiError,
  SiteAdminCalendarPublicGetResult,
  SiteAdminCalendarPublicLiveGetResult,
  SiteAdminCalendarPublicLivePostResult,
  SiteAdminCalendarPublicPostResult,
  SiteAdminFileSourceVersion,
  SiteAdminHomeGetResult,
  SiteAdminHomePostResult,
  SiteAdminNowGetResult,
  SiteAdminNowPostResult,
} from "./api-types.ts";
import { parseApiContract, toNumberOrZero, toStringValue } from "./contract-helpers.ts";
import { normalizeHomeData } from "./home-normalize.ts";
import { normalizeNowData } from "./now-normalize.ts";

/** Unlike the config/routes source versions, an empty `fileSha` is a real
 * value here: it means "no file yet", and it's what a first writer must send
 * back as `expectedFileSha`. So the field must be present but may be "". */
function parseFileSourceVersion(v: unknown): SiteAdminFileSourceVersion | null {
  if (!isRecord(v)) return null;
  if (typeof v.fileSha !== "string") return null;
  return { fileSha: v.fileSha };
}

/** One guard for every content result: each parsed success shape carries
 * `ok: true`, so narrowing is the same check regardless of endpoint. */
export function isSiteAdminContentOk<T extends { ok: true }>(
  v: T | SiteAdminApiError,
): v is T {
  return v.ok;
}

export function parseSiteAdminNowGet(v: unknown): SiteAdminNowGetResult | null {
  return parseApiContract<SiteAdminNowGetResult>(v, (payload) => {
    if (!isRecord(payload) || !("data" in payload)) return null;
    const sourceVersion = parseFileSourceVersion(payload.sourceVersion);
    if (!sourceVersion) return null;
    return { ok: true, data: normalizeNowData(payload.data), sourceVersion };
  });
}

/** POST /api/site-admin/now echoes the updated document, so it parses
 * exactly like the GET. */
export function parseSiteAdminNowPost(v: unknown): SiteAdminNowPostResult | null {
  return parseSiteAdminNowGet(v);
}

export function parseSiteAdminHomeGet(v: unknown): SiteAdminHomeGetResult | null {
  return parseApiContract<SiteAdminHomeGetResult>(v, (payload) => {
    if (!isRecord(payload) || !("data" in payload)) return null;
    const sourceVersion = parseFileSourceVersion(payload.sourceVersion);
    if (!sourceVersion) return null;
    return { ok: true, data: normalizeHomeData(payload.data), sourceVersion };
  });
}

export function parseSiteAdminHomePost(v: unknown): SiteAdminHomePostResult | null {
  return parseApiContract<SiteAdminHomePostResult>(v, (payload) => {
    if (!isRecord(payload)) return null;
    const sourceVersion = parseFileSourceVersion(payload.sourceVersion);
    if (!sourceVersion) return null;
    return { ok: true, sourceVersion };
  });
}

export function parseSiteAdminCalendarPublicGet(
  v: unknown,
): SiteAdminCalendarPublicGetResult | null {
  return parseApiContract<SiteAdminCalendarPublicGetResult>(v, (payload) => {
    if (!isRecord(payload) || !("data" in payload)) return null;
    const sourceVersion = parseFileSourceVersion(payload.sourceVersion);
    if (!sourceVersion) return null;
    return {
      ok: true,
      data: normalizePublicCalendarData(payload.data),
      sourceVersion,
    };
  });
}

export function parseSiteAdminCalendarPublicPost(
  v: unknown,
): SiteAdminCalendarPublicPostResult | null {
  return parseApiContract<SiteAdminCalendarPublicPostResult>(v, (payload) => {
    if (!isRecord(payload)) return null;
    const sourceVersion = parseFileSourceVersion(payload.sourceVersion);
    if (!sourceVersion) return null;
    const dbStatus = toStringValue(payload.dbStatus);
    return {
      ok: true,
      sourceVersion,
      dbStatus:
        dbStatus === "ok" || dbStatus === "skipped" || dbStatus === "failed"
          ? dbStatus
          : "failed",
    };
  });
}

export function parseSiteAdminCalendarPublicLiveGet(
  v: unknown,
): SiteAdminCalendarPublicLiveGetResult | null {
  return parseApiContract<SiteAdminCalendarPublicLiveGetResult>(v, (payload) => {
    if (!isRecord(payload) || !("data" in payload)) return null;
    const sourceVersion = parseFileSourceVersion(payload.sourceVersion);
    if (!sourceVersion) return null;
    // A null document is the documented "nothing published yet" state — keep
    // it null rather than normalising it into an empty-but-present calendar,
    // which would read as "published, no events".
    return {
      ok: true,
      data: payload.data == null ? null : normalizePublicCalendarData(payload.data),
      sourceVersion,
    };
  });
}

export function parseSiteAdminCalendarPublicLivePost(
  v: unknown,
): SiteAdminCalendarPublicLivePostResult | null {
  return parseApiContract<SiteAdminCalendarPublicLivePostResult>(v, (payload) => {
    if (!isRecord(payload)) return null;
    const updatedAt = toStringValue(payload.updatedAt);
    if (!updatedAt) return null;
    return {
      ok: true,
      eventCount: toNumberOrZero(payload.eventCount),
      eventsWritten: toNumberOrZero(payload.eventsWritten),
      updatedAt,
    };
  });
}
