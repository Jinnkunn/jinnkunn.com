import type { ChangeEvent, DragEvent, KeyboardEvent, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { SiteAdminMarkdownEditor } from "./site-admin-markdown-editor";
import {
  formatMonthRangePeriod,
  parseMonthRangePeriod,
} from "./site-admin-month-range";
import {
  componentEntryDomId,
  type ComponentEntryIssue,
  type ComponentGrouping,
} from "./site-admin-structured-collection-model";
import type { StructuredCollectionFieldSchema } from "./site-admin-structured-collection-schema";
import styles from "./site-admin-dashboard.module.css";

type MoveDirection = -1 | 1;

type StructuredCollectionEditorProps = {
  title: string;
  description: string;
  count: number;
  entryLabel: string;
  addLabel: string;
  onAdd: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  grouping: ComponentGrouping;
  onGroupingChange: (value: ComponentGrouping) => void;
  visibleEntryIds: string[];
  expandedEntryIds: string[];
  onExpandedEntryIdsChange: (value: string[]) => void;
  issueCount: number;
  onReviewIssues: () => void;
  onReviewPreviousIssue: () => void;
  onReviewNextIssue: () => void;
  source: {
    fileName: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    disabled: boolean;
  };
  children: ReactNode;
};

type StructuredCollectionEntryProps = {
  id: string;
  groupLabel: string;
  previousGroupLabel: string;
  grouping: ComponentGrouping;
  title: string;
  detail: string;
  state: string;
  issues: ComponentEntryIssue[];
  expanded: boolean;
  dragging: boolean;
  dropTarget: boolean;
  dragDisabled: boolean;
  index: number;
  count: number;
  onToggle: () => void;
  onMove: (direction: MoveDirection) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  children: ReactNode;
};

type StructuredCollectionDividerProps = {
  dragging: boolean;
  dropTarget: boolean;
  dragDisabled: boolean;
  index: number;
  count: number;
  onMove: (direction: MoveDirection) => void;
  onDelete: () => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
};

export function StructuredCollectionEditor({
  title,
  description,
  count,
  entryLabel,
  addLabel,
  onAdd,
  secondaryLabel,
  onSecondary,
  search,
  onSearchChange,
  grouping,
  onGroupingChange,
  visibleEntryIds,
  expandedEntryIds,
  onExpandedEntryIdsChange,
  issueCount,
  onReviewIssues,
  onReviewPreviousIssue,
  onReviewNextIssue,
  source,
  children,
}: StructuredCollectionEditorProps) {
  const handleEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    if (event.key === "ArrowUp") onReviewPreviousIssue();
    else onReviewNextIssue();
  };

  return (
    <div className={styles.newsEditor} onKeyDown={handleEditorKeyDown}>
      <div className={styles.componentCollectionHeader}>
        <div className={styles.componentCollectionIntro}>
          <p className={styles.cardLabel}>Structured entries</p>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <div className={styles.componentCollectionTools}>
          <label className={styles.componentSearchField}>
            <span className={styles.visuallyHidden}>Search {entryLabel}</span>
            <input
              className={styles.textField}
              type="search"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={`Search ${entryLabel}`}
            />
          </label>
          <span className={styles.collectionCount}>
            {count} {entryLabel}
          </span>
          <div className={styles.componentViewControls}>
            <label>
              <span className={styles.visuallyHidden}>Group entries</span>
              <select
                value={grouping}
                onChange={(event) =>
                  onGroupingChange(event.target.value === "none" ? "none" : "auto")
                }
                aria-label="Group entries"
              >
                <option value="auto">Grouped</option>
                <option value="none">No groups</option>
              </select>
            </label>
            <Button
              onClick={() => onExpandedEntryIdsChange(visibleEntryIds)}
              variant="subtle"
              size="sm"
              disabled={visibleEntryIds.length === 0}
            >
              Expand all
            </Button>
            <Button
              onClick={() => onExpandedEntryIdsChange([])}
              variant="subtle"
              size="sm"
              disabled={expandedEntryIds.length === 0}
            >
              Collapse
            </Button>
            {issueCount > 0 ? (
              <div className={styles.collectionIssueControls}>
                <Button
                  onClick={onReviewPreviousIssue}
                  variant="subtle"
                  tone="warning"
                  size="sm"
                  title="Previous issue (Option + Up)"
                  aria-label="Previous issue"
                >
                  ↑
                </Button>
                <Button onClick={onReviewIssues} variant="subtle" tone="warning" size="sm">
                  Review {issueCount}
                </Button>
                <Button
                  onClick={onReviewNextIssue}
                  variant="subtle"
                  tone="warning"
                  size="sm"
                  title="Next issue (Option + Down)"
                  aria-label="Next issue"
                >
                  ↓
                </Button>
              </div>
            ) : null}
          </div>
          <div className={styles.panelActions}>
            {secondaryLabel && onSecondary ? (
              <Button onClick={onSecondary} variant="subtle" size="sm">
                {secondaryLabel}
              </Button>
            ) : null}
            <Button onClick={onAdd} tone="accent" size="sm">
              {addLabel}
            </Button>
          </div>
        </div>
      </div>
      <div className={styles.newsEntryList}>{children}</div>
      <details className={styles.editorDetails}>
        <summary>
          <span>Advanced component source</span>
          <small>{source.fileName}</small>
        </summary>
        <div className={styles.editorDetailsBody}>
          <SiteAdminMarkdownEditor
            label={source.label}
            value={source.value}
            onChange={source.onChange}
            minHeight={420}
            size="large"
            disabled={source.disabled}
            initialMode="source"
            visualEditing={false}
          />
        </div>
      </details>
    </div>
  );
}

export function StructuredCollectionGroup({
  label,
  previousLabel,
  grouping,
  dropTarget = false,
  onDragOver,
  onDrop,
}: {
  label: string;
  previousLabel: string;
  grouping: ComponentGrouping;
  dropTarget?: boolean;
  onDragOver?: (event: DragEvent<HTMLElement>) => void;
  onDrop?: (event: DragEvent<HTMLElement>) => void;
}) {
  if (grouping === "none" || !label || label === previousLabel) return null;
  return (
    <div
      className={styles.collectionGroupHeading}
      data-drop-target={dropTarget}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {label}
    </div>
  );
}

export function StructuredCollectionEntry({
  id,
  groupLabel,
  previousGroupLabel,
  grouping,
  title,
  detail,
  state,
  issues,
  expanded,
  dragging,
  dropTarget,
  dragDisabled,
  index,
  count,
  onToggle,
  onMove,
  onDuplicate,
  onDelete,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  children,
}: StructuredCollectionEntryProps) {
  return (
    <>
      <StructuredCollectionGroup
        label={groupLabel}
        previousLabel={previousGroupLabel}
        grouping={grouping}
        dropTarget={dropTarget}
        onDragOver={onDragOver}
        onDrop={onDrop}
      />
      <details
        id={componentEntryDomId(id)}
        className={styles.newsEntryCard}
        open={expanded}
        data-dragging={dragging}
        data-drop-target={dropTarget}
        data-invalid={issues.length > 0}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <summary
          className={styles.collectionEntrySummary}
          onClick={(event) => {
            event.preventDefault();
            onToggle();
          }}
        >
          <CollectionDragHandle
            disabled={dragDisabled}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
          <strong>{title}</strong>
          <CollectionEntryMeta detail={detail} state={state} issueCount={issues.length} />
        </summary>
        <CollectionEntryActions
          index={index}
          count={count}
          reorderDisabled={dragDisabled}
          onMove={onMove}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
        {children}
      </details>
    </>
  );
}

export function StructuredCollectionDivider({
  dragging,
  dropTarget,
  dragDisabled,
  index,
  count,
  onMove,
  onDelete,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: StructuredCollectionDividerProps) {
  return (
    <div
      className={styles.newsDividerRow}
      data-dragging={dragging}
      data-drop-target={dropTarget}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <span className={styles.newsDividerLabel}>
        <CollectionDragHandle
          disabled={dragDisabled}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
        Divider
      </span>
      <div className={styles.historyActions}>
        <Button
          onClick={() => onMove(-1)}
          variant="subtle"
          size="sm"
          disabled={dragDisabled || index === 0}
        >
          Up
        </Button>
        <Button
          onClick={() => onMove(1)}
          variant="subtle"
          size="sm"
          disabled={dragDisabled || index === count - 1}
        >
          Down
        </Button>
        <Button onClick={onDelete} variant="subtle" tone="danger" size="sm">
          Delete
        </Button>
      </div>
    </div>
  );
}

export function StructuredCollectionEmpty({
  noun,
  searching,
}: {
  noun: string;
  searching: boolean;
}) {
  return (
    <div className={styles.collectionEmpty}>
      <strong>{searching ? `No matching ${noun}` : `No ${noun} yet`}</strong>
      <span>
        {searching
          ? "Try a different title, date, or metadata value."
          : "Add the first entry to populate this collection."}
      </span>
    </div>
  );
}

export function StructuredCollectionFieldIssue({
  issue,
}: {
  issue: ComponentEntryIssue | undefined;
}) {
  return issue ? <small className={styles.fieldError}>{issue.message}</small> : null;
}

export function StructuredCollectionEntryForm<T extends { id: string }>({
  item,
  fields,
  issues,
  disabled,
  onChange,
  onComplete,
}: {
  item: T;
  fields: readonly StructuredCollectionFieldSchema<T>[];
  issues: ComponentEntryIssue[];
  disabled: boolean;
  onChange: (next: T) => void;
  onComplete: () => void;
}) {
  const issueFor = (field: string) => issues.find((issue) => issue.field === field);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
    event.preventDefault();
    onComplete();
  };

  return (
    <div
      className={styles.componentEntryGrid}
      data-structured-entry-form={item.id}
      onKeyDown={handleKeyDown}
    >
      {fields.map((field) => {
        const issue = issueFor(field.key);
        const value = field.read(item);
        const fieldOptions =
          typeof field.options === "function" ? field.options(item) : field.options || [];
        const className = field.control === "textarea" ? styles.newsEntryBody : styles.textField;
        const common = {
          className,
          value,
          disabled,
          placeholder: field.placeholder,
          "data-component-field": field.key,
          "aria-invalid": Boolean(issue),
          onChange: (
            event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
          ) => onChange(field.write(item, event.target.value)),
        };

        if (field.control === "month-range") {
          const range = parseMonthRangePeriod(value);
          const writeRange = (next: {
            start: string;
            end: string;
            ongoing: boolean;
          }) => onChange(field.write(item, formatMonthRangePeriod(next)));

          return (
            <fieldset
              className={`${styles.fieldLabel} ${styles.monthRangeField}${
                field.wide ? ` ${styles.componentFieldWide}` : ""
              }`}
              key={field.key}
            >
              <legend>{field.label}</legend>
              <div className={styles.monthRangeControl}>
                <label className={styles.monthRangeSegment}>
                  <span>Start</span>
                  <input
                    className={styles.textField}
                    type="month"
                    value={range.start}
                    disabled={disabled}
                    data-component-field={field.key}
                    aria-invalid={Boolean(issue)}
                    aria-label={`${field.label} start month`}
                    onChange={(event) =>
                      writeRange({ ...range, start: event.target.value })
                    }
                  />
                </label>
                <span className={styles.monthRangeSeparator} aria-hidden="true">
                  to
                </span>
                <label className={styles.monthRangeSegment}>
                  <span>End</span>
                  <input
                    className={styles.textField}
                    type="month"
                    value={range.end}
                    disabled={disabled || range.ongoing}
                    aria-label={`${field.label} end month`}
                    onChange={(event) =>
                      writeRange({ ...range, end: event.target.value })
                    }
                  />
                </label>
                <label className={styles.monthRangeOngoing}>
                  <input
                    type="checkbox"
                    checked={range.ongoing}
                    disabled={disabled}
                    onChange={(event) =>
                      writeRange({ ...range, ongoing: event.target.checked })
                    }
                  />
                  <span>Ongoing</span>
                </label>
              </div>
              <StructuredCollectionFieldIssue issue={issue} />
            </fieldset>
          );
        }

        return (
          <label
            className={`${styles.fieldLabel}${field.wide ? ` ${styles.componentFieldWide}` : ""}`}
            key={field.key}
          >
            {field.label}
            {field.control === "textarea" ? (
              <textarea {...common} />
            ) : field.control === "select" ? (
              <select {...common}>
                {fieldOptions.map((option) => (
                  <option key={`${field.key}-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input {...common} type={field.inputType || "text"} />
            )}
            <StructuredCollectionFieldIssue issue={issue} />
          </label>
        );
      })}
      <small className={styles.collectionShortcutHint}>⌘↵ Done</small>
    </div>
  );
}

function CollectionEntryActions({
  index,
  count,
  onMove,
  onDuplicate,
  onDelete,
  reorderDisabled,
}: {
  index: number;
  count: number;
  onMove: (direction: MoveDirection) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  reorderDisabled: boolean;
}) {
  return (
    <div className={styles.historyActions}>
      <Button
        onClick={() => onMove(-1)}
        variant="subtle"
        size="sm"
        disabled={reorderDisabled || index === 0}
      >
        Up
      </Button>
      <Button
        onClick={() => onMove(1)}
        variant="subtle"
        size="sm"
        disabled={reorderDisabled || index === count - 1}
      >
        Down
      </Button>
      <Button onClick={onDuplicate} variant="subtle" size="sm">
        Duplicate
      </Button>
      <Button onClick={onDelete} variant="subtle" tone="danger" size="sm">
        Delete
      </Button>
    </div>
  );
}

function CollectionEntryMeta({
  detail,
  state,
  issueCount,
}: {
  detail: string;
  state: string;
  issueCount: number;
}) {
  return (
    <span className={styles.collectionEntryMeta}>
      <small>{detail}</small>
      <span
        className={styles.entryReadiness}
        data-state={issueCount > 0 ? "invalid" : state.toLocaleLowerCase()}
      >
        {issueCount > 0 ? `Fix ${issueCount}` : state}
      </span>
    </span>
  );
}

function CollectionDragHandle({
  disabled,
  onDragStart,
  onDragEnd,
}: {
  disabled: boolean;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  return (
    <span
      className={styles.componentDragHandle}
      title={disabled ? "Clear search to reorder" : "Drag to reorder"}
      aria-label={disabled ? "Clear search to reorder" : "Drag to reorder"}
      role="img"
      draggable={!disabled}
      onClick={(event) => event.stopPropagation()}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      ⣿
    </span>
  );
}
