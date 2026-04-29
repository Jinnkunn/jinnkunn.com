import { useCallback } from "react";
import { PostEditor } from "./PostEditor";
import { useSiteAdmin } from "./state";
import type { ItemSelection } from "./types";

export interface PostsPanelProps {
  selected: ItemSelection;
  onSelectedChange: (next: ItemSelection) => void;
}

/** Posts panel — Phase 2 dropped the left list column. Selection is
 * driven entirely by the sidebar tree (Blog → posts) plus the command
 * palette; this panel just renders the editor for `selected` (or an
 * empty state when nothing is picked). */
export function PostsPanel({ selected, onSelectedChange }: PostsPanelProps) {
  const { bumpContentRevision, connection } = useSiteAdmin();
  const ready = Boolean(connection.baseUrl) && Boolean(connection.authToken);

  // Saving / deleting bumps contentRevision so SiteAdminContent's
  // eager-fetch reloads the index that backs both the sidebar tree
  // and the command palette.
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
        <p>Select a post from the sidebar, or start a new one.</p>
        <button
          className="btn btn--primary"
          type="button"
          onClick={() => onSelectedChange({ kind: "new" })}
          disabled={!ready}
        >
          New post
        </button>
      </div>
    );
  } else if (selected.kind === "new") {
    body = <PostEditor mode="create" onExit={onEditorExit} />;
  } else {
    body = (
      <PostEditor
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
          <h1 className="panel-shell__title">Blog</h1>
          <p className="panel-shell__description">
            MDX-authored blog posts under content/posts/*.mdx.
          </p>
        </div>
        <div className="panel-shell__actions">
          <button
            className="btn btn--primary"
            type="button"
            onClick={() => onSelectedChange({ kind: "new" })}
            disabled={!ready}
          >
            New post
          </button>
        </div>
      </header>
      <div className="panel-shell__body">{body}</div>
    </section>
  );
}
