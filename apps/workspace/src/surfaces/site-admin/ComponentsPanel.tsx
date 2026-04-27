import { useCallback } from "react";

import {
  ComponentEditor,
  SITE_COMPONENT_DEFINITIONS,
  type ComponentName,
} from "./ComponentEditor";
import { PublishButton } from "./PublishButton";
import { useSiteAdmin } from "./state";

const COMPONENT_LABELS = Object.fromEntries(
  SITE_COMPONENT_DEFINITIONS.map((definition) => [
    definition.name,
    definition.label,
  ]),
) as Record<ComponentName, string>;

export interface ComponentsPanelProps {
  /** Which component is being edited (driven by the sidebar nav
   * leaf id "components:news" / "components:teaching" / …). `null`
   * shows the empty state. */
  selected: ComponentName | null;
  onSelectedChange: (next: ComponentName | null) => void;
}

/** Shared content admin panel — sibling of Posts/Pages but for the four
 * reusable collections (News / Teaching / Publications / Works). The
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
        <p>Select a shared collection from the sidebar to edit its entries.</p>
      </div>
    ) : (
      <ComponentEditor
        name={selected}
        onExit={onEditorExit}
        key={selected}
      />
    );

  const title = selected === null ? "Shared content" : COMPONENT_LABELS[selected];

  return (
    <section className="panel-shell">
      <header className="panel-shell__header">
        <div className="panel-shell__titleblock">
          <h1 className="panel-shell__title">{title}</h1>
          <p className="panel-shell__description">
            Structured collections embedded into pages with MDX blocks like
            &lt;NewsBlock /&gt;. Entries live in content/components/*.mdx.
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
