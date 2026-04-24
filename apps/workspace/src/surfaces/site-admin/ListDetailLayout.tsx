import type { ReactNode } from "react";

export interface ListDetailLayoutProps {
  /** Page title, e.g. "Posts". */
  title: string;
  /** Optional one-line description under the title. */
  description?: string;
  /** Right-aligned action cluster in the header, e.g. "New post" button. */
  headerActions?: ReactNode;
  /** Optional bar above the list — drafts filter, refresh, row count. */
  listHeader?: ReactNode;
  /** The list column body. Responsible for rendering selectable rows. */
  list: ReactNode;
  /** The detail column body. Shows an empty-state, a loading state, or an
   * editor — caller decides based on its own selection state. */
  detail: ReactNode;
  /** Optional error banner rendered under the header. */
  error?: string;
  /** Override list column width, default "300px". */
  listWidth?: string;
}

/** Two-column list + detail shell used by Posts and Pages. Keeps the list
 * visible while an item is being edited — the Mail.app / Linear / Notion
 * side-by-side pattern — so jumping between entries is a single click
 * instead of "back out, re-scroll, re-open." */
export function ListDetailLayout({
  title,
  description,
  headerActions,
  listHeader,
  list,
  detail,
  error,
  listWidth = "300px",
}: ListDetailLayoutProps) {
  return (
    <section className="list-detail">
      <header className="list-detail__header">
        <div className="list-detail__titleblock">
          <h1 className="list-detail__title">{title}</h1>
          {description && <p className="list-detail__description">{description}</p>}
        </div>
        {headerActions && (
          <div className="list-detail__actions">{headerActions}</div>
        )}
      </header>
      {error && <p className="list-detail__error">{error}</p>}
      <div
        className="list-detail__grid"
        style={{ gridTemplateColumns: `${listWidth} minmax(0, 1fr)` }}
      >
        <aside className="list-detail__list">
          {listHeader && (
            <div className="list-detail__list-header">{listHeader}</div>
          )}
          <div className="list-detail__list-body">{list}</div>
        </aside>
        <div className="list-detail__detail">{detail}</div>
      </div>
    </section>
  );
}
