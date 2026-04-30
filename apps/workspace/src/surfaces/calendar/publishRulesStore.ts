import {
  calendarPublishRulesLoad,
  calendarPublishRulesSave,
  type CalendarPublishRuleRow,
} from "../../modules/calendar/publishRulesApi";
import {
  emptyMetadataStore,
  normalizeCalendarPublishMetadata,
  type CalendarPublishMetadataStore,
} from "./publicProjection";

const LEGACY_STORAGE_KEY = "workspace.calendar.public-metadata.v1";

export function loadCalendarPublishMetadataFallback(): CalendarPublishMetadataStore {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return emptyMetadataStore();
    return parseStoreJson(raw);
  } catch {
    return emptyMetadataStore();
  }
}

export async function loadCalendarPublishRules(): Promise<CalendarPublishMetadataStore> {
  try {
    const rows = await calendarPublishRulesLoad();
    if (rows.length === 0) return loadCalendarPublishMetadataFallback();
    return rowsToStore(rows);
  } catch {
    return loadCalendarPublishMetadataFallback();
  }
}

export async function saveCalendarPublishRules(
  store: CalendarPublishMetadataStore,
): Promise<void> {
  try {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // localStorage is only a compatibility cache.
  }
  try {
    await calendarPublishRulesSave(storeToRows(store));
  } catch (err) {
    if (isMissingTauriBridge(err)) return;
    throw err;
  }
}

function parseStoreJson(raw: string): CalendarPublishMetadataStore {
  const parsed = JSON.parse(raw) as Partial<CalendarPublishMetadataStore>;
  const byEventKey =
    parsed.byEventKey && typeof parsed.byEventKey === "object"
      ? parsed.byEventKey
      : {};
  return {
    schemaVersion: 1,
    byEventKey: Object.fromEntries(
      Object.entries(byEventKey).map(([key, value]) => [
        key,
        normalizeCalendarPublishMetadata(value),
      ]),
    ),
  };
}

function rowsToStore(rows: CalendarPublishRuleRow[]): CalendarPublishMetadataStore {
  const byEventKey: CalendarPublishMetadataStore["byEventKey"] = {};
  for (const row of rows) {
    const key = row.eventKey.trim();
    if (!key) continue;
    try {
      byEventKey[key] = normalizeCalendarPublishMetadata(
        JSON.parse(row.metadataJson),
      );
    } catch {
      // Ignore corrupt rows rather than blocking the calendar surface.
    }
  }
  return { schemaVersion: 1, byEventKey };
}

function storeToRows(
  store: CalendarPublishMetadataStore,
): CalendarPublishRuleRow[] {
  const now = Date.now();
  return Object.entries(store.byEventKey).map(([eventKey, metadata]) => ({
    eventKey,
    metadataJson: JSON.stringify(normalizeCalendarPublishMetadata(metadata)),
    updatedAt: now,
  }));
}

function isMissingTauriBridge(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /window\.__TAURI__|window\.__TAURI_INTERNALS__|Cannot read properties of undefined \(reading 'invoke'\)|undefined is not an object/i.test(
    message,
  );
}
