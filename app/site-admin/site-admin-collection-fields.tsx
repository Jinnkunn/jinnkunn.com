import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatTeachingTerm, parseTeachingTerm, TEACHING_SEASONS, teachingAcademicYears } from "./site-admin-teaching-term";
import styles from "./site-admin-dashboard.module.css";

export function CollectionTermField({ value, onChange, disabled }: {
  value: string; onChange: (value: string) => void; disabled: boolean;
}) {
  const parsed = parseTeachingTerm(value);
  const [custom, setCustom] = useState(Boolean(value && !parsed));
  return <fieldset className={styles.collectionFieldGroup}>
    <legend>Term</legend>
    <label className={styles.collectionCustomTerm}>
      <input type="checkbox" checked={custom} disabled={disabled} onChange={(event) => setCustom(event.target.checked)} />
      Custom term
    </label>
    {custom ? <input className={styles.textField} aria-label="Term" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} /> :
      <div className={styles.collectionTermFields}>
        <label className={styles.fieldLabel}>Academic year
          <select className={styles.textField} aria-label="Academic year" disabled={disabled} value={parsed?.year || ""}
            onChange={(event) => onChange(formatTeachingTerm(event.target.value, parsed?.season || ""))}>
            <option value="">Choose year</option>
            {teachingAcademicYears(new Date().getFullYear(), parsed?.year).map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </label>
        <label className={styles.fieldLabel}>Season
          <select className={styles.textField} aria-label="Season" disabled={disabled || !parsed?.year} value={parsed?.season || ""}
            onChange={(event) => onChange(formatTeachingTerm(parsed?.year || "", event.target.value))}>
            <option value="">Choose season</option>
            {TEACHING_SEASONS.map((season) => <option key={season} value={season}>{season}</option>)}
          </select>
        </label>
      </div>}
    {value ? <output className={styles.editorHint}>{value}</output> : null}
  </fieldset>;
}

export function CollectionListField({ label, values, onChange, disabled, placeholder }: {
  label: string; values: string[]; onChange: (values: string[]) => void; disabled: boolean; placeholder?: string;
}) {
  const id = useId();
  const [pending, setPending] = useState("");
  function commit() {
    const value = pending.trim();
    if (!value) return;
    onChange([...values, value]);
    setPending("");
  }
  return <fieldset className={styles.collectionFieldGroup}>
    <legend>{label}</legend>
    {values.length ? <ol className={styles.collectionTokens}>
      {values.map((value, index) => <li key={`${index}-${value}`}>
        <span>{value}</span>
        <Button variant="ghost" size="sm" disabled={disabled} title={`Remove ${value}`} aria-label={`Remove ${value}`}
          onClick={() => onChange(values.filter((_, position) => position !== index))}>×</Button>
      </li>)}
    </ol> : null}
    <div className={styles.collectionTokenInput}>
      <input id={id} className={styles.textField} aria-label={`Add ${label.toLowerCase()}`} disabled={disabled}
        placeholder={placeholder || label} value={pending} onChange={(event) => setPending(event.target.value)} onBlur={commit}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); commit(); } }} />
      <Button variant="subtle" size="sm" disabled={disabled || !pending.trim()} onClick={commit} aria-label={`Add ${label.toLowerCase()} value`}>+</Button>
    </div>
  </fieldset>;
}
