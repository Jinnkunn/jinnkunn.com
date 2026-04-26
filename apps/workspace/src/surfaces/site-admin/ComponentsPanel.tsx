import { useCallback } from "react";

import { ComponentEditor, type ComponentName } from "./ComponentEditor";
import { PublishButton } from "./PublishButton";
import { useSiteAdmin } from "./state";

const COMPONENT_LABELS: Record<ComponentName, string> = {
  news: "News",
  teaching: "Teaching",
  publications: "Publications",
  works: "Works",
};

export interface ComponentsPanelProps {
  /** Which component is being edited (driven by the sidebar nav
   * leaf id "components:news" / "components:teaching" / …). `null`
   * shows the empty state. */
  selected: ComponentName | null;
  onSelectedChange: (next: ComponentName | null) => void;
}

/** Components admin panel — sibling of Posts/Pages but for the four
 * reusable MDX widgets (News / Teaching / Publications / Works). The
 * sidebar tree (Components → leaf) drives selection, matching the
 * Phase 2 single-column shape the other panels use. */
export function ComponentsPanel({
  selected,
  onSelectedChange,
}: ComponentsPanelProps) {
  const { bumpContentRevision } = useSiteAdmin();

  // Saving / deleting bumps contentRevision so any other panel that
  // caches component-derived data refreshes. Currently a no-op for
  // the sidebar (component leaves are static), but matches the
  // pattern Posts/Pages use for symmetry.
  const onEditorExit = useCallback(
    (action: "saved" | "deleted" | "cancel") => {
      onSelectedChange(null);
      if (action !== "cancel") bumpContentRevision();
    },
    [onSelectedChange, bumpContentRevision],
  );

  const body =
    selected === null ? (
      <div className="panel-empty">
        <p>Select a component from the sidebar to edit it.</p>
      </div>
    ) : (
      <ComponentEditor
        name={selected}
        onExit={onEditorExit}
        key={selected}
      />
    );

  const title = selected === null ? "Components" : COMPONENT_LABELS[selected];

  return (
    <section className="panel-shell">
      <header className="panel-shell__header">
        <div className="panel-shell__titleblock">
          <h1 className="panel-shell__title">{title}</h1>
          <p className="panel-shell__description">
            Reusable MDX widgets embedded into pages via shortcodes
            like &lt;NewsBlock /&gt;. Source lives at
            content/components/*.mdx.
          </p>
        </div>
        <div className="panel-shell__actions">
          <PublishButton />
        </div>
      </header>
      <div className="panel-shell__body">{body}</div>
    </section>
  );
}
