import { useCallback, useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";

import { useDragReorder } from "./shared/useDragReorder";
import { AssetLibraryPicker, rememberRecentAsset } from "./AssetLibraryPicker";
import { JsonDraftRestoreBanner } from "./JsonDraftRestoreBanner";
import { BlocksEditor } from "./LazyBlocksEditor";
import { VersionHistoryPanel } from "./VersionHistoryPanel";
import {
  BlockEditorCommandMenu,
  getMatchingBlockEditorCommands,
  type BlockEditorCommand,
} from "./block-editor";
import { useSiteAdmin } from "./state";
import { useJsonDraft } from "./use-json-draft";
import { isBoolean, isString, usePersistentUiState } from "./use-persistent-ui-state";
import { uploadImageFile } from "./assets-upload";
import {
  HomeEditableCanvasPane,
  HomeInspectorShell,
  HomePreviewPane,
  HomeSectionRail,
} from "./home-builder/HomeBuilderPanels";
import type { HomePreviewViewport } from "./home-builder/HomeBuilderPanels";
import {
  BLANK_HOME_DATA,
  clone,
  createId,
  createSection,
  normalizeHomeData,
  prepareHomeDataForSave,
  sameData,
} from "./home-builder/schema";
import { homeSectionsToMdx } from "./home-builder/migrate-to-mdx";
import { useHomePreview } from "./home-builder/useHomePreview";
import type {
  HomeData,
  HomeFeaturedPagesSection,
  HomeHeroSection,
  HomeImageBlock,
  HomeLink,
  HomeLinkListSection,
  HomeLayoutBlock,
  HomeLayoutBlockType,
  HomeLayoutSection,
  HomeMarkdownBlock,
  HomeRichTextSection,
  HomeSection,
  HomeSectionType,
} from "./types";

function PreviewText({ children }: { children?: string }) {
  if (!children?.trim()) return <p className="home-preview__muted">Empty</p>;
  return <p className="home-preview__body">{children}</p>;
}

function HomeInsertMenu({
  afterSectionId,
  onInsert,
}: {
  afterSectionId: string | null;
  onInsert: (afterSectionId: string | null, type: HomeSectionType) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const commands = getHomeSectionCommands(query);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const choose = useCallback(
    (type: HomeSectionType) => {
      onInsert(afterSectionId, type);
      close();
    },
    [afterSectionId, close, onInsert],
  );

  return (
    <div className="home-canvas__insert-menu" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="home-canvas__insert-trigger"
        aria-expanded={open}
        aria-label="Insert home section"
        onClick={() => setOpen((value) => !value)}
      >
        +
      </button>
      {open ? (
        <div className="home-canvas__insert-popover">
          <input
            autoFocus
            aria-label="Search home sections"
            value={query}
            placeholder="Type /text, /layout, /links..."
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (event.key === "Escape") {
                event.preventDefault();
                close();
              }
              if (event.key === "Enter" && commands[0]) {
                event.preventDefault();
                choose(commands[0].type);
              }
            }}
          />
          <div className="home-canvas__insert-options">
            <HomeSectionCommandOptions commands={commands} onChoose={choose} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function HomeSectionCommandOptions({
  commands,
  onChoose,
}: {
  commands: HomeSectionCommand[];
  onChoose: (type: HomeSectionType) => void;
}) {
  return (
    <BlockEditorCommandMenu
      ariaLabel="Home section shortcuts"
      className="home-canvas__command-options"
      commands={commands}
      empty={<p>No sections found.</p>}
      onChoose={(command) => onChoose(command.type)}
    />
  );
}

// "notion" is the new Notion-style block-editor mode. It edits `bodyMdx`
// (an additive field on home.json) and, when populated, supersedes the
// sections-iteration on the public Home page. Authoring through this
// mode lets the user build Home from the same HeroBlock /
// LinkListBlock / FeaturedPagesBlock primitives that work on every
// other page.
const HOME_EDITOR_MODES = ["notion", "edit", "structure", "preview"] as const;
type HomeEditorMode = (typeof HOME_EDITOR_MODES)[number];

const HOME_EDITOR_MODE_LABELS: Record<HomeEditorMode, string> = {
  notion: "Notion",
  edit: "Edit",
  structure: "Structure",
  preview: "Preview",
};

const HOME_PREVIEW_VIEWPORTS = ["desktop", "tablet", "mobile"] as const;
const HOME_PREVIEW_VIEWPORT_LABELS: Record<HomePreviewViewport, string> = {
  desktop: "Desktop",
  tablet: "Tablet",
  mobile: "Mobile",
};

interface HomeSectionCommand extends BlockEditorCommand {
  type: HomeSectionType;
}

const HOME_SECTION_COMMANDS: HomeSectionCommand[] = [
  {
    type: "hero",
    id: "hero",
    label: "Hero",
    description: "Intro block with title, copy, and image",
    keywords: ["hero", "intro", "profile"],
  },
  {
    type: "richText",
    id: "richText",
    label: "Text",
    description: "Markdown section for long-form copy",
    keywords: ["text", "paragraph", "body", "rich"],
  },
  {
    type: "layout",
    id: "layout",
    label: "Layout",
    description: "Custom columns with images and text",
    keywords: ["layout", "columns", "image", "split"],
  },
  {
    type: "linkList",
    id: "linkList",
    label: "Links",
    description: "Link list or inline navigation",
    keywords: ["links", "nav", "buttons"],
  },
  {
    type: "featuredPages",
    id: "featuredPages",
    label: "Featured pages",
    description: "Cards linking to major site sections",
    keywords: ["featured", "pages", "cards"],
  },
];

function getHomeSectionCommands(query: string) {
  return getMatchingBlockEditorCommands(query, HOME_SECTION_COMMANDS);
}

function isHomeEditorMode(value: unknown): value is HomeEditorMode {
  return isString(value) && HOME_EDITOR_MODES.includes(value as HomeEditorMode);
}

function isHomePreviewViewport(value: unknown): value is HomePreviewViewport {
  return isString(value) && HOME_PREVIEW_VIEWPORTS.includes(value as HomePreviewViewport);
}

export function HomePanel() {
  const { connection, request, setMessage } = useSiteAdmin();
  const [baseData, setBaseData] = useState<HomeData>(BLANK_HOME_DATA);
  const [draft, setDraft] = useState<HomeData>(BLANK_HOME_DATA);
  const [selectedId, setSelectedId] = usePersistentUiState(
    "workspace.site-admin.home.selected-section.v1",
    BLANK_HOME_DATA.sections[0]?.id || "",
    isString,
  );
  const [fileSha, setFileSha] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [canvasUploadingId, setCanvasUploadingId] = useState("");
  const [editorMode, setEditorMode] = usePersistentUiState<HomeEditorMode>(
    "workspace.site-admin.home.editor-mode.v1",
    "edit",
    isHomeEditorMode,
  );
  const [outlineOpen, setOutlineOpen] = usePersistentUiState(
    "workspace.site-admin.home.outline-open.v1",
    false,
    isBoolean,
  );
  const [settingsOpen, setSettingsOpen] = usePersistentUiState(
    "workspace.site-admin.home.settings-open.v1",
    false,
    isBoolean,
  );
  const [previewViewport, setPreviewViewport] =
    usePersistentUiState<HomePreviewViewport>(
      "workspace.site-admin.home.preview-viewport.v1",
      "desktop",
      isHomePreviewViewport,
    );

  const ready = Boolean(connection.baseUrl) && Boolean(connection.authToken);
  const dirty = useMemo(() => !sameData(baseData, draft), [baseData, draft]);
  const { restorable, clearDraft, dismissRestore } = useJsonDraft<HomeData>(
    "home",
    draft,
    dirty && !loading && !saving,
  );
  const selectedSection = useMemo(
    () =>
      draft.sections.find((section) => section.id === selectedId) ??
      draft.sections[0],
    [draft.sections, selectedId],
  );
  const selectedSectionId = selectedSection?.id || "";
  const homePreview = useHomePreview({
    draft,
    onSelectSection: setSelectedId,
    ready,
    request,
    selectedSectionId,
  });

  const loadData = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!ready) return;
      setLoading(true);
      setError("");
      const response = await request("/api/site-admin/home", "GET");
      setLoading(false);
      if (!response.ok) {
        const msg = `${response.code}: ${response.error}`;
        setError(msg);
        if (!options.silent) setMessage("error", `Load home failed: ${msg}`);
        return;
      }
      const data = (response.data ?? {}) as Record<string, unknown>;
      const payload = data.data ?? {};
      const version = (data.sourceVersion ?? {}) as { fileSha?: string };
      const normalized = normalizeHomeData(payload);
      setBaseData(clone(normalized));
      setDraft(clone(normalized));
      setSelectedId(normalized.sections[0]?.id || "");
      setFileSha(version.fileSha || "");
      setConflict(false);
      if (!options.silent) setMessage("success", "Home loaded.");
    },
    [ready, request, setMessage, setSelectedId],
  );

  useEffect(() => {
    if (!ready) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData({ silent: true });
  }, [ready, loadData]);

  const patchSections = useCallback(
    (mapper: (sections: HomeSection[]) => HomeSection[]) => {
      setDraft((current) =>
        prepareHomeDataForSave({ ...current, sections: mapper(current.sections) }),
      );
    },
    [],
  );

  const patchSection = useCallback(
    (id: string, mapper: (section: HomeSection) => HomeSection) => {
      patchSections((sections) =>
        sections.map((section) => (section.id === id ? mapper(section) : section)),
      );
    },
    [patchSections],
  );

  const save = useCallback(async () => {
    if (!ready || saving) return;
    setSaving(true);
    setError("");
    const payload = prepareHomeDataForSave(draft);
    const response = await request("/api/site-admin/home", "POST", {
      data: payload,
      expectedFileSha: fileSha,
    });
    setSaving(false);
    if (!response.ok) {
      const msg = `${response.code}: ${response.error}`;
      if (response.code === "SOURCE_CONFLICT" || response.status === 409) {
        setConflict(true);
        setMessage("warn", "Home changed on the server. Reload + re-apply.");
        return;
      }
      setError(msg);
      setMessage("error", `Save home failed: ${msg}`);
      return;
    }
    const data = (response.data ?? {}) as Record<string, unknown>;
    const version = (data.sourceVersion ?? {}) as { fileSha?: string };
    setBaseData(clone(payload));
    setDraft(clone(payload));
    setFileSha(version.fileSha || "");
    setConflict(false);
    clearDraft();
    setMessage("success", "Home saved.");
  }, [ready, saving, request, draft, fileSha, clearDraft, setMessage]);

  const addSection = useCallback(
    (type: HomeSectionType) => {
      const section = createSection(type);
      patchSections((sections) => [...sections, section]);
      setSelectedId(section.id);
    },
    [patchSections, setSelectedId],
  );

  const insertSectionAfter = useCallback(
    (afterId: string | null, type: HomeSectionType) => {
      const section = createSection(type);
      patchSections((sections) => {
        if (!afterId) return [section, ...sections];
        const index = sections.findIndex((item) => item.id === afterId);
        if (index < 0) return [...sections, section];
        const copy = sections.slice();
        copy.splice(index + 1, 0, section);
        return copy;
      });
      setSelectedId(section.id);
    },
    [patchSections, setSelectedId],
  );

  const duplicateSection = useCallback(
    (section: HomeSection) => {
      const next = { ...clone(section), id: createId(section.type) } as HomeSection;
      patchSections((sections) => {
        const index = sections.findIndex((item) => item.id === section.id);
        if (index < 0) return [...sections, next];
        const copy = sections.slice();
        copy.splice(index + 1, 0, next);
        return copy;
      });
      setSelectedId(next.id);
    },
    [patchSections, setSelectedId],
  );

  const removeSection = useCallback(
    (id: string) => {
      patchSections((sections) => {
        if (sections.length <= 1) return sections;
        return sections.filter((section) => section.id !== id);
      });
    },
    [patchSections],
  );

  const moveSection = useCallback(
    (index: number, direction: -1 | 1) => {
      patchSections((sections) => {
        const target = index + direction;
        if (target < 0 || target >= sections.length) return sections;
        const next = sections.slice();
        [next[index], next[target]] = [next[target], next[index]];
        return next;
      });
    },
    [patchSections],
  );

  const reorderSections = useCallback(
    (from: number, to: number) => {
      patchSections((sections) => {
        if (
          from < 0 ||
          from >= sections.length ||
          to < 0 ||
          to >= sections.length ||
          from === to
        ) {
          return sections;
        }
        const next = sections.slice();
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
    },
    [patchSections],
  );

  const { getRowProps, getHandleProps } = useDragReorder(
    draft.sections.length,
    reorderSections,
  );

  const updateLink = useCallback(
    (sectionId: string, index: number, patch: Partial<HomeLink>) => {
      patchSection(sectionId, (section) => {
        if (section.type === "linkList") {
          return {
            ...section,
            links: section.links.map((link, i) =>
              i === index ? { ...link, ...patch } : link,
            ),
          };
        }
        if (section.type === "featuredPages") {
          return {
            ...section,
            items: section.items.map((link, i) =>
              i === index ? { ...link, ...patch } : link,
            ),
          };
        }
        return section;
      });
    },
    [patchSection],
  );

  const addLink = useCallback(
    (sectionId: string) => {
      patchSection(sectionId, (section) => {
        const link: HomeLink = { label: "New link", href: "/" };
        if (section.type === "linkList") {
          return { ...section, links: [...section.links, link] };
        }
        if (section.type === "featuredPages") {
          return { ...section, items: [...section.items, link] };
        }
        return section;
      });
    },
    [patchSection],
  );

  const removeLink = useCallback(
    (sectionId: string, index: number) => {
      patchSection(sectionId, (section) => {
        if (section.type === "linkList") {
          return { ...section, links: section.links.filter((_, i) => i !== index) };
        }
        if (section.type === "featuredPages") {
          return { ...section, items: section.items.filter((_, i) => i !== index) };
        }
        return section;
      });
    },
    [patchSection],
  );

  const moveLink = useCallback(
    (sectionId: string, index: number, direction: -1 | 1) => {
      patchSection(sectionId, (section) => {
        if (section.type === "linkList") {
          const target = index + direction;
          if (target < 0 || target >= section.links.length) return section;
          const next = section.links.slice();
          [next[index], next[target]] = [next[target], next[index]];
          return { ...section, links: next };
        }
        if (section.type === "featuredPages") {
          const target = index + direction;
          if (target < 0 || target >= section.items.length) return section;
          const next = section.items.slice();
          [next[index], next[target]] = [next[target], next[index]];
          return { ...section, items: next };
        }
        return section;
      });
    },
    [patchSection],
  );

  const patchLayoutBlock = useCallback(
    (
      sectionId: string,
      blockId: string,
      mapper: (block: HomeLayoutBlock) => HomeLayoutBlock,
    ) => {
      patchSection(sectionId, (section) =>
        section.type === "layout"
          ? {
              ...section,
              blocks: section.blocks.map((block) =>
                block.id === blockId ? mapper(block) : block,
              ),
            }
          : section,
      );
    },
    [patchSection],
  );

  const addLayoutBlock = useCallback(
    (sectionId: string, type: HomeLayoutBlockType, column?: number) => {
      patchSection(sectionId, (section) => {
        if (section.type !== "layout") return section;
        const targetColumn = Math.max(1, Math.min(section.columns, column || 1)) as 1 | 2 | 3;
        const block =
          type === "image"
            ? ({
                id: createId(type),
                type,
                column: column ? targetColumn : section.columns === 1 ? 1 : 2,
                url: "",
                alt: "",
                caption: "",
                shape: "rounded",
                fit: "cover",
              } satisfies HomeImageBlock)
            : ({
                id: createId(type),
                type,
                column: targetColumn,
                title: "Text block",
                body: "",
                tone: "plain",
                textAlign: "left",
              } satisfies HomeMarkdownBlock);
        return { ...section, blocks: [...section.blocks, block] };
      });
    },
    [patchSection],
  );

  const removeLayoutBlock = useCallback(
    (sectionId: string, blockId: string) => {
      patchSection(sectionId, (section) =>
        section.type === "layout"
          ? { ...section, blocks: section.blocks.filter((block) => block.id !== blockId) }
          : section,
      );
    },
    [patchSection],
  );

  const moveLayoutBlock = useCallback(
    (sectionId: string, index: number, direction: -1 | 1) => {
      patchSection(sectionId, (section) => {
        if (section.type !== "layout") return section;
        const target = index + direction;
        if (target < 0 || target >= section.blocks.length) return section;
        const next = section.blocks.slice();
        [next[index], next[target]] = [next[target], next[index]];
        return { ...section, blocks: next };
      });
    },
    [patchSection],
  );

  const renderPreviewSection = useCallback((section: HomeSection) => {
    if (section.type === "hero") return <HeroPreview section={section} />;
    if (section.type === "richText") return <RichTextPreview section={section} />;
    if (section.type === "linkList") return <LinkListPreview section={section} />;
    if (section.type === "featuredPages") {
      return <FeaturedPagesPreview section={section} />;
    }
    if (section.type === "layout") return <LayoutPreview section={section} />;
    return null;
  }, []);

  const resolveCanvasAssetUrl = useCallback(
    (url: string | undefined) => {
      const raw = String(url || "").trim();
      if (!raw) return "";
      if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
      try {
        return new URL(raw, connection.baseUrl || window.location.origin).toString();
      } catch {
        return raw;
      }
    },
    [connection.baseUrl],
  );

  const uploadCanvasHeroImage = useCallback(
    async (section: HomeHeroSection, file: File | null) => {
      if (!file || canvasUploadingId) return;
      setCanvasUploadingId(section.id);
      const result = await uploadImageFile({ file, request });
      setCanvasUploadingId("");
      if (!result.ok) {
        setMessage("error", `Image upload failed: ${result.error}`);
        return;
      }
      rememberRecentAsset(result.asset, result.filename);
      patchSection(section.id, (current) =>
        current.type === "hero"
          ? {
              ...current,
              profileImageUrl: result.asset.url,
              profileImageAlt: current.profileImageAlt || result.filename,
              imagePosition:
                current.imagePosition === "none" ? "left" : current.imagePosition,
            }
          : current,
      );
      setMessage("success", "Hero image uploaded.");
    },
    [canvasUploadingId, patchSection, request, setMessage],
  );

  const uploadCanvasLayoutImage = useCallback(
    async (sectionId: string, block: HomeImageBlock, file: File | null) => {
      if (!file || canvasUploadingId) return;
      setCanvasUploadingId(block.id);
      const result = await uploadImageFile({ file, request });
      setCanvasUploadingId("");
      if (!result.ok) {
        setMessage("error", `Image upload failed: ${result.error}`);
        return;
      }
      rememberRecentAsset(result.asset, result.filename);
      patchLayoutBlock(sectionId, block.id, (current) =>
        current.type === "image"
          ? {
              ...current,
              url: result.asset.url,
              alt: current.alt || result.filename,
            }
          : current,
      );
      setMessage("success", "Image uploaded.");
    },
    [canvasUploadingId, patchLayoutBlock, request, setMessage],
  );

  const renderEditableSection = useCallback(
    (section: HomeSection) => {
      if (section.type === "hero") {
        return (
          <EditableHeroSection
            section={section}
            uploading={canvasUploadingId === section.id}
            resolveAssetUrl={resolveCanvasAssetUrl}
            onUploadImage={(file) => void uploadCanvasHeroImage(section, file)}
            patchSection={patchSection}
          />
        );
      }
      if (section.type === "richText") {
        return (
          <EditableRichTextSection
            section={section}
            patchSection={patchSection}
          />
        );
      }
      if (section.type === "linkList") {
        return (
          <EditableLinkListSection
            section={section}
            patchSection={patchSection}
            updateLink={updateLink}
            addLink={addLink}
            removeLink={removeLink}
            moveLink={moveLink}
          />
        );
      }
      if (section.type === "featuredPages") {
        return (
          <EditableFeaturedPagesSection
            section={section}
            patchSection={patchSection}
            updateLink={updateLink}
            addLink={addLink}
            removeLink={removeLink}
            moveLink={moveLink}
          />
        );
      }
      if (section.type === "layout") {
        return (
          <EditableLayoutSection
            section={section}
            resolveAssetUrl={resolveCanvasAssetUrl}
            uploadingId={canvasUploadingId}
            patchSection={patchSection}
            patchLayoutBlock={patchLayoutBlock}
            addLayoutBlock={addLayoutBlock}
            removeLayoutBlock={removeLayoutBlock}
            moveLayoutBlock={moveLayoutBlock}
            uploadLayoutImage={(block, file) =>
              void uploadCanvasLayoutImage(section.id, block, file)
            }
          />
        );
      }
      return null;
    },
    [
      addLayoutBlock,
      addLink,
      canvasUploadingId,
      insertSectionAfter,
      moveLayoutBlock,
      moveLink,
      patchLayoutBlock,
      patchSection,
      removeLayoutBlock,
      removeLink,
      resolveCanvasAssetUrl,
      updateLink,
      uploadCanvasHeroImage,
      uploadCanvasLayoutImage,
    ],
  );

  const renderCanvasSectionToolbar = useCallback(
    (section: HomeSection, index: number) => (
      <div className="home-canvas__section-toolbar" onClick={(event) => event.stopPropagation()}>
        <span>{HOME_EDITOR_MODE_LABELS.edit}</span>
        <button
          type="button"
          onClick={() => moveSection(index, -1)}
          disabled={index === 0}
          aria-label="Move section up"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => moveSection(index, 1)}
          disabled={index === draft.sections.length - 1}
          aria-label="Move section down"
        >
          ↓
        </button>
        <button type="button" onClick={() => duplicateSection(section)}>
          Duplicate
        </button>
        <button
          type="button"
          onClick={() =>
            patchSection(section.id, (current) => ({
              ...current,
              enabled: !current.enabled,
            }))
          }
        >
          {section.enabled ? "Hide" : "Show"}
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="Open section settings"
        >
          Settings
        </button>
        <button
          type="button"
          onClick={() => removeSection(section.id)}
          disabled={draft.sections.length <= 1}
          aria-label="Remove section"
          className="home-canvas__danger-action"
        >
          Delete
        </button>
      </div>
    ),
    [
      draft.sections.length,
      duplicateSection,
      moveSection,
      patchSection,
      removeSection,
      setSettingsOpen,
    ],
  );

  const renderInsertControls = useCallback(
    (afterSectionId: string | null) => (
      <HomeInsertMenu afterSectionId={afterSectionId} onInsert={insertSectionAfter} />
    ),
    [insertSectionAfter],
  );

  const stateNote = loading
    ? "Loading…"
    : conflict
      ? "Conflict detected. Reload before saving."
      : dirty
        ? "Unsaved changes."
        : "In sync.";
  const outlineDrawerOpen = editorMode === "edit" && outlineOpen;
  const settingsDrawerOpen = editorMode === "edit" && settingsOpen;
  const sectionRailProps = {
    addSection,
    getHandleProps,
    getRowProps,
    moveSection,
    sections: draft.sections,
    selectedSectionId,
    setSelectedId,
  };
  const inspectorPanel = (
    <HomeInspectorShell
      duplicateSection={duplicateSection}
      patchEnabled={(id, enabled) =>
        patchSection(id, (section) => ({ ...section, enabled }))
      }
      removeSection={removeSection}
      selectedSection={selectedSection}
      totalSections={draft.sections.length}
    >
      {selectedSection && (
        <>
          <SharedLayoutFields section={selectedSection} patchSection={patchSection} />
          {selectedSection.type === "hero" && (
            <HeroFields section={selectedSection} patchSection={patchSection} />
          )}
          {selectedSection.type === "richText" && (
            <RichTextFields section={selectedSection} patchSection={patchSection} />
          )}
          {selectedSection.type === "linkList" && (
            <LinkListFields
              section={selectedSection}
              patchSection={patchSection}
              updateLink={updateLink}
              addLink={addLink}
              removeLink={removeLink}
              moveLink={moveLink}
            />
          )}
          {selectedSection.type === "featuredPages" && (
            <FeaturedPagesFields
              section={selectedSection}
              patchSection={patchSection}
              updateLink={updateLink}
              addLink={addLink}
              removeLink={removeLink}
              moveLink={moveLink}
            />
          )}
          {selectedSection.type === "layout" && (
            <LayoutFields
              section={selectedSection}
              patchSection={patchSection}
              patchLayoutBlock={patchLayoutBlock}
              addLayoutBlock={addLayoutBlock}
              removeLayoutBlock={removeLayoutBlock}
              moveLayoutBlock={moveLayoutBlock}
            />
          )}
        </>
      )}
    </HomeInspectorShell>
  );

  return (
    <section className="surface-card home-builder-card">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="m-0 text-[20px] font-semibold text-text-primary tracking-[-0.01em]">
            Home
          </h1>
          <p className="m-0 mt-0.5 text-[12.5px] text-text-muted">
            Section builder for <code>/</code>. Writes to{" "}
            <code>content/home.json</code>; markdown fields render through the
            site MDX pipeline.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            className="btn btn--secondary"
            type="button"
            onClick={() => void loadData()}
            disabled={!ready || loading}
          >
            {loading ? "Loading…" : "Reload"}
          </button>
          <button
            className="btn btn--primary"
            type="button"
            onClick={() => void save()}
            disabled={!ready || saving || !dirty || conflict}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      {error && (
        <p className="m-0 text-[12px] text-[color:var(--color-danger)]">{error}</p>
      )}
      <p className="m-0 text-[12px] text-text-muted">
        {stateNote} · {draft.sections.length} section
        {draft.sections.length === 1 ? "" : "s"}
      </p>
      <div className="home-builder__version-card" aria-label="Home version checkpoint">
        <span>Version checkpoint</span>
        <code>{fileSha ? fileSha.slice(0, 12) : "unsaved-local"}</code>
        <span>schema v{draft.schemaVersion ?? 1}</span>
      </div>
      <VersionHistoryPanel
        path="content/home.json"
        currentFileSha={fileSha}
        restoreDisabled={dirty || saving || loading}
        onRestored={({ content, fileSha: restoredSha }) => {
          let parsed: unknown = null;
          try {
            parsed = JSON.parse(content);
          } catch {
            parsed = null;
          }
          const next = normalizeHomeData(parsed);
          setBaseData(clone(next));
          setDraft(clone(next));
          setSelectedId(next.sections[0]?.id || "");
          setFileSha(restoredSha);
          setConflict(false);
          clearDraft();
        }}
      />

      {restorable && (
        <JsonDraftRestoreBanner
          savedAt={restorable.savedAt}
          onDismiss={dismissRestore}
          onRestore={() => {
            const value = normalizeHomeData(restorable.value);
            setDraft(clone(value));
            setSelectedId(value.sections[0]?.id || "");
            dismissRestore();
          }}
        />
      )}

      <div className="home-builder__workspace">
        <div className="home-builder__toolbar" aria-label="Home editor view controls">
          <div className="home-builder__segmented" aria-label="Editor mode">
            {HOME_EDITOR_MODES.map((mode) => (
              <button
                aria-pressed={editorMode === mode}
                data-active={editorMode === mode ? "true" : undefined}
                key={mode}
                onClick={() => {
                  setEditorMode(mode);
                  if (mode !== "edit") {
                    setOutlineOpen(false);
                    setSettingsOpen(false);
                  }
                }}
                type="button"
              >
                {HOME_EDITOR_MODE_LABELS[mode]}
              </button>
            ))}
          </div>

          <button
            aria-expanded={outlineDrawerOpen}
            className="btn btn--secondary home-builder__outline-toggle"
            disabled={editorMode !== "edit"}
            onClick={() => setOutlineOpen((open) => !open)}
            type="button"
          >
            Outline
          </button>

          <button
            aria-expanded={settingsDrawerOpen}
            className="btn btn--secondary home-builder__outline-toggle"
            disabled={editorMode !== "edit"}
            onClick={() => setSettingsOpen((open) => !open)}
            type="button"
          >
            Settings
          </button>

          {editorMode !== "structure" && editorMode !== "notion" ? (
            <div
              className="home-builder__segmented home-builder__segmented--viewport"
              aria-label="Preview viewport"
            >
              {HOME_PREVIEW_VIEWPORTS.map((viewport) => (
                <button
                  aria-pressed={previewViewport === viewport}
                  data-active={previewViewport === viewport ? "true" : undefined}
                  key={viewport}
                  onClick={() => setPreviewViewport(viewport)}
                  type="button"
                >
                  {HOME_PREVIEW_VIEWPORT_LABELS[viewport]}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div
          className="home-builder"
          data-mode={editorMode}
          data-outline-open={outlineDrawerOpen ? "true" : undefined}
          data-settings-open={settingsDrawerOpen ? "true" : undefined}
        >
          {editorMode === "notion" ? (
            <div className="home-builder__notion">
              <p className="home-builder__notion-hint">
                When non-empty, this body replaces the section list on
                the public Home page. Use <code>/</code> for blocks —
                Hero, Link list, and Featured pages cover everything the
                section builder does, plus regular paragraphs / headings
                / images / etc.
              </p>
              {!draft.bodyMdx && draft.sections.length > 0 ? (
                <div className="home-builder__notion-migrate">
                  <p>
                    Start from your existing sections. The conversion is
                    best-effort — review the result before saving.
                  </p>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => {
                      const result = homeSectionsToMdx(draft);
                      if (!result.mdx) {
                        setMessage(
                          "warn",
                          "No enabled sections to migrate.",
                        );
                        return;
                      }
                      setDraft((current) => ({
                        ...current,
                        bodyMdx: result.mdx,
                      }));
                      const noteSummary =
                        result.notes.length > 0
                          ? ` Notes: ${result.notes.join(" / ")}`
                          : "";
                      setMessage(
                        "success",
                        `Migrated ${draft.sections.filter((s) => s.enabled).length} section(s) to MDX. Review and Save.${noteSummary}`,
                      );
                    }}
                  >
                    Migrate sections to MDX
                  </button>
                </div>
              ) : null}
              <BlocksEditor
                value={draft.bodyMdx ?? ""}
                onChange={(next) =>
                  setDraft((current) => ({
                    ...current,
                    bodyMdx: next.trim() ? next : undefined,
                  }))
                }
                minHeight={520}
              />
            </div>
          ) : editorMode === "structure" ? (
            <>
              <HomeSectionRail {...sectionRailProps} title="Page structure" />
              {inspectorPanel}
            </>
          ) : (
            <>
              <div className="home-builder__canvas-stack">
                {outlineDrawerOpen ? (
                  <div className="home-builder__outline-drawer">
                    <HomeSectionRail
                      {...sectionRailProps}
                      onClose={() => setOutlineOpen(false)}
                      title="Page outline"
                      variant="drawer"
                    />
                  </div>
                ) : null}
                {settingsDrawerOpen ? (
                  <div className="home-builder__settings-drawer">
                    {inspectorPanel}
                  </div>
                ) : null}
                {editorMode === "edit" ? (
                  <HomeEditableCanvasPane
                    draft={draft}
                    onTitleChange={(title) => setDraft((current) => ({ ...current, title }))}
                    renderInsertControls={renderInsertControls}
                    renderSection={renderEditableSection}
                    renderSectionToolbar={renderCanvasSectionToolbar}
                    selectedSectionId={selectedSectionId}
                    setSelectedId={setSelectedId}
                    viewport={previewViewport}
                  />
                ) : (
                  <HomePreviewPane
                    baseUrl={connection.baseUrl}
                    draft={draft}
                    frameRef={homePreview.frameRef}
                    html={homePreview.html}
                    loading={homePreview.loading}
                    onFrameLoad={homePreview.onFrameLoad}
                    previewError={homePreview.error}
                    renderSection={renderPreviewSection}
                    selectedSectionId={selectedSectionId}
                    setSelectedId={setSelectedId}
                    stylesheets={homePreview.stylesheets}
                    viewport={previewViewport}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function SharedLayoutFields({
  section,
  patchSection,
}: {
  section: HomeSection;
  patchSection: (id: string, mapper: (section: HomeSection) => HomeSection) => void;
}) {
  return (
    <label className="home-builder__field">
      <span>Width</span>
      <select
        value={section.width}
        onChange={(event) =>
          patchSection(section.id, (current) => ({
            ...current,
            width: event.target.value as HomeSection["width"],
          }))
        }
      >
        <option value="narrow">Narrow</option>
        <option value="standard">Standard</option>
        <option value="wide">Wide</option>
      </select>
    </label>
  );
}

function HeroFields({
  section,
  patchSection,
}: {
  section: HomeHeroSection;
  patchSection: (id: string, mapper: (section: HomeSection) => HomeSection) => void;
}) {
  const { request, setMessage } = useSiteAdmin();
  const [uploading, setUploading] = useState(false);

  const uploadHeroImage = async (file: File | null) => {
    if (!file || uploading) return;
    setUploading(true);
    const result = await uploadImageFile({ file, request });
    setUploading(false);
    if (!result.ok) {
      setMessage("error", `Image upload failed: ${result.error}`);
      return;
    }
    rememberRecentAsset(result.asset, result.filename);
    patchSection(section.id, (current) =>
      current.type === "hero"
        ? {
            ...current,
            profileImageUrl: result.asset.url,
            profileImageAlt: current.profileImageAlt || result.filename,
            imagePosition:
              current.imagePosition === "none" ? "left" : current.imagePosition,
          }
        : current,
    );
    setMessage("success", "Hero image uploaded.");
  };

  return (
    <>
      <label className="home-builder__field">
        <span>Page title</span>
        <input
          value={section.title}
          onChange={(event) =>
            patchSection(section.id, (current) =>
              current.type === "hero"
                ? { ...current, title: event.target.value }
                : current,
            )
          }
        />
      </label>
      <label className="home-builder__field">
        <span>Hero body</span>
        <BlocksEditor
          value={section.body}
          onChange={(event) =>
            patchSection(section.id, (current) =>
              current.type === "hero"
                ? { ...current, body: event }
                : current,
            )
          }
          minHeight={180}
        />
      </label>
      <AssetLibraryPicker
        currentUrl={section.profileImageUrl}
        onSelect={(asset) => {
          patchSection(section.id, (current) =>
            current.type === "hero"
              ? {
                  ...current,
                  profileImageUrl: asset.url,
                  profileImageAlt:
                    current.profileImageAlt || asset.alt || asset.filename,
                  imagePosition:
                    current.imagePosition === "none"
                      ? "left"
                      : current.imagePosition,
                }
              : current,
          );
        }}
      />
      <div className="home-builder__field-grid">
        <label className="home-builder__field">
          <span>Image URL</span>
          <input
            value={section.profileImageUrl || ""}
            placeholder="/notion-assets/…png or https://…"
            spellCheck={false}
            onChange={(event) =>
              patchSection(section.id, (current) =>
                current.type === "hero"
                  ? { ...current, profileImageUrl: event.target.value || undefined }
                  : current,
              )
            }
          />
        </label>
        <label className="home-builder__field">
          <span>Image alt</span>
          <input
            value={section.profileImageAlt || ""}
            onChange={(event) =>
              patchSection(section.id, (current) =>
                current.type === "hero"
                  ? { ...current, profileImageAlt: event.target.value || undefined }
                  : current,
              )
            }
          />
        </label>
      </div>
      <label className="home-builder__upload">
        <span>{uploading ? "Uploading image…" : "Upload hero image"}</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif"
          disabled={uploading}
          onChange={(event) => {
            void uploadHeroImage(event.target.files?.[0] ?? null);
            event.currentTarget.value = "";
          }}
        />
      </label>
      <div className="home-builder__field-grid">
        <label className="home-builder__field">
          <span>Image position</span>
          <select
            value={section.imagePosition}
            onChange={(event) =>
              patchSection(section.id, (current) =>
                current.type === "hero"
                  ? {
                      ...current,
                      imagePosition: event.target.value as HomeHeroSection["imagePosition"],
                    }
                  : current,
              )
            }
          >
            <option value="left">Left</option>
            <option value="right">Right</option>
            <option value="top">Top</option>
            <option value="none">Hidden</option>
          </select>
        </label>
        <label className="home-builder__field">
          <span>Text align</span>
          <select
            value={section.textAlign}
            onChange={(event) =>
              patchSection(section.id, (current) =>
                current.type === "hero"
                  ? {
                      ...current,
                      textAlign: event.target.value as HomeHeroSection["textAlign"],
                    }
                  : current,
              )
            }
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
          </select>
        </label>
      </div>
    </>
  );
}

function RichTextFields({
  section,
  patchSection,
}: {
  section: HomeRichTextSection;
  patchSection: (id: string, mapper: (section: HomeSection) => HomeSection) => void;
}) {
  return (
    <>
      <label className="home-builder__field">
        <span>Title</span>
        <input
          value={section.title || ""}
          onChange={(event) =>
            patchSection(section.id, (current) =>
              current.type === "richText"
                ? { ...current, title: event.target.value || undefined }
                : current,
            )
          }
        />
      </label>
      <label className="home-builder__field">
        <span>Body</span>
        <BlocksEditor
          value={section.body}
          onChange={(event) =>
            patchSection(section.id, (current) =>
              current.type === "richText"
                ? { ...current, body: event }
                : current,
            )
          }
          minHeight={180}
        />
      </label>
      <div className="home-builder__field-grid">
        <label className="home-builder__field">
          <span>Tone</span>
          <select
            value={section.tone}
            onChange={(event) =>
              patchSection(section.id, (current) =>
                current.type === "richText"
                  ? {
                      ...current,
                      tone: event.target.value as HomeRichTextSection["tone"],
                    }
                  : current,
              )
            }
          >
            <option value="plain">Plain</option>
            <option value="panel">Panel</option>
            <option value="quote">Quote</option>
          </select>
        </label>
        <label className="home-builder__field">
          <span>Variant</span>
          <select
            value={section.variant}
            onChange={(event) =>
              patchSection(section.id, (current) =>
                current.type === "richText"
                  ? {
                      ...current,
                      variant: event.target.value as HomeRichTextSection["variant"],
                    }
                  : current,
              )
            }
          >
            <option value="standard">Standard</option>
            <option value="classicBody">Classic body</option>
          </select>
        </label>
      </div>
      <div className="home-builder__field-grid">
        <label className="home-builder__field">
          <span>Text align</span>
          <select
            value={section.textAlign}
            onChange={(event) =>
              patchSection(section.id, (current) =>
                current.type === "richText"
                  ? {
                      ...current,
                      textAlign: event.target.value as HomeRichTextSection["textAlign"],
                    }
                  : current,
              )
            }
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
          </select>
        </label>
      </div>
    </>
  );
}

function LinkListFields({
  section,
  patchSection,
  updateLink,
  addLink,
  removeLink,
  moveLink,
}: {
  section: HomeLinkListSection;
  patchSection: (id: string, mapper: (section: HomeSection) => HomeSection) => void;
  updateLink: (sectionId: string, index: number, patch: Partial<HomeLink>) => void;
  addLink: (sectionId: string) => void;
  removeLink: (sectionId: string, index: number) => void;
  moveLink: (sectionId: string, index: number, direction: -1 | 1) => void;
}) {
  return (
    <>
      <label className="home-builder__field">
        <span>Title</span>
        <input
          value={section.title || ""}
          onChange={(event) =>
            patchSection(section.id, (current) =>
              current.type === "linkList"
                ? { ...current, title: event.target.value || undefined }
                : current,
            )
          }
        />
      </label>
      <label className="home-builder__field">
        <span>Intro</span>
        <BlocksEditor
          value={section.body || ""}
          onChange={(event) =>
            patchSection(section.id, (current) =>
              current.type === "linkList"
                ? { ...current, body: event || undefined }
                : current,
            )
          }
          minHeight={112}
        />
      </label>
      <label className="home-builder__field">
        <span>Layout</span>
        <select
          value={section.layout}
          onChange={(event) =>
            patchSection(section.id, (current) =>
              current.type === "linkList"
                ? {
                    ...current,
                    layout: event.target.value as HomeLinkListSection["layout"],
                  }
                : current,
            )
          }
        >
          <option value="grid">Grid cards</option>
          <option value="stack">Stack</option>
          <option value="inline">Inline chips</option>
        </select>
      </label>
      <LinkRows
        links={section.links}
        sectionId={section.id}
        updateLink={updateLink}
        addLink={addLink}
        removeLink={removeLink}
        moveLink={moveLink}
      />
    </>
  );
}

function FeaturedPagesFields({
  section,
  patchSection,
  updateLink,
  addLink,
  removeLink,
  moveLink,
}: {
  section: HomeFeaturedPagesSection;
  patchSection: (id: string, mapper: (section: HomeSection) => HomeSection) => void;
  updateLink: (sectionId: string, index: number, patch: Partial<HomeLink>) => void;
  addLink: (sectionId: string) => void;
  removeLink: (sectionId: string, index: number) => void;
  moveLink: (sectionId: string, index: number, direction: -1 | 1) => void;
}) {
  return (
    <>
      <label className="home-builder__field">
        <span>Title</span>
        <input
          value={section.title || ""}
          onChange={(event) =>
            patchSection(section.id, (current) =>
              current.type === "featuredPages"
                ? { ...current, title: event.target.value || undefined }
                : current,
            )
          }
        />
      </label>
      <label className="home-builder__field">
        <span>Intro</span>
        <BlocksEditor
          value={section.body || ""}
          onChange={(event) =>
            patchSection(section.id, (current) =>
              current.type === "featuredPages"
                ? { ...current, body: event || undefined }
                : current,
            )
          }
          minHeight={112}
        />
      </label>
      <label className="home-builder__field">
        <span>Columns</span>
        <select
          value={section.columns}
          onChange={(event) =>
            patchSection(section.id, (current) =>
              current.type === "featuredPages"
                ? {
                    ...current,
                    columns: Number(event.target.value) === 2 ? 2 : 3,
                  }
                : current,
            )
          }
        >
          <option value={2}>2 columns</option>
          <option value={3}>3 columns</option>
        </select>
      </label>
      <LinkRows
        links={section.items}
        sectionId={section.id}
        updateLink={updateLink}
        addLink={addLink}
        removeLink={removeLink}
        moveLink={moveLink}
      />
    </>
  );
}

function LayoutFields({
  section,
  patchSection,
  patchLayoutBlock,
  addLayoutBlock,
  removeLayoutBlock,
  moveLayoutBlock,
}: {
  section: HomeLayoutSection;
  patchSection: (id: string, mapper: (section: HomeSection) => HomeSection) => void;
  patchLayoutBlock: (
    sectionId: string,
    blockId: string,
    mapper: (block: HomeLayoutBlock) => HomeLayoutBlock,
  ) => void;
  addLayoutBlock: (sectionId: string, type: HomeLayoutBlockType, column?: number) => void;
  removeLayoutBlock: (sectionId: string, blockId: string) => void;
  moveLayoutBlock: (sectionId: string, index: number, direction: -1 | 1) => void;
}) {
  const { request, setMessage } = useSiteAdmin();
  const [uploadingId, setUploadingId] = useState("");

  const uploadBlockImage = async (blockId: string, file: File | null) => {
    if (!file || uploadingId) return;
    setUploadingId(blockId);
    const result = await uploadImageFile({ file, request });
    setUploadingId("");
    if (!result.ok) {
      setMessage("error", `Image upload failed: ${result.error}`);
      return;
    }
    rememberRecentAsset(result.asset, result.filename);
    patchLayoutBlock(section.id, blockId, (block) =>
      block.type === "image"
        ? {
            ...block,
            url: result.asset.url,
            alt: block.alt || result.filename,
          }
        : block,
    );
    setMessage("success", "Image uploaded.");
  };

  return (
    <>
      <label className="home-builder__field">
        <span>Section title</span>
        <input
          value={section.title || ""}
          onChange={(event) =>
            patchSection(section.id, (current) =>
              current.type === "layout"
                ? { ...current, title: event.target.value }
                : current,
            )
          }
        />
      </label>
      <div className="home-builder__field-grid">
        <label className="home-builder__field">
          <span>Variant</span>
          <select
            value={section.variant}
            onChange={(event) =>
              patchSection(section.id, (current) =>
                current.type === "layout"
                  ? {
                      ...current,
                      variant: event.target.value as HomeLayoutSection["variant"],
                    }
                  : current,
              )
            }
          >
            <option value="standard">Standard</option>
            <option value="classicIntro">Classic intro</option>
          </select>
        </label>
        <label className="home-builder__field">
          <span>Columns</span>
          <select
            value={section.columns}
            onChange={(event) => {
              const columns = Number(event.target.value) as 1 | 2 | 3;
              patchSection(section.id, (current) =>
                current.type === "layout"
                  ? {
                      ...current,
                      columns,
                      blocks: current.blocks.map((block) => ({
                        ...block,
                        column:
                          block.column > columns ? columns : block.column,
                      })),
                    }
                  : current,
              );
            }}
          >
            <option value={1}>1 column</option>
            <option value={2}>2 columns</option>
            <option value={3}>3 columns</option>
          </select>
        </label>
        <label className="home-builder__field">
          <span>Vertical align</span>
          <select
            value={section.verticalAlign}
            onChange={(event) =>
              patchSection(section.id, (current) =>
                current.type === "layout"
                  ? {
                      ...current,
                      verticalAlign: event.target.value as HomeLayoutSection["verticalAlign"],
                    }
                  : current,
              )
            }
          >
            <option value="start">Top</option>
            <option value="center">Center</option>
          </select>
        </label>
      </div>
      <label className="home-builder__field">
        <span>Gap</span>
        <select
          value={section.gap}
          onChange={(event) =>
            patchSection(section.id, (current) =>
              current.type === "layout"
                ? {
                    ...current,
                    gap: event.target.value as HomeLayoutSection["gap"],
                  }
                : current,
            )
          }
        >
          <option value="compact">Compact</option>
          <option value="standard">Standard</option>
          <option value="loose">Loose</option>
        </select>
      </label>
      <div className="home-builder__links">
        <div className="home-builder__links-head">
          <span>Blocks</span>
          <div className="home-builder__inline-actions">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => addLayoutBlock(section.id, "markdown")}
            >
              + Text
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => addLayoutBlock(section.id, "image")}
            >
              + Image
            </button>
          </div>
        </div>
        {section.blocks.map((block, index) => (
          <div className="home-builder__link-row" key={block.id}>
            <div className="home-builder__link-actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => moveLayoutBlock(section.id, index, -1)}
                disabled={index === 0}
                aria-label="Move block up"
              >
                ↑
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => moveLayoutBlock(section.id, index, 1)}
                disabled={index === section.blocks.length - 1}
                aria-label="Move block down"
              >
                ↓
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => removeLayoutBlock(section.id, block.id)}
                aria-label="Remove block"
                style={{ color: "var(--color-danger)" }}
              >
                ×
              </button>
            </div>
            <div className="home-builder__field-grid">
              <label className="home-builder__field">
                <span>Block</span>
                <input value={block.type === "image" ? "Image" : "Markdown"} readOnly />
              </label>
              <label className="home-builder__field">
                <span>Column</span>
                <select
                  value={block.column}
                  onChange={(event) =>
                    patchLayoutBlock(section.id, block.id, (current) => ({
                      ...current,
                      column: Number(event.target.value) as 1 | 2 | 3,
                    }))
                  }
                >
                  {Array.from({ length: section.columns }, (_, i) => i + 1).map((column) => (
                    <option value={column} key={column}>
                      Column {column}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {block.type === "markdown" ? (
              <MarkdownBlockFields
                block={block}
                sectionId={section.id}
                patchLayoutBlock={patchLayoutBlock}
              />
            ) : (
              <ImageBlockFields
                block={block}
                sectionId={section.id}
                uploading={uploadingId === block.id}
                uploadBlockImage={uploadBlockImage}
                patchLayoutBlock={patchLayoutBlock}
              />
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function MarkdownBlockFields({
  block,
  sectionId,
  patchLayoutBlock,
}: {
  block: HomeMarkdownBlock;
  sectionId: string;
  patchLayoutBlock: (
    sectionId: string,
    blockId: string,
    mapper: (block: HomeLayoutBlock) => HomeLayoutBlock,
  ) => void;
}) {
  return (
    <>
      <label className="home-builder__field">
        <span>Title</span>
        <input
          value={block.title || ""}
          onChange={(event) =>
            patchLayoutBlock(sectionId, block.id, (current) =>
              current.type === "markdown"
                ? { ...current, title: event.target.value }
                : current,
            )
          }
        />
      </label>
      <label className="home-builder__field">
        <span>Body</span>
        <BlocksEditor
          value={block.body}
          onChange={(value) =>
            patchLayoutBlock(sectionId, block.id, (current) =>
              current.type === "markdown" ? { ...current, body: value } : current,
            )
          }
          minHeight={126}
        />
      </label>
      <div className="home-builder__field-grid">
        <label className="home-builder__field">
          <span>Tone</span>
          <select
            value={block.tone}
            onChange={(event) =>
              patchLayoutBlock(sectionId, block.id, (current) =>
                current.type === "markdown"
                  ? {
                      ...current,
                      tone: event.target.value as HomeMarkdownBlock["tone"],
                    }
                  : current,
              )
            }
          >
            <option value="plain">Plain</option>
            <option value="panel">Panel</option>
            <option value="quote">Quote</option>
          </select>
        </label>
        <label className="home-builder__field">
          <span>Text align</span>
          <select
            value={block.textAlign}
            onChange={(event) =>
              patchLayoutBlock(sectionId, block.id, (current) =>
                current.type === "markdown"
                  ? {
                      ...current,
                      textAlign: event.target.value as HomeMarkdownBlock["textAlign"],
                    }
                  : current,
              )
            }
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
          </select>
        </label>
      </div>
    </>
  );
}

function ImageBlockFields({
  block,
  sectionId,
  uploading,
  uploadBlockImage,
  patchLayoutBlock,
}: {
  block: HomeImageBlock;
  sectionId: string;
  uploading: boolean;
  uploadBlockImage: (blockId: string, file: File | null) => void;
  patchLayoutBlock: (
    sectionId: string,
    blockId: string,
    mapper: (block: HomeLayoutBlock) => HomeLayoutBlock,
  ) => void;
}) {
  return (
    <>
      <AssetLibraryPicker
        currentUrl={block.url}
        onSelect={(asset) =>
          patchLayoutBlock(sectionId, block.id, (current) =>
            current.type === "image"
              ? {
                  ...current,
                  url: asset.url,
                  alt: current.alt || asset.alt || asset.filename || "",
                }
              : current,
          )
        }
      />
      <label className="home-builder__field">
        <span>Image URL</span>
        <input
          value={block.url}
          placeholder="/uploads/… or https://…"
          spellCheck={false}
          onChange={(event) =>
            patchLayoutBlock(sectionId, block.id, (current) =>
              current.type === "image"
                ? { ...current, url: event.target.value }
                : current,
            )
          }
        />
      </label>
      <div className="home-builder__field-grid">
        <label className="home-builder__field">
          <span>Alt</span>
          <input
            value={block.alt || ""}
            onChange={(event) =>
              patchLayoutBlock(sectionId, block.id, (current) =>
                current.type === "image"
                  ? { ...current, alt: event.target.value }
                  : current,
              )
            }
          />
        </label>
        <label className="home-builder__field">
          <span>Caption</span>
          <input
            value={block.caption || ""}
            onChange={(event) =>
              patchLayoutBlock(sectionId, block.id, (current) =>
                current.type === "image"
                  ? { ...current, caption: event.target.value }
                  : current,
              )
            }
          />
        </label>
      </div>
      <label className="home-builder__upload">
        <span>{uploading ? "Uploading image…" : "Upload image"}</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif"
          disabled={uploading}
          onChange={(event) => {
            uploadBlockImage(block.id, event.target.files?.[0] ?? null);
            event.currentTarget.value = "";
          }}
        />
      </label>
      <div className="home-builder__field-grid">
        <label className="home-builder__field">
          <span>Shape</span>
          <select
            value={block.shape}
            onChange={(event) =>
              patchLayoutBlock(sectionId, block.id, (current) =>
                current.type === "image"
                  ? {
                      ...current,
                      shape: event.target.value as HomeImageBlock["shape"],
                    }
                  : current,
              )
            }
          >
            <option value="rounded">Rounded</option>
            <option value="portrait">Portrait</option>
            <option value="square">Square</option>
            <option value="circle">Circle</option>
          </select>
        </label>
        <label className="home-builder__field">
          <span>Fit</span>
          <select
            value={block.fit}
            onChange={(event) =>
              patchLayoutBlock(sectionId, block.id, (current) =>
                current.type === "image"
                  ? {
                      ...current,
                      fit: event.target.value as HomeImageBlock["fit"],
                    }
                  : current,
              )
            }
          >
            <option value="cover">Cover</option>
            <option value="contain">Contain</option>
          </select>
        </label>
      </div>
    </>
  );
}

function LinkRows({
  links,
  sectionId,
  updateLink,
  addLink,
  removeLink,
  moveLink,
}: {
  links: HomeLink[];
  sectionId: string;
  updateLink: (sectionId: string, index: number, patch: Partial<HomeLink>) => void;
  addLink: (sectionId: string) => void;
  removeLink: (sectionId: string, index: number) => void;
  moveLink: (sectionId: string, index: number, direction: -1 | 1) => void;
}) {
  return (
    <div className="home-builder__links">
      <div className="home-builder__links-head">
        <span>Items</span>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => addLink(sectionId)}
        >
          + Add item
        </button>
      </div>
      {links.map((link, index) => (
        <div className="home-builder__link-row" key={`${sectionId}-${index}`}>
          <div className="home-builder__link-actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => moveLink(sectionId, index, -1)}
              disabled={index === 0}
              aria-label="Move item up"
            >
              ↑
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => moveLink(sectionId, index, 1)}
              disabled={index === links.length - 1}
              aria-label="Move item down"
            >
              ↓
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => removeLink(sectionId, index)}
              aria-label="Remove item"
              style={{ color: "var(--color-danger)" }}
            >
              ×
            </button>
          </div>
          <label className="home-builder__field">
            <span>Label</span>
            <input
              value={link.label}
              onChange={(event) =>
                updateLink(sectionId, index, { label: event.target.value })
              }
            />
          </label>
          <label className="home-builder__field">
            <span>Href</span>
            <input
              value={link.href}
              onChange={(event) =>
                updateLink(sectionId, index, { href: event.target.value })
              }
            />
          </label>
          <label className="home-builder__field">
            <span>Description</span>
            <textarea
              rows={2}
              value={link.description || ""}
              onChange={(event) =>
                updateLink(sectionId, index, {
                  description: event.target.value || undefined,
                })
              }
            />
          </label>
        </div>
      ))}
    </div>
  );
}

function InlineTextInput({
  ariaLabel,
  className = "",
  onChange,
  placeholder,
  value,
}: {
  ariaLabel: string;
  className?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <input
      aria-label={ariaLabel}
      className={`home-canvas__inline-input ${className}`.trim()}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onClick={(event) => event.stopPropagation()}
    />
  );
}

function EditableImageCanvas({
  alt,
  caption,
  className,
  emptyLabel = "Choose image",
  fit = "cover",
  onAltChange,
  onCaptionChange,
  onUpload,
  shape,
  src,
  uploading,
}: {
  alt: string;
  caption?: string;
  className: string;
  emptyLabel?: string;
  fit?: "cover" | "contain";
  onAltChange?: (value: string) => void;
  onCaptionChange?: (value: string) => void;
  onUpload: (file: File | null) => void;
  shape?: string;
  src: string;
  uploading: boolean;
}) {
  return (
    <div
      className={[
        className,
        "home-canvas__image",
        shape ? `home-canvas__image--${shape}` : "",
      ].join(" ")}
      onClick={(event) => event.stopPropagation()}
    >
      <label className="home-canvas__image-picker">
        {src ? (
          // Tauri workspace renders local/admin-uploaded assets, not Next public pages.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={alt || emptyLabel}
            src={src}
            style={{ objectFit: fit }}
            draggable={false}
          />
        ) : (
          <span>{uploading ? "Uploading…" : emptyLabel}</span>
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif"
          disabled={uploading}
          onChange={(event) => {
            onUpload(event.target.files?.[0] ?? null);
            event.currentTarget.value = "";
          }}
        />
      </label>
      {onAltChange ? (
        <input
          aria-label="Image alt text"
          className="home-canvas__caption-input"
          value={alt}
          placeholder="Alt text"
          onChange={(event) => onAltChange(event.target.value)}
        />
      ) : null}
      {onCaptionChange ? (
        <input
          aria-label="Image caption"
          className="home-canvas__caption-input"
          value={caption || ""}
          placeholder="Caption"
          onChange={(event) => onCaptionChange(event.target.value)}
        />
      ) : null}
    </div>
  );
}

function EditableHeroSection({
  onUploadImage,
  patchSection,
  resolveAssetUrl,
  section,
  uploading,
}: {
  onUploadImage: (file: File | null) => void;
  patchSection: (id: string, mapper: (section: HomeSection) => HomeSection) => void;
  resolveAssetUrl: (url: string | undefined) => string;
  section: HomeHeroSection;
  uploading: boolean;
}) {
  const showImage = section.imagePosition !== "none";
  return (
    <div
      className={[
        "home-preview-hero",
        "home-canvas__editable-section",
        `home-preview-hero--${showImage ? section.imagePosition : "none"}`,
        `home-preview--align-${section.textAlign}`,
      ].join(" ")}
    >
      {showImage ? (
        <EditableImageCanvas
          alt={section.profileImageAlt || ""}
          className="home-preview-hero__image"
          emptyLabel="Hero image"
          src={resolveAssetUrl(section.profileImageUrl)}
          uploading={uploading}
          onUpload={onUploadImage}
          onAltChange={(value) =>
            patchSection(section.id, (current) =>
              current.type === "hero"
                ? { ...current, profileImageAlt: value || undefined }
                : current,
            )
          }
        />
      ) : null}
      <div className="home-canvas__text-stack">
        <InlineTextInput
          ariaLabel="Hero title"
          className="home-canvas__heading-input home-canvas__heading-input--hero"
          value={section.title}
          placeholder="Hero title"
          onChange={(value) =>
            patchSection(section.id, (current) =>
              current.type === "hero" ? { ...current, title: value } : current,
            )
          }
        />
        <BlocksEditor
          value={section.body}
          placeholder="Hero copy"
          minHeight={120}
          onChange={(value) =>
            patchSection(section.id, (current) =>
              current.type === "hero" ? { ...current, body: value } : current,
            )
          }
        />
      </div>
    </div>
  );
}

function EditableRichTextSection({
  patchSection,
  section,
}: {
  patchSection: (id: string, mapper: (section: HomeSection) => HomeSection) => void;
  section: HomeRichTextSection;
}) {
  return (
    <div
      className={[
        "home-preview-rich",
        "home-canvas__editable-section",
        `home-preview-rich--${section.tone}`,
        `home-preview-rich--variant-${section.variant}`,
        `home-preview--align-${section.textAlign}`,
      ].join(" ")}
    >
      <InlineTextInput
        ariaLabel="Section title"
        className="home-canvas__heading-input"
        value={section.title || ""}
        placeholder="Section title"
        onChange={(value) =>
          patchSection(section.id, (current) =>
            current.type === "richText"
              ? { ...current, title: value || undefined }
              : current,
          )
        }
      />
      <BlocksEditor
        value={section.body}
        placeholder="Section body"
        minHeight={120}
        onChange={(value) =>
          patchSection(section.id, (current) =>
            current.type === "richText" ? { ...current, body: value } : current,
          )
        }
      />
    </div>
  );
}

function EditableLinkListSection({
  addLink,
  moveLink,
  patchSection,
  removeLink,
  section,
  updateLink,
}: {
  addLink: (sectionId: string) => void;
  moveLink: (sectionId: string, index: number, direction: -1 | 1) => void;
  patchSection: (id: string, mapper: (section: HomeSection) => HomeSection) => void;
  removeLink: (sectionId: string, index: number) => void;
  section: HomeLinkListSection;
  updateLink: (sectionId: string, index: number, patch: Partial<HomeLink>) => void;
}) {
  return (
    <div className={`home-preview-links home-preview-links--${section.layout}`}>
      <InlineTextInput
        ariaLabel="Links title"
        className="home-canvas__heading-input"
        value={section.title || ""}
        placeholder="Links title"
        onChange={(value) =>
          patchSection(section.id, (current) =>
            current.type === "linkList"
              ? { ...current, title: value || undefined }
              : current,
          )
        }
      />
      <BlocksEditor
        value={section.body || ""}
        placeholder="Intro"
        minHeight={96}
        onChange={(value) =>
          patchSection(section.id, (current) =>
            current.type === "linkList"
              ? { ...current, body: value || undefined }
              : current,
          )
        }
      />
      <div className="home-preview-links__items home-canvas__editable-links">
        {section.links.map((link, index) => (
          <div className="home-canvas__editable-link" key={`${section.id}-${index}`}>
            <input
              aria-label="Link label"
              value={link.label}
              placeholder="Label"
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => updateLink(section.id, index, { label: event.target.value })}
            />
            <input
              aria-label="Link URL"
              value={link.href}
              placeholder="/path or https://"
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => updateLink(section.id, index, { href: event.target.value })}
            />
            <div
              className="home-canvas__mini-actions"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                disabled={index === 0}
                onClick={() => moveLink(section.id, index, -1)}
                aria-label="Move link up"
              >
                ↑
              </button>
              <button
                type="button"
                disabled={index === section.links.length - 1}
                onClick={() => moveLink(section.id, index, 1)}
                aria-label="Move link down"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => removeLink(section.id, index)}
                aria-label="Remove link"
              >
                ×
              </button>
            </div>
          </div>
        ))}
        <button
          className="home-canvas__add-card"
          type="button"
          onClick={() => addLink(section.id)}
        >
          + Link
        </button>
      </div>
    </div>
  );
}

function EditableFeaturedPagesSection({
  addLink,
  moveLink,
  patchSection,
  removeLink,
  section,
  updateLink,
}: {
  addLink: (sectionId: string) => void;
  moveLink: (sectionId: string, index: number, direction: -1 | 1) => void;
  patchSection: (id: string, mapper: (section: HomeSection) => HomeSection) => void;
  removeLink: (sectionId: string, index: number) => void;
  section: HomeFeaturedPagesSection;
  updateLink: (sectionId: string, index: number, patch: Partial<HomeLink>) => void;
}) {
  return (
    <div className={`home-preview-featured home-preview-featured--cols-${section.columns}`}>
      <InlineTextInput
        ariaLabel="Featured pages title"
        className="home-canvas__heading-input"
        value={section.title || ""}
        placeholder="Featured pages title"
        onChange={(value) =>
          patchSection(section.id, (current) =>
            current.type === "featuredPages"
              ? { ...current, title: value || undefined }
              : current,
          )
        }
      />
      <BlocksEditor
        value={section.body || ""}
        placeholder="Intro"
        minHeight={96}
        onChange={(value) =>
          patchSection(section.id, (current) =>
            current.type === "featuredPages"
              ? { ...current, body: value || undefined }
              : current,
          )
        }
      />
      <div className="home-preview-featured__items home-canvas__editable-links">
        {section.items.map((item, index) => (
          <article className="home-canvas__editable-link" key={`${section.id}-${index}`}>
            <input
              aria-label="Featured page label"
              value={item.label}
              placeholder="Label"
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => updateLink(section.id, index, { label: event.target.value })}
            />
            <input
              aria-label="Featured page URL"
              value={item.href}
              placeholder="/path"
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => updateLink(section.id, index, { href: event.target.value })}
            />
            <textarea
              aria-label="Featured page description"
              rows={2}
              value={item.description || ""}
              placeholder="Description"
              onClick={(event) => event.stopPropagation()}
              onChange={(event) =>
                updateLink(section.id, index, {
                  description: event.target.value || undefined,
                })
              }
            />
            <div
              className="home-canvas__mini-actions"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                disabled={index === 0}
                onClick={() => moveLink(section.id, index, -1)}
                aria-label="Move featured page up"
              >
                ↑
              </button>
              <button
                type="button"
                disabled={index === section.items.length - 1}
                onClick={() => moveLink(section.id, index, 1)}
                aria-label="Move featured page down"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => removeLink(section.id, index)}
                aria-label="Remove featured page"
              >
                ×
              </button>
            </div>
          </article>
        ))}
        <button
          className="home-canvas__add-card"
          type="button"
          onClick={() => addLink(section.id)}
        >
          + Page
        </button>
      </div>
    </div>
  );
}

function EditableLayoutSection({
  addLayoutBlock,
  moveLayoutBlock,
  patchLayoutBlock,
  patchSection,
  removeLayoutBlock,
  resolveAssetUrl,
  section,
  uploadLayoutImage,
  uploadingId,
}: {
  addLayoutBlock: (sectionId: string, type: HomeLayoutBlockType, column?: number) => void;
  moveLayoutBlock: (sectionId: string, index: number, direction: -1 | 1) => void;
  patchLayoutBlock: (
    sectionId: string,
    blockId: string,
    mapper: (block: HomeLayoutBlock) => HomeLayoutBlock,
  ) => void;
  patchSection: (id: string, mapper: (section: HomeSection) => HomeSection) => void;
  removeLayoutBlock: (sectionId: string, blockId: string) => void;
  resolveAssetUrl: (url: string | undefined) => string;
  section: HomeLayoutSection;
  uploadLayoutImage: (block: HomeImageBlock, file: File | null) => void;
  uploadingId: string;
}) {
  const columns = Array.from({ length: section.columns }, (_, index) => index + 1);
  return (
    <div
      className={[
        "home-preview-layout",
        "home-canvas__editable-section",
        `home-preview-layout--variant-${section.variant}`,
        `home-preview-layout--cols-${section.columns}`,
        `home-preview-layout--gap-${section.gap}`,
        `home-preview-layout--align-${section.verticalAlign}`,
      ].join(" ")}
    >
      <InlineTextInput
        ariaLabel="Layout title"
        className="home-canvas__heading-input"
        value={section.title || ""}
        placeholder="Layout title"
        onChange={(value) =>
          patchSection(section.id, (current) =>
            current.type === "layout" ? { ...current, title: value } : current,
          )
        }
      />
      <div className="home-preview-layout__grid">
        {columns.map((column) => (
          <div className="home-preview-layout__column home-canvas__layout-column" key={column}>
            {section.blocks
              .map((block, index) => ({ block, index }))
              .filter(({ block }) => block.column === column)
              .map(({ block, index }) =>
                block.type === "image" ? (
                  <div className="home-canvas__editable-block" key={block.id}>
                    <BlockCanvasToolbar
                      index={index}
                      total={section.blocks.length}
                      onMove={(direction) => moveLayoutBlock(section.id, index, direction)}
                      onRemove={() => removeLayoutBlock(section.id, block.id)}
                    />
                    <EditableImageCanvas
                      alt={block.alt || ""}
                      caption={block.caption}
                      className={`home-preview-layout__image home-preview-layout__image--${block.shape}`}
                      fit={block.fit}
                      shape={block.shape}
                      src={resolveAssetUrl(block.url)}
                      uploading={uploadingId === block.id}
                      onUpload={(file) => uploadLayoutImage(block, file)}
                      onAltChange={(value) =>
                        patchLayoutBlock(section.id, block.id, (current) =>
                          current.type === "image" ? { ...current, alt: value } : current,
                        )
                      }
                      onCaptionChange={(value) =>
                        patchLayoutBlock(section.id, block.id, (current) =>
                          current.type === "image"
                            ? { ...current, caption: value || undefined }
                            : current,
                        )
                      }
                    />
                  </div>
                ) : (
                  <div
                    className={`home-canvas__editable-block home-preview-layout__markdown home-preview-rich--${block.tone}`}
                    key={block.id}
                  >
                    <BlockCanvasToolbar
                      index={index}
                      total={section.blocks.length}
                      onMove={(direction) => moveLayoutBlock(section.id, index, direction)}
                      onRemove={() => removeLayoutBlock(section.id, block.id)}
                    />
                    <InlineTextInput
                      ariaLabel="Block title"
                      className="home-canvas__subheading-input"
                      value={block.title || ""}
                      placeholder="Block title"
                      onChange={(value) =>
                        patchLayoutBlock(section.id, block.id, (current) =>
                          current.type === "markdown"
                            ? { ...current, title: value || undefined }
                            : current,
                        )
                      }
                    />
                    <BlocksEditor
                      value={block.body}
                      placeholder="Text"
                      minHeight={96}
                      onChange={(value) =>
                        patchLayoutBlock(section.id, block.id, (current) =>
                          current.type === "markdown" ? { ...current, body: value } : current,
                        )
                      }
                    />
                  </div>
                ),
              )}
            <div className="home-canvas__column-add">
              <button type="button" onClick={() => addLayoutBlock(section.id, "markdown", column)}>
                + Text
              </button>
              <button type="button" onClick={() => addLayoutBlock(section.id, "image", column)}>
                + Image
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BlockCanvasToolbar({
  index,
  onMove,
  onRemove,
  total,
}: {
  index: number;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  total: number;
}) {
  return (
    <div className="home-canvas__block-toolbar" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        disabled={index === 0}
        onClick={() => onMove(-1)}
        aria-label="Move block up"
      >
        ↑
      </button>
      <button
        type="button"
        disabled={index === total - 1}
        onClick={() => onMove(1)}
        aria-label="Move block down"
      >
        ↓
      </button>
      <button type="button" onClick={onRemove} aria-label="Remove block">
        ×
      </button>
    </div>
  );
}

function HeroPreview({ section }: { section: HomeHeroSection }) {
  const showImage = section.profileImageUrl && section.imagePosition !== "none";
  return (
    <div
      className={[
        "home-preview-hero",
        `home-preview-hero--${showImage ? section.imagePosition : "none"}`,
        `home-preview--align-${section.textAlign}`,
      ].join(" ")}
    >
      {showImage && (
        <div className="home-preview-hero__image">
          <span>{section.profileImageAlt || "Image"}</span>
        </div>
      )}
      <PreviewText>{section.body}</PreviewText>
    </div>
  );
}

function RichTextPreview({ section }: { section: HomeRichTextSection }) {
  return (
    <div
      className={[
        "home-preview-rich",
        `home-preview-rich--${section.tone}`,
        `home-preview-rich--variant-${section.variant}`,
      ].join(" ")}
    >
      {section.title && <h3>{section.title}</h3>}
      <PreviewText>{section.body}</PreviewText>
    </div>
  );
}

function LinkListPreview({ section }: { section: HomeLinkListSection }) {
  return (
    <div className={`home-preview-links home-preview-links--${section.layout}`}>
      {section.title && <h3>{section.title}</h3>}
      {section.body && <PreviewText>{section.body}</PreviewText>}
      <div className="home-preview-links__items">
        {section.links.map((link, index) => (
          <span key={`${link.href}-${index}`}>{link.label || link.href}</span>
        ))}
      </div>
    </div>
  );
}

function FeaturedPagesPreview({ section }: { section: HomeFeaturedPagesSection }) {
  return (
    <div className={`home-preview-featured home-preview-featured--cols-${section.columns}`}>
      {section.title && <h3>{section.title}</h3>}
      {section.body && <PreviewText>{section.body}</PreviewText>}
      <div className="home-preview-featured__items">
        {section.items.map((item, index) => (
          <article key={`${item.href}-${index}`}>
            <strong>{item.label || item.href}</strong>
            {item.description && <p>{item.description}</p>}
          </article>
        ))}
      </div>
    </div>
  );
}

function LayoutPreview({ section }: { section: HomeLayoutSection }) {
  const columns = Array.from({ length: section.columns }, (_, index) => index + 1);
  return (
    <div
      className={[
        "home-preview-layout",
        `home-preview-layout--variant-${section.variant}`,
        `home-preview-layout--cols-${section.columns}`,
        `home-preview-layout--gap-${section.gap}`,
        `home-preview-layout--align-${section.verticalAlign}`,
      ].join(" ")}
    >
      {section.title && <h3>{section.title}</h3>}
      <div className="home-preview-layout__grid">
        {columns.map((column) => (
          <div className="home-preview-layout__column" key={column}>
            {section.blocks
              .filter((block) => block.column === column)
              .map((block) =>
                block.type === "image" ? (
                  <div
                    className={[
                      "home-preview-layout__image",
                      `home-preview-layout__image--${block.shape}`,
                    ].join(" ")}
                    key={block.id}
                  >
                    <span>{block.alt || block.url || "Image"}</span>
                  </div>
                ) : (
                  <div
                    className={`home-preview-layout__markdown home-preview-rich--${block.tone}`}
                    key={block.id}
                  >
                    {block.title && <h4>{block.title}</h4>}
                    <PreviewText>{block.body}</PreviewText>
                  </div>
                ),
              )}
          </div>
        ))}
      </div>
    </div>
  );
}
