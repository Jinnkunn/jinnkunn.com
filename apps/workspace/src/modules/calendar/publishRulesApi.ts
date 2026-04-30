import { invoke } from "@tauri-apps/api/core";

export interface CalendarPublishRuleRow {
  eventKey: string;
  metadataJson: string;
  updatedAt: number;
}

export function calendarPublishRulesLoad(): Promise<CalendarPublishRuleRow[]> {
  return invoke("calendar_publish_rules_load");
}

export function calendarPublishRulesSave(
  rows: CalendarPublishRuleRow[],
): Promise<void> {
  return invoke("calendar_publish_rules_save", { rows });
}
