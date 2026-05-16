import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Archive,
  ExternalLink,
  Eye,
  EyeOff,
  Palette,
  Plus,
  RefreshCw,
  Search,
  Settings,
} from "lucide-react";

import {
  CALENDAR_TIME_ZONE_OPTIONS,
  calendarTimeZoneLabel,
} from "../../../../../lib/shared/calendar-timezone.ts";
import {
  calendarCapability,
  calendarSettingsSearchText,
  sourceCanOpenSystemSettings,
  sourceManagementLabel,
  sourceTypeLabel,
  summarizeSourceVisibility,
} from "./calendarManagement";
import type { Calendar, CalendarSource } from "./types";

export type CalendarSettingsTab = "accounts" | "calendars" | "defaults" | "publish";

export interface CalendarSettingsPanelProps {
  calendarsBySource: ReadonlyMap<string, Calendar[]>;
  calendars: readonly Calendar[];
  defaultEventCalendarId: string;
  sources: readonly CalendarSource[];
  timeZone: string;
  visible: ReadonlySet<string>;
  onClose: () => void;
  onCreateLocalCalendar: () => void;
  onArchiveLocalCalendar: (calendarId: string) => void;
  onRenameLocalCalendar: (calendarId: string, title: string) => void;
  onRecolorLocalCalendar: (calendarId: string, colorHex: string) => void;
  onOpenAccountSettings: () => void;
  onRefreshAccounts: () => void;
  onSetCalendarVisible: (calendarId: string, visible: boolean) => void;
  onSetSourceVisible: (sourceId: string, visible: boolean) => void;
  onDefaultEventCalendarChange: (calendarId: string) => void;
  onTimeZoneChange: (timeZone: string) => void;
  initialTab?: CalendarSettingsTab;
  publishPanel: ReactNode;
}

export function CalendarSettingsPanel({
  calendarsBySource,
  calendars,
  defaultEventCalendarId,
  sources,
  timeZone,
  visible,
  onClose,
  onCreateLocalCalendar,
  onArchiveLocalCalendar,
  onRenameLocalCalendar,
  onRecolorLocalCalendar,
  onOpenAccountSettings,
  onRefreshAccounts,
  onSetCalendarVisible,
  onSetSourceVisible,
  onDefaultEventCalendarChange,
  onTimeZoneChange,
  initialTab = "accounts",
  publishPanel,
}: CalendarSettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<CalendarSettingsTab>(initialTab);
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);
  const [calendarQuery, setCalendarQuery] = useState("");
  const [confirmArchiveCalendarId, setConfirmArchiveCalendarId] =
    useState<string | null>(null);
  const sourceById = useMemo(
    () => new Map(sources.map((source) => [source.id, source])),
    [sources],
  );
  const calendarRows = useMemo(
    () =>
      sources.flatMap((source) =>
        (calendarsBySource.get(source.id) ?? []).map((calendar) => ({
          calendar,
          source,
        })),
      ),
    [calendarsBySource, sources],
  );
  const filteredCalendarRows = useMemo(() => {
    const query = calendarQuery.trim().toLowerCase();
    if (!query) return calendarRows;
    return calendarRows.filter(({ calendar, source }) =>
      calendarSettingsSearchText(calendar, source).includes(query),
    );
  }, [calendarQuery, calendarRows]);
  const totalCalendars = calendarRows.length;
  const visibleCalendars = calendarRows.filter(({ calendar }) =>
    visible.has(calendar.id),
  ).length;
  const writableCalendars = calendars.filter(
    (calendar) => calendar.allowsModifications,
  );
  const effectiveDefaultEventCalendarId = writableCalendars.some(
    (calendar) => calendar.id === defaultEventCalendarId,
  )
    ? defaultEventCalendarId
    : "";
  const effectiveDefaultEventCalendar = effectiveDefaultEventCalendarId
    ? writableCalendars.find(
        (calendar) => calendar.id === effectiveDefaultEventCalendarId,
      )
    : undefined;
  const defaultEventCalendarSource = effectiveDefaultEventCalendar
    ? sourceById.get(effectiveDefaultEventCalendar.sourceId)
    : undefined;
  const defaultEventCalendarLabel = effectiveDefaultEventCalendar
    ? `${defaultEventCalendarSource ? `${defaultEventCalendarSource.title} / ` : ""}${
        effectiveDefaultEventCalendar.title
      }`
    : "First writable calendar";

  function archiveCalendar(calendar: Calendar) {
    if (confirmArchiveCalendarId !== calendar.id) {
      setConfirmArchiveCalendarId(calendar.id);
      return;
    }
    onArchiveLocalCalendar(calendar.id);
    setConfirmArchiveCalendarId(null);
  }

  return (
    <section className="calendar-settings-panel" aria-label="Calendar settings">
      <header className="calendar-settings-panel__header">
        <div>
          <strong>Calendar Settings</strong>
          <span>
            {visibleCalendars}/{totalCalendars} visible ·{" "}
            {calendarTimeZoneLabel(timeZone)}
          </span>
        </div>
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Close
        </button>
      </header>

      <div className="calendar-settings-panel__tabs" role="tablist">
        {(["accounts", "calendars", "defaults", "publish"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            data-active={activeTab === tab ? "true" : undefined}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "accounts"
              ? "Accounts"
              : tab === "calendars"
                ? "Calendars"
                : tab === "defaults"
                  ? "Defaults"
                  : "Publish"}
          </button>
        ))}
      </div>

      <div className="calendar-settings-panel__quick-actions">
        <button type="button" className="btn" onClick={onCreateLocalCalendar}>
          <Plus absoluteStrokeWidth size={13} strokeWidth={1.8} />
          Workspace calendar
        </button>
        <button type="button" className="btn" onClick={onOpenAccountSettings}>
          <ExternalLink absoluteStrokeWidth size={13} strokeWidth={1.8} />
          macOS Accounts
        </button>
        <button type="button" className="btn btn--ghost" onClick={onRefreshAccounts}>
          <RefreshCw absoluteStrokeWidth size={13} strokeWidth={1.8} />
          Refresh
        </button>
      </div>

      {activeTab === "accounts" ? (
        <div className="calendar-settings-panel__accounts">
          {sources.map((source) => {
            const sourceCalendars = calendarsBySource.get(source.id) ?? [];
            const summary = summarizeSourceVisibility(sourceCalendars, visible);
            const nextVisible = summary.state !== "visible";
            return (
              <article
                className="calendar-settings-account"
                key={source.id}
                data-state={summary.state}
              >
                <header className="calendar-settings-account__header">
                  <div>
                    <strong>{source.title}</strong>
                    <span>
                      {sourceTypeLabel(source.sourceType)} ·{" "}
                      {sourceManagementLabel(source)} · {summary.countLabel}
                    </span>
                  </div>
                  <div className="calendar-settings-account__actions">
                    {sourceCalendars.length > 0 ? (
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() => onSetSourceVisible(source.id, nextVisible)}
                      >
                        {nextVisible ? (
                          <Eye absoluteStrokeWidth size={13} strokeWidth={1.8} />
                        ) : (
                          <EyeOff absoluteStrokeWidth size={13} strokeWidth={1.8} />
                        )}
                        {summary.toggleLabel}
                      </button>
                    ) : null}
                    {sourceCanOpenSystemSettings(source) ? (
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={onOpenAccountSettings}
                      >
                        <Settings absoluteStrokeWidth size={13} strokeWidth={1.8} />
                        Manage
                      </button>
                    ) : null}
                  </div>
                </header>
                {sourceCalendars.length === 0 ? (
                  <div className="calendar-settings-account__empty">
                    <span>No calendars.</span>
                    {sourceCanOpenSystemSettings(source) ? (
                      <button
                        type="button"
                        className="btn"
                        onClick={onOpenAccountSettings}
                      >
                        Manage
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn"
                        onClick={onCreateLocalCalendar}
                      >
                        Create
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="calendar-settings-account__list">
                    {sourceCalendars.map((calendar) => {
                      const capability = calendarCapability(calendar);
                      return (
                        <label
                          className="calendar-settings-account__calendar"
                          key={calendar.id}
                        >
                          <input
                            type="checkbox"
                            checked={visible.has(calendar.id)}
                            onChange={(event) =>
                              onSetCalendarVisible(
                                calendar.id,
                                event.currentTarget.checked,
                              )
                            }
                          />
                          <span
                            className="calendar-settings-calendar__swatch"
                            style={{ background: calendar.colorHex }}
                            aria-hidden="true"
                          />
                          <span className="calendar-settings-calendar__title">
                            {calendar.title}
                          </span>
                          <span
                            className="calendar-settings-calendar__meta"
                            data-tone={capability.tone}
                          >
                            {visible.has(calendar.id) ? capability.label : "Hidden"}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : null}

      {activeTab === "calendars" ? (
        <div className="calendar-settings-panel__calendars">
          <label className="calendar-settings-search">
            <Search absoluteStrokeWidth size={13} strokeWidth={1.8} />
            <input
              type="search"
              value={calendarQuery}
              placeholder="Search calendars"
              onChange={(event) => setCalendarQuery(event.currentTarget.value)}
            />
          </label>
          <div className="calendar-settings-calendar-list">
            {filteredCalendarRows.map(({ calendar, source }) => {
              const capability = calendarCapability(calendar);
              const calendarVisible = visible.has(calendar.id);
              const confirming = confirmArchiveCalendarId === calendar.id;
              return (
                <article className="calendar-settings-calendar-row" key={calendar.id}>
                  <label className="calendar-settings-calendar-row__main">
                    <input
                      type="checkbox"
                      checked={calendarVisible}
                      onChange={(event) =>
                        onSetCalendarVisible(calendar.id, event.currentTarget.checked)
                      }
                    />
                    <span
                      className="calendar-settings-calendar__swatch"
                      style={{ background: calendar.colorHex }}
                      aria-hidden="true"
                    />
                    <span className="calendar-settings-calendar-row__copy">
                      <strong>{calendar.title}</strong>
                      <span>
                        {source.title} · {capability.label}
                      </span>
                    </span>
                  </label>
                  <div className="calendar-settings-calendar-row__actions">
                    {capability.canEditAppearance ? (
                      <>
                        <label className="calendar-settings-inline-field">
                          <span>Name</span>
                          <input
                            type="text"
                            defaultValue={calendar.title}
                            onBlur={(event) => {
                              const next = event.currentTarget.value.trim();
                              if (next && next !== calendar.title) {
                                onRenameLocalCalendar(calendar.id, next);
                              }
                              if (!next) event.currentTarget.value = calendar.title;
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                event.currentTarget.blur();
                              }
                              if (event.key === "Escape") {
                                event.currentTarget.value = calendar.title;
                                event.currentTarget.blur();
                              }
                            }}
                          />
                        </label>
                        <label
                          className="calendar-settings-icon-field"
                          title="Change color"
                        >
                          <Palette absoluteStrokeWidth size={13} strokeWidth={1.8} />
                          <input
                            type="color"
                            value={calendar.colorHex}
                            onChange={(event) =>
                              onRecolorLocalCalendar(
                                calendar.id,
                                event.currentTarget.value,
                              )
                            }
                            aria-label={`Color for ${calendar.title}`}
                          />
                        </label>
                      </>
                    ) : sourceCanOpenSystemSettings(sourceById.get(calendar.sourceId) ?? source) ? (
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={onOpenAccountSettings}
                      >
                        <ExternalLink absoluteStrokeWidth size={13} strokeWidth={1.8} />
                        Manage
                      </button>
                    ) : null}
                    {capability.canArchive ? (
                      <button
                        type="button"
                        className="btn btn--danger"
                        onClick={() => archiveCalendar(calendar)}
                      >
                        <Archive absoluteStrokeWidth size={13} strokeWidth={1.8} />
                        {confirming ? "Confirm" : "Archive"}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}

      {activeTab === "defaults" ? (
        <div className="calendar-settings-panel__defaults">
          <label
            className="calendar-settings-panel__timezone"
            title={`Times shown in ${calendarTimeZoneLabel(timeZone)}`}
          >
            <span>Display time zone</span>
            <strong className="calendar-settings-panel__timezone-value">
              {calendarTimeZoneLabel(timeZone)}
            </strong>
            <select
              value={timeZone}
              aria-label="Display time zone"
              title={calendarTimeZoneLabel(timeZone)}
              onChange={(event) => onTimeZoneChange(event.currentTarget.value)}
            >
              {CALENDAR_TIME_ZONE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label
            className="calendar-settings-panel__timezone"
            title={defaultEventCalendarLabel}
          >
            <span>New events</span>
            <strong className="calendar-settings-panel__timezone-value">
              {defaultEventCalendarLabel}
            </strong>
            <select
              value={effectiveDefaultEventCalendarId}
              aria-label="Default calendar for new events"
              title={defaultEventCalendarLabel}
              onChange={(event) =>
                onDefaultEventCalendarChange(event.currentTarget.value)
              }
            >
              <option value="">First writable calendar</option>
              {writableCalendars.map((calendar) => {
                const source = sourceById.get(calendar.sourceId);
                return (
                  <option key={calendar.id} value={calendar.id}>
                    {source ? `${source.title} / ` : ""}
                    {calendar.title}
                  </option>
                );
              })}
            </select>
          </label>
          <div className="calendar-settings-note">
            <strong>Account ownership</strong>
            <span>
              Workspace can hide external calendars here. Adding or deleting iCloud,
              Google, Exchange, and subscribed accounts stays in macOS.
            </span>
          </div>
          <div className="calendar-settings-note">
            <strong>Local calendars</strong>
            <span>
              Workspace calendars are local-first and can be renamed, recolored, or
              archived from this panel.
            </span>
          </div>
        </div>
      ) : null}

      {activeTab === "publish" ? (
        <div className="calendar-settings-panel__publish">{publishPanel}</div>
      ) : null}
    </section>
  );
}
