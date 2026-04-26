import { useCallback } from "react";
import { PageEditor } from "./PageEditor";
import { PublishButton } from "./PublishButton";
import { useSiteAdmin } from "./state";
import type { ItemSelection } from "./types";

export interface PagesPanelProps {
  selected: ItemSelection;
  onSelectedChange: (next: ItemSelection) => void;
}

/** Pages panel — Phase 2 dropped the left list column. The sidebar
 * tree (Home → page leaves + nested folders) drives selection;
 * this panel just renders the editor for `selected`. */
export function PagesPanel({ selected, onSelectedChange }: PagesPanelProps) {
  const { bumpContentRevision, connection } = useSiteAdmin();
  const ready = Boolean(connection.baseUrl) && Boolean(connection.authToken);

  const onEditorExit = useCallback(
    (action: "saved" | "deleted" | "cancel") => {
      onSelectedChange(null);
      if (action !== "cancel") bumpContentRevision();
    },
    [onSelectedChange, bumpContentRevision],
  );

  let body: React.ReactNode;
  if (selected === null) {
    body = (
      <div className="panel-empty">
        <p>Select a page from the sidebar, or start a new one.</p>
        <button
          className="btn btn--primary"
          type="button"
          onClick={() => onSelectedChange({ kind: "new" })}
          disabled={!ready}
        >
          New page
        </button>
      </div>
    );
  } else if (selected.kind === "new") {
    // initialSlug lets the sidebar's "+ on a folder" affordance prefill
    // the slug field with the parent path (e.g. "docs/").
    body = (
      <PageEditor
        mode="create"
        slug={selected.initialSlug}
        onExit={onEditorExit}
      />
    );
  } else {
    body = (
      <PageEditor
        mode="edit"
        slug={selected.slug}
        onExit={onEditorExit}
        key={selected.slug}
      />
    );
  }

  return (
    <section className="panel-shell">
      <header className="panel-shell__header">
        <div className="panel-shell__titleblock">
          <h1 className="panel-shell__title">Pages</h1>
          <p className="panel-shell__description">
            Standalone MDX pages under content/pages/*.mdx.
          </p>
        </div>
        <div className="panel-shell__actions">
          <button
            className="btn btn--primary"
            type="button"
            onClick={() => onSelectedChange({ kind: "new" })}
            disabled={!ready}
          >
            New page
          </button>
          <PublishButton />
        </div>
      </header>
      <div className="panel-shell__body">{body}</div>
    </section>
  );
}
