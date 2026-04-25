import type { ReactNode, RefObject } from "react";

import { buildHomePreviewDocument } from "./preview-document";
import { SECTION_LABELS, sectionSummary, sectionTitle } from "./schema";
import type { useDragReorder } from "../shared/useDragReorder";
import type { HomeData, HomeSection, HomeSectionType } from "../types";
import { Button, IconButton } from "../ui";

type DragReorderApi = ReturnType<typeof useDragReorder>;
export type HomePreviewViewport = "desktop" | "tablet" | "mobile";

const VIEWPORT_LABELS: Record<HomePreviewViewport, string> = {
  desktop: "Desktop",
  tablet: "Tablet",
  mobile: "Mobile",
};

export function HomeSectionRail({
  addSection,
  getHandleProps,
  getRowProps,
  moveSection,
  onClose,
  sections,
  selectedSectionId,
  setSelectedId,
  title = "Page outline",
  variant = "panel",
}: {
  addSection: (type: HomeSectionType) => void;
  getHandleProps: DragReorderApi["getHandleProps"];
  getRowProps: DragReorderApi["getRowProps"];
  moveSection: (index: number, direction: -1 | 1) => void;
  onClose?: () => void;
  sections: HomeSection[];
  selectedSectionId: string;
  setSelectedId: (id: string) => void;
  title?: string;
  variant?: "drawer" | "panel";
}) {
  return (
    <aside
      className={`home-builder__rail home-builder__rail--${variant}`}
      aria-label="Home sections"
    >
      <div className="home-builder__rail-head">
        <div>
          <span className="home-builder__eyebrow">Structure</span>
          <strong>{title}</strong>
        </div>
        {onClose ? (
          <IconButton aria-label="Close outline" onClick={onClose} title="Close" tone="ghost">
            ×
          </IconButton>
        ) : null}
      </div>

      <div className="home-builder__add">
        {(Object.keys(SECTION_LABELS) as HomeSectionType[]).map((type) => (
          <Button
            className="home-builder__add-btn"
            key={type}
            onClick={() => addSection(type)}
          >
            + {SECTION_LABELS[type]}
          </Button>
        ))}
      </div>

      <div className="home-builder__section-list">
        {sections.map((section, index) => {
          const active = section.id === selectedSectionId;
          return (
            <div
              className="home-builder__block-row"
              data-active={active ? "true" : undefined}
              data-disabled={section.enabled ? undefined : "true"}
              key={section.id}
              {...getRowProps(index)}
            >
              <button
                aria-label="Drag section to reorder"
                className="drag-handle"
                title="Drag to reorder"
                type="button"
                {...getHandleProps(index)}
              >
                ⋮⋮
              </button>
              <button
                type="button"
                className="home-builder__block-main"
                onClick={() => setSelectedId(section.id)}
                aria-current={active ? "true" : undefined}
              >
                <span className="home-builder__block-type">
                  {SECTION_LABELS[section.type]}
                </span>
                <span className="home-builder__block-title">
                  {sectionTitle(section)}
                </span>
                <span className="home-builder__block-summary">
                  {sectionSummary(section)}
                </span>
              </button>
              <div className="home-builder__block-actions">
                <IconButton
                  aria-label="Move section up"
                  disabled={index === 0}
                  onClick={() => moveSection(index, -1)}
                  title="Move up"
                  tone="ghost"
                >
                  ↑
                </IconButton>
                <IconButton
                  aria-label="Move section down"
                  disabled={index === sections.length - 1}
                  onClick={() => moveSection(index, 1)}
                  title="Move down"
                  tone="ghost"
                >
                  ↓
                </IconButton>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export function HomePreviewPane({
  baseUrl,
  draft,
  frameRef,
  html,
  loading,
  onFrameLoad,
  previewError,
  renderSection,
  selectedSectionId,
  setSelectedId,
  stylesheets,
  viewport,
}: {
  baseUrl: string;
  draft: HomeData;
  frameRef: RefObject<HTMLIFrameElement | null>;
  html: string;
  loading: boolean;
  onFrameLoad: () => void;
  previewError: string;
  renderSection: (section: HomeSection) => ReactNode;
  selectedSectionId: string;
  setSelectedId: (id: string) => void;
  stylesheets: string[];
  viewport: HomePreviewViewport;
}) {
  return (
    <main
      className="home-builder__preview"
      aria-label="Home preview"
      data-viewport={viewport}
    >
      <div className="home-preview__chrome">
        <div className="home-preview__lights" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <strong>
          {loading
            ? "Rendering preview…"
            : previewError
              ? `Preview error: ${previewError}`
              : "Live front-end preview"}
        </strong>
        <em>{VIEWPORT_LABELS[viewport]}</em>
      </div>
      <div className="home-preview__stage">
        {html ? (
          <iframe
            ref={frameRef}
            className="home-preview__iframe"
            title="Rendered home preview"
            srcDoc={buildHomePreviewDocument(html, baseUrl, stylesheets)}
            onLoad={onFrameLoad}
          />
        ) : (
          <div className="home-preview__page">
            <h2 className="home-preview__title">{draft.title}</h2>
            {draft.sections
              .filter((section) => section.enabled)
              .map((section) => (
                <div
                  className={[
                    "home-preview__section",
                    `home-preview__section--${section.type}`,
                    selectedSectionId === section.id ? "is-selected" : "",
                  ].join(" ")}
                  key={section.id}
                >
                  <button
                    type="button"
                    className="home-preview__section-button"
                    onClick={() => setSelectedId(section.id)}
                  >
                    {renderSection(section)}
                  </button>
                </div>
              ))}
          </div>
        )}
      </div>
    </main>
  );
}

export function HomeInspectorShell({
  children,
  duplicateSection,
  patchEnabled,
  removeSection,
  selectedSection,
  totalSections,
}: {
  children: ReactNode;
  duplicateSection: (section: HomeSection) => void;
  patchEnabled: (id: string, enabled: boolean) => void;
  removeSection: (id: string) => void;
  selectedSection: HomeSection | undefined;
  totalSections: number;
}) {
  return (
    <aside className="home-builder__inspector" aria-label="Section properties">
      {selectedSection ? (
        <>
          <div className="home-builder__inspector-head">
            <div>
              <p className="home-builder__eyebrow">
                {SECTION_LABELS[selectedSection.type]}
              </p>
              <h2>{sectionTitle(selectedSection)}</h2>
            </div>
            <label className="home-builder__toggle">
              <input
                type="checkbox"
                checked={selectedSection.enabled}
                onChange={(event) => patchEnabled(selectedSection.id, event.target.checked)}
              />
              Enabled
            </label>
          </div>

          {children}

          <div className="home-builder__danger-zone">
            <Button onClick={() => duplicateSection(selectedSection)}>Duplicate</Button>
            <Button
              tone="danger"
              onClick={() => removeSection(selectedSection.id)}
              disabled={totalSections <= 1}
            >
              Remove
            </Button>
          </div>
        </>
      ) : (
        <p className="empty-note">Select a section to edit its properties.</p>
      )}
    </aside>
  );
}
