"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CollectionTermField } from "./site-admin-collection-fields";
import { SiteAdminActionDialog } from "./site-admin-action-dialog";
import { formatMonthRangePeriod, parseMonthRangePeriod } from "./site-admin-month-range";
import { parseTeachingTerm } from "./site-admin-teaching-term";
import styles from "./site-admin-dashboard.module.css";

export type CollectionGroupEdit =
  | { kind: "teaching"; term: string | null; role: string; period: string; count: number }
  | { kind: "publications"; year: string; count: number }
  | { kind: "works"; category: "recent" | "passed"; count: number };

export type CollectionGroupChange = {
  label: string;
  role: string;
  period: string;
  fillEmpty: boolean;
};

export function SiteAdminCollectionGroupDialog({ group, onClose, onApply }: {
  group: CollectionGroupEdit;
  onClose: () => void;
  onApply: (change: CollectionGroupChange) => void;
}) {
  const [label, setLabel] = useState(group.kind === "teaching"
    ? group.term ?? ""
    : group.kind === "publications" ? group.year : group.category === "recent" ? "passed" : "recent");
  const [role, setRole] = useState(group.kind === "teaching" ? group.role : "");
  const [period, setPeriod] = useState(group.kind === "teaching" ? group.period : "");
  const [range, setRange] = useState(() => parseMonthRangePeriod(group.kind === "teaching" ? group.period : ""));
  const [fillEmpty, setFillEmpty] = useState(false);
  const title = group.kind === "teaching" ? group.term === null ? "New term" : "Edit term"
    : group.kind === "publications" ? "Edit publication year" : "Move work group";
  const parsedTerm = parseTeachingTerm(label.trim());
  const valid = Boolean(label.trim()) && (group.kind !== "publications" || /^\d{4}(?: and Before)?$/.test(label.trim()))
    && (group.kind !== "teaching" || (!parsedTerm || Boolean(parsedTerm.season)))
    && (group.kind !== "teaching" || !range.valid || (!range.end || Boolean(range.start)) && (!range.end || range.end >= range.start));
  return <SiteAdminActionDialog title={title} onClose={onClose}>
    <form onSubmit={(event) => { event.preventDefault(); if (valid) onApply({ label: label.trim(), role, period: range.valid ? formatMonthRangePeriod(range) : period, fillEmpty }); }}>
      {group.kind === "teaching" ? <>
        <CollectionTermField value={label} onChange={setLabel} disabled={false} />
        <fieldset className={styles.collectionFieldGroup}>
          <legend>New course defaults</legend>
          <label className={styles.fieldLabel}>Role<input className={styles.textField} value={role} onChange={(event) => setRole(event.target.value)} /></label>
          {range.valid ? <div className={styles.collectionTermFields}>
            <label className={styles.fieldLabel}>Start month<input type="month" className={styles.textField} value={range.start} onChange={(event) => setRange({ ...range, start: event.target.value })} /></label>
            <label className={styles.fieldLabel}>End month<input type="month" className={styles.textField} value={range.end} disabled={range.ongoing} onChange={(event) => setRange({ ...range, end: event.target.value })} /></label>
            <label className={styles.checkboxField}><input type="checkbox" checked={range.ongoing} onChange={(event) => setRange({ ...range, ongoing: event.target.checked, end: "" })} />Ongoing</label>
          </div> : <label className={styles.fieldLabel}>Period<input className={styles.textField} value={period} onChange={(event) => setPeriod(event.target.value)} /></label>}
        </fieldset>
        {group.term !== null ? <label className={styles.checkboxField}><input type="checkbox" checked={fillEmpty} onChange={(event) => setFillEmpty(event.target.checked)} />Fill empty role and period in existing courses</label> : null}
      </> : group.kind === "publications" ? <label className={styles.fieldLabel}>Year<input className={styles.textField} inputMode="numeric" value={label} onChange={(event) => setLabel(event.target.value)} required pattern="[0-9]{4}( and Before)?" /></label>
        : <label className={styles.fieldLabel}>Move to<select className={styles.textField} value={label} onChange={(event) => setLabel(event.target.value)}><option value="recent">Recent</option><option value="passed">Past</option></select></label>}
      {group.count > 0 ? <p className={styles.cardText}>{group.count} {group.kind === "teaching" ? "courses" : group.kind === "works" ? "roles" : "publications"} in this group</p> : null}
      <div className={styles.conflictActions}>
        <Button variant="subtle" onClick={onClose}>Cancel</Button>
        <Button type="submit" tone="accent" disabled={!valid}>{group.kind === "teaching" && group.term === null ? "Create term and add course" : "Apply to group"}</Button>
      </div>
    </form>
  </SiteAdminActionDialog>;
}
