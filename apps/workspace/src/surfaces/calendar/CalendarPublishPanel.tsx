import { useMemo } from "react";

import { isLocalCalendarId } from "../../modules/calendar/localCalendarApi";
import {
  CALENDAR_PRODUCTION_SYNC_OPTIONS,
  type CalendarProductionSyncPolicy,
} from "./productionSyncPolicy";
import { SmartRulesEditor } from "./SmartRulesEditor";
import type { CalendarPublicVisibility } from "./publicProjection";
import type {
  CalendarSyncHealth,
  CalendarPublishState,
} from "./CalendarSyncHealth";
import {
  CalendarSyncHealthPanel,
  CalendarSyncHealthPill,
} from "./CalendarSyncHealth";
import type { Calendar } from "./types";
import {
  SyncPreviewChip,
  type CalendarPublishDiff,
  type PublishSummary,
} from "./CalendarPublishSummary";

const DEFAULT_VISIBILITY_LABELS: Array<{
  value: CalendarPublicVisibility;
  label: string;
  hint: string;
}> = [
  {
    value: "hidden",
    label: "Hidden",
    hint: "Skip every event in this calendar from /calendar",
  },
  {
    value: "busy",
    label: "Busy",
    hint: "Show as anonymous busy block on /calendar",
  },
  {
    value: "titleOnly",
    label: "Title",
    hint: "Show title + time, hide notes/location",
  },
  {
    value: "full",
    label: "Full",
    hint: "Show title, time, notes, location, URL",
  },
];

function CalendarPublishSummary({ summary }: { summary: PublishSummary }) {
  return (
    <div
      className="calendar-publish-summary"
      aria-label="Calendar publish summary for current view"
    >
      <span>Busy {summary.busy}</span>
      <span>Title {summary.titleOnly}</span>
      <span>Full {summary.full}</span>
      {summary.hidden > 0 ? (
        <span>Hidden {summary.hidden}</span>
      ) : null}
    </div>
  );
}

export function CalendarPublishPanel({
  calendarDefaults,
  calendars,
  diff,
  hasBaseline,
  health,
  publishMessage,
  publishState,
  productionSyncPolicy,
  rulesEditorOpen,
  rulesLoaded,
  summary,
  onRulesSaved,
  onSetCalendarDefault,
  onSetProductionSyncPolicy,
  onSync,
  onToggleRulesEditor,
}: {
  calendarDefaults: ReadonlyMap<string, CalendarPublicVisibility>;
  calendars: readonly Calendar[];
  diff: CalendarPublishDiff;
  hasBaseline: boolean;
  health: CalendarSyncHealth;
  publishMessage: string;
  publishState: CalendarPublishState;
  productionSyncPolicy: CalendarProductionSyncPolicy;
  rulesEditorOpen: boolean;
  rulesLoaded: boolean;
  summary: PublishSummary;
  onRulesSaved: () => void;
  onSetCalendarDefault: (
    calendarId: string,
    visibility: CalendarPublicVisibility,
  ) => void;
  onSetProductionSyncPolicy: (policy: CalendarProductionSyncPolicy) => void;
  onSync: () => void;
  onToggleRulesEditor: () => void;
}) {
  const publishCalendars = useMemo(
    () => calendars.filter((calendar) => !isLocalCalendarId(calendar.id)),
    [calendars],
  );

  return (
    <section className="calendar-publish-panel" aria-label="Website calendar publish">
      <header className="calendar-publish-panel__header">
        <div>
          <strong>Website Publish</strong>
          <span>Visibility, Featured mode, and sync.</span>
        </div>
      </header>
      <div className="calendar-publish-panel__status">
        <CalendarPublishSummary summary={summary} />
        <CalendarSyncHealthPill health={health} state={publishState} />
        <SyncPreviewChip diff={diff} hasBaseline={hasBaseline} />
      </div>
      <div className="calendar-publish-panel__actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={publishState === "publishing" || !rulesLoaded}
          onClick={onSync}
        >
          {publishState === "publishing" ? "Syncing..." : "Sync now"}
        </button>
        <button type="button" className="btn" onClick={onToggleRulesEditor}>
          {rulesEditorOpen ? "Hide rules" : "Edit rules"}
        </button>
      </div>
      {publishMessage ? (
        <p
          className={
            publishState === "error"
              ? "calendar-sync-error"
              : "calendar-publish-panel__message"
          }
        >
          {publishMessage}
        </p>
      ) : null}
      <CalendarSyncHealthPanel health={health} state={publishState} />
      <section className="calendar-publish-policy">
        <header>
          <h3>Production</h3>
        </header>
        <label className="calendar-publish-policy__row">
          <span>Sync</span>
          <select
            value={productionSyncPolicy}
            onChange={(event) =>
              onSetProductionSyncPolicy(
                event.currentTarget.value as CalendarProductionSyncPolicy,
              )
            }
          >
            {CALENDAR_PRODUCTION_SYNC_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} title={option.hint}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </section>
      <section className="calendar-publish-defaults">
        <header>
          <h3>Calendar defaults</h3>
        </header>
        {publishCalendars.length === 0 ? (
          <p className="calendar-publish-defaults__empty">
            No platform calendars loaded.
          </p>
        ) : (
          <div className="calendar-publish-defaults__list">
            {publishCalendars.map((calendar) => {
              const currentDefault = calendarDefaults.get(calendar.id) ?? "busy";
              return (
                <label key={calendar.id} className="calendar-publish-defaults__row">
                  <span
                    className="calendar-publish-defaults__swatch"
                    style={{ background: calendar.colorHex }}
                    aria-hidden="true"
                  />
                  <span className="calendar-publish-defaults__title">
                    {calendar.title}
                  </span>
                  <select
                    value={currentDefault}
                    onChange={(event) =>
                      onSetCalendarDefault(
                        calendar.id,
                        event.currentTarget.value as CalendarPublicVisibility,
                      )
                    }
                  >
                    {DEFAULT_VISIBILITY_LABELS.map((option) => (
                      <option
                        key={option.value}
                        value={option.value}
                        title={option.hint}
                      >
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        )}
      </section>
      {rulesEditorOpen ? (
        <SmartRulesEditor
          onClose={onToggleRulesEditor}
          onRulesSaved={onRulesSaved}
        />
      ) : null}
    </section>
  );
}
