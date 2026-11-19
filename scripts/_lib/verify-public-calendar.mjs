import {
  PUBLIC_CALENDAR_REVISION_HEADER, PUBLIC_CALENDAR_VERIFIED_AT_HEADER, publicCalendarEventKey,
} from "../../packages/calendar-core/src/public-calendar.ts";

const jsonPath = "/api/public/calendar";
const icsPath = "/api/public/calendar/calendar.ics";
const uidDomain = "@jinkunchen.com";
const busyFields = new Set(["id", "occurrenceId", "title", "startsAt", "endsAt", "isAllDay",
  "visibility", "colorHex", "audience", "description", "location", "url"]);
const standardEventFields = new Set(["UID", "DTSTAMP", "DTSTART", "DTEND", "SUMMARY", "CLASS"]);

class CalendarFeedsPending extends Error {}

function requireCalendar(condition, message) {
  if (!condition) throw new Error(message);
}

function decodeText(value) {
  return value?.replace(/\\([\\,;nN])/g, (_, char) => /n/i.test(char) ? "\n" : char);
}

function dateValue(value, allDay) {
  const time = Date.parse(value);
  requireCalendar(Number.isFinite(time), "Public JSON contains an invalid date.");
  const iso = new Date(time).toISOString();
  return allDay ? iso.slice(0, 10).replaceAll("-", "") : iso.replace(/[-:]|\.\d{3}/g, "");
}

// Read the public feed's VEVENT subset without invoking the production writer.
function readEvents(ics) {
  const lines = ics.split("\r\n");
  requireCalendar(lines[0] === "BEGIN:VCALENDAR" && lines.at(-2) === "END:VCALENDAR" && lines.at(-1) === "",
    "Public ICS is not a CRLF-terminated VCALENDAR.");
  requireCalendar(lines.every((line) => Buffer.byteLength(line, "utf8") <= 75 && !/[\r\n]/.test(line)),
    "Public ICS has an invalid folded line.");
  const events = new Map();
  let event = null;
  for (const line of ics.replace(/\r\n[ \t]/g, "").split("\r\n")) {
    if (line === "BEGIN:VEVENT") {
      requireCalendar(!event, "Public ICS contains nested events.");
      event = new Map();
      continue;
    }
    if (line === "END:VEVENT") {
      const uid = decodeText(event?.get("UID")?.value);
      requireCalendar(uid && !events.has(uid), "Public ICS has a missing or reused event UID.");
      events.set(uid, event);
      event = null;
      continue;
    }
    if (!event) continue;
    const colon = line.indexOf(":");
    requireCalendar(colon > 0, "Public ICS has an invalid event property.");
    const [name, ...params] = line.slice(0, colon).split(";");
    requireCalendar(!event.has(name), "Public ICS repeats an event property.");
    event.set(name, { params: params.join(";"), value: line.slice(colon + 1) });
  }
  requireCalendar(!event, "Public ICS contains an unclosed event.");
  return events;
}

export function assertPublicCalendarFeeds({ json, ics, jsonRevision, icsRevision,
  jsonVerifiedAt = null, icsVerifiedAt = null, requireRevision = true, requireVerifiedAt = false }) {
  const revision = json?.observationSnapshot?.revision ?? null;
  const verifiedAt = json?.observationSnapshot?.verifiedAt ?? null;
  requireCalendar(revision === null || (Number.isSafeInteger(revision) && revision > 0),
    "Public calendar observation revision is invalid.");
  requireCalendar(json?.schemaVersion === 1 && Array.isArray(json.events), "Public calendar JSON is invalid.");
  if (jsonRevision !== icsRevision || (requireRevision && revision === null)) {
    throw new CalendarFeedsPending("Public JSON and ICS have not reached a common verified revision.");
  }
  requireCalendar(jsonRevision === (revision === null ? null : String(revision)),
    "Public calendar revision header does not describe the JSON body.");
  if (jsonVerifiedAt !== icsVerifiedAt || (requireVerifiedAt && verifiedAt === null)) {
    throw new CalendarFeedsPending("Public JSON and ICS have not reached a common verification time.");
  }
  requireCalendar(jsonVerifiedAt === verifiedAt && (verifiedAt === null || (revision !== null &&
    typeof verifiedAt === "string" && Number.isFinite(Date.parse(verifiedAt)) && new Date(verifiedAt).toISOString() === verifiedAt)),
  "Public calendar verification time does not describe the JSON body.");
  requireCalendar(!Object.hasOwn(json, "legacyExclusions"), "Public JSON exposes internal observation data.");

  const icsEvents = readEvents(ics);
  const seen = new Set();
  for (const event of json.events) {
    requireCalendar(event && typeof event.id === "string" && event.id &&
      (event.occurrenceId === undefined || (typeof event.occurrenceId === "string" && event.occurrenceId)) &&
      typeof event.title === "string" && typeof event.startsAt === "string" && typeof event.endsAt === "string" &&
      Date.parse(event.endsAt) > Date.parse(event.startsAt) &&
      typeof event.isAllDay === "boolean" && ["busy", "titleOnly", "full"].includes(event.visibility),
    "Public JSON contains an invalid event.");
    const key = publicCalendarEventKey(event);
    requireCalendar(!seen.has(key), "Public JSON reuses an occurrence key.");
    seen.add(key);
  }
  let busy = 0;
  for (const event of json.events) {
    const entry = icsEvents.get(publicCalendarEventKey(event) + uidDomain);
    requireCalendar(entry, "A public JSON occurrence is missing from ICS.");
    for (const [name, time] of [["DTSTART", event.startsAt], ["DTEND", event.endsAt]]) {
      const field = entry.get(name);
      requireCalendar(field?.value === dateValue(time, event.isAllDay) &&
        field.params === (event.isAllDay ? "VALUE=DATE" : ""), "Public JSON and ICS disagree on an event time.");
    }
    const isBusy = event.visibility === "busy";
    requireCalendar(decodeText(entry.get("SUMMARY")?.value) === event.title &&
      entry.get("CLASS")?.value === (isBusy ? "CONFIDENTIAL" : "PUBLIC"),
    "Public JSON and ICS disagree on an event title or privacy level.");
    if (isBusy) {
      busy += 1;
      requireCalendar(event.title === "Busy" && Object.keys(event).every((field) => busyFields.has(field)),
        "A Busy occurrence has non-public JSON fields.");
    }
    if (event.visibility !== "full") {
      requireCalendar(["description", "location", "url"].every((field) => event[field] == null) &&
        [...entry.keys()].every((field) => standardEventFields.has(field)),
      "A limited-visibility occurrence has private details.");
    } else {
      for (const [name, field] of [["DESCRIPTION", "description"], ["LOCATION", "location"], ["URL", "url"]]) {
        const value = entry.get(name)?.value;
        requireCalendar((name === "URL" ? value : decodeText(value)) === (event[field] || undefined),
          "Public JSON and ICS disagree on published event details.");
      }
    }
  }
  requireCalendar(icsEvents.size === json.events.length, "The public feeds have different occurrence counts.");
  const keys = json.observationSnapshot?.eventIds;
  if (revision !== null) {
    const busyKeys = new Set(json.events.filter(({ visibility }) => visibility === "busy").map(publicCalendarEventKey));
    requireCalendar(Array.isArray(keys) && new Set(keys).size === keys.length && keys.every((key) => busyKeys.has(key)),
      "Public observation receipt names a missing or non-Busy occurrence.");
  }
  return { revision, events: seen.size, busy, ...(verifiedAt && { verifiedAt }) };
}

export async function verifyPublicCalendarFeeds(request, {
  retryDelays = [0, 1_000, 3_000, 6_000, 10_000, 20_000, 30_000],
  requireRevision = true,
  requireVerifiedAt = false,
} = {}) {
  let pending;
  for (const delay of retryDelays) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    let jsonResponse, icsResponse;
    try {
      [jsonResponse, icsResponse] = await Promise.all([request(jsonPath), request(icsPath)]);
    } catch {
      pending = new CalendarFeedsPending("A public calendar request did not complete.");
      continue;
    }
    const statuses = [jsonResponse.status, icsResponse.status];
    if (statuses.some((status) => status === 429 || status >= 500)) {
      pending = new CalendarFeedsPending("A public calendar endpoint is temporarily unavailable.");
      continue;
    }
    requireCalendar(statuses.every((status) => status === 200), "A public calendar endpoint is not accessible.");
    requireCalendar(jsonResponse.headers.get("content-type")?.includes("application/json") &&
      icsResponse.headers.get("content-type")?.includes("text/calendar"), "A public calendar endpoint returned the wrong media type.");
    try {
      return assertPublicCalendarFeeds({
        json: await jsonResponse.json(),
        ics: await icsResponse.text(),
        jsonRevision: jsonResponse.headers.get(PUBLIC_CALENDAR_REVISION_HEADER),
        icsRevision: icsResponse.headers.get(PUBLIC_CALENDAR_REVISION_HEADER),
        jsonVerifiedAt: jsonResponse.headers.get(PUBLIC_CALENDAR_VERIFIED_AT_HEADER),
        icsVerifiedAt: icsResponse.headers.get(PUBLIC_CALENDAR_VERIFIED_AT_HEADER),
        requireRevision,
        requireVerifiedAt,
      });
    } catch (error) {
      if (!(error instanceof CalendarFeedsPending)) throw error;
      pending = error;
    }
  }
  throw pending ?? new Error("No public calendar verification attempts were made.");
}
