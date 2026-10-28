import type { PublicationReview } from "@/lib/shared/publication-snapshot";
import type { PublicationFieldChange } from "@/lib/shared/publication-review-details";
import styles from "./site-admin-dashboard.module.css";

function FieldChanges({ fields, beforeLabel, afterLabel }: { fields: PublicationFieldChange[]; beforeLabel: string; afterLabel: string }) {
  return <dl className={styles.publicationFields}>
    {fields.map((field, index) => <div key={`${field.label}-${index}`}>
      <dt>{field.label}</dt>
      <dd className={styles.publicationDiff}>
        <div><small>{beforeLabel}</small><p>{field.before || "Not set"}</p></div>
        <div><small>{afterLabel}</small><p>{field.after || "Removed"}</p></div>
      </dd>
    </div>)}
  </dl>;
}

export function SiteAdminPublicationChanges({ changes, beforeLabel = "Published", afterLabel = "Saved draft" }: { changes: PublicationReview["changes"]; beforeLabel?: string; afterLabel?: string }) {
  return <ul className={styles.publishReviewList}>
    {changes.map((item) => <li key={item.path}>
      <h3 className={styles.reviewHeading}>{item.title} <small>· {item.kind}</small></h3>
      {item.details ? <>
        <p className={styles.cardText}>{item.details.summary}</p>
        <p className={styles.editorHint}>Affects: {item.details.siteWide ? "public pages across the site" : item.details.routes.join(", ") || "content layout"}</p>
        <FieldChanges fields={item.details.fields} beforeLabel={beforeLabel} afterLabel={afterLabel} />
        <ul className={styles.publicationEntries}>
          {item.details.entries.map((entry, index) => <li key={`${entry.kind}-${index}`}>
            <details><summary>{entry.kind === "added" ? "Added" : entry.kind === "deleted" ? "Removed" : "Updated"}: <strong>{entry.title}</strong></summary>
              <FieldChanges fields={entry.fields} beforeLabel={beforeLabel} afterLabel={afterLabel} />
            </details>
          </li>)}
        </ul>
      </> : null}
      <details className={styles.publicationSource}><summary>Advanced source comparison</summary>
        <p className={styles.editorHint}>{item.oldPath ? `${item.oldPath} → ` : ""}{item.path}</p>
        <div className={styles.publicationDiff}>
          <div><h4>{beforeLabel}</h4><pre>{item.before || "Not present"}</pre></div>
          <div><h4>{afterLabel}</h4><pre>{item.after || "Removed"}</pre></div>
        </div>
      </details>
    </li>)}
  </ul>;
}
