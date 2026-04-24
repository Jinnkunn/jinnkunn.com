import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDragReorder } from "./shared/useDragReorder";
import { AssetLibraryPicker, rememberRecentAsset } from "./AssetLibraryPicker";
import { JsonDraftRestoreBanner } from "./JsonDraftRestoreBanner";
import { MarkdownEditor } from "./LazyMarkdownEditor";
import { VersionHistoryPanel } from "./VersionHistoryPanel";
import { useSiteAdmin } from "./state";
import { useJsonDraft } from "./use-json-draft";
import { uploadImageFile } from "./assets-upload";
import { buildHomePreviewDocument } from "./home-builder/preview-document";
import {
  BLANK_HOME_DATA,
  SECTION_LABELS,
  clone,
  createId,
  createSection,
  normalizeHomeData,
  prepareHomeDataForSave,
  sameData,
  sectionSummary,
  sectionTitle,
} from "./home-builder/schema";
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

export function HomePanel() {
  const { connection, request, setMessage } = useSiteAdmin();
  const [baseData, setBaseData] = useState<HomeData>(BLANK_HOME_DATA);
  const [draft, setDraft] = useState<HomeData>(BLANK_HOME_DATA);
  const [selectedId, setSelectedId] = useState(BLANK_HOME_DATA.sections[0]?.id || "");
  const [fileSha, setFileSha] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewStylesheets, setPreviewStylesheets] = useState<string[]>([]);
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewTimerRef = useRef<number | null>(null);
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);

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
    [ready, request, setMessage],
  );

  useEffect(() => {
    if (!ready) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData({ silent: true });
  }, [ready, loadData]);

  useEffect(() => {
    if (!ready) return;
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current);
    }
    previewTimerRef.current = window.setTimeout(async () => {
      setPreviewLoading(true);
      setPreviewError("");
      const response = await request("/api/site-admin/preview/home", "POST", {
        data: prepareHomeDataForSave(draft),
      });
      setPreviewLoading(false);
      if (!response.ok) {
        setPreviewHtml("");
        setPreviewStylesheets([]);
        setPreviewError(`${response.code}: ${response.error}`);
        return;
      }
      const data = (response.data ?? {}) as Record<string, unknown>;
      setPreviewHtml(typeof data.html === "string" ? data.html : "");
      setPreviewStylesheets(
        Array.isArray(data.stylesheets)
          ? data.stylesheets.filter((href): href is string => typeof href === "string")
          : [],
      );
    }, 650);
    return () => {
      if (previewTimerRef.current !== null) {
        window.clearTimeout(previewTimerRef.current);
        previewTimerRef.current = null;
      }
    };
  }, [draft, ready, request]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== previewFrameRef.current?.contentWindow) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.type !== "site-admin:home-section-select") return;
      const id = typeof data.id === "string" ? data.id : "";
      if (draft.sections.some((section) => section.id === id)) {
        setSelectedId(id);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [draft.sections]);

  useEffect(() => {
    const frame = previewFrameRef.current;
    frame?.contentWindow?.postMessage(
      { type: "site-admin:home-section-highlight", id: selectedSectionId },
      "*",
    );
  }, [previewHtml, selectedSectionId]);

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
    [patchSections],
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
    [patchSections],
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
    (sectionId: string, type: HomeLayoutBlockType) => {
      patchSection(sectionId, (section) => {
        if (section.type !== "layout") return section;
        const block =
          type === "image"
            ? ({
                id: createId(type),
                type,
                column: section.columns === 1 ? 1 : 2,
                url: "",
                alt: "",
                caption: "",
                shape: "rounded",
                fit: "cover",
              } satisfies HomeImageBlock)
            : ({
                id: createId(type),
                type,
                column: 1,
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

  const stateNote = loading
    ? "Loading…"
    : conflict
      ? "Conflict detected. Reload before saving."
      : dirty
        ? "Unsaved changes."
        : "In sync.";

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

      <div className="home-builder">
        <aside className="home-builder__rail" aria-label="Home sections">
          <div className="home-builder__add">
            {(Object.keys(SECTION_LABELS) as HomeSectionType[]).map((type) => (
              <button
                className="btn btn--secondary home-builder__add-btn"
                key={type}
                type="button"
                onClick={() => addSection(type)}
              >
                + {SECTION_LABELS[type]}
              </button>
            ))}
          </div>

          <div className="home-builder__section-list">
            {draft.sections.map((section, index) => {
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
                    type="button"
                    className="drag-handle"
                    title="Drag to reorder"
                    aria-label="Drag section to reorder"
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
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => moveSection(index, -1)}
                      disabled={index === 0}
                      aria-label="Move section up"
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => moveSection(index, 1)}
                      disabled={index === draft.sections.length - 1}
                      aria-label="Move section down"
                      title="Move down"
                    >
                      ↓
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        <main className="home-builder__preview" aria-label="Home preview">
          <div className="home-preview__chrome">
            <span />
            <span />
            <span />
            <strong>
              {previewLoading
                ? "Rendering preview…"
                : previewError
                  ? `Preview error: ${previewError}`
                  : "Live front-end preview"}
            </strong>
          </div>
          {previewHtml ? (
            <iframe
              ref={previewFrameRef}
              className="home-preview__iframe"
              title="Rendered home preview"
              srcDoc={buildHomePreviewDocument(
                previewHtml,
                connection.baseUrl,
                previewStylesheets,
              )}
              onLoad={() =>
                previewFrameRef.current?.contentWindow?.postMessage(
                  { type: "site-admin:home-section-highlight", id: selectedSectionId },
                  "*",
                )
              }
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
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedId(section.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(section.id);
                      }
                    }}
                  >
                    {section.type === "hero" && <HeroPreview section={section} />}
                    {section.type === "richText" && <RichTextPreview section={section} />}
                    {section.type === "linkList" && <LinkListPreview section={section} />}
                    {section.type === "featuredPages" && (
                      <FeaturedPagesPreview section={section} />
                    )}
                    {section.type === "layout" && <LayoutPreview section={section} />}
                  </div>
                ))}
            </div>
          )}
        </main>

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
                    onChange={(event) =>
                      patchSection(selectedSection.id, (section) => ({
                        ...section,
                        enabled: event.target.checked,
                      }))
                    }
                  />
                  Enabled
                </label>
              </div>

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

              <div className="home-builder__danger-zone">
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => duplicateSection(selectedSection)}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  className="btn btn--danger"
                  onClick={() => removeSection(selectedSection.id)}
                  disabled={draft.sections.length <= 1}
                >
                  Remove
                </button>
              </div>
            </>
          ) : (
            <p className="empty-note">Select a section to edit its properties.</p>
          )}
        </aside>
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
        <span>Hero body (markdown)</span>
        <MarkdownEditor
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
        <span>Body (markdown)</span>
        <MarkdownEditor
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
        <span>Intro (markdown)</span>
        <MarkdownEditor
          value={section.body || ""}
          onChange={(event) =>
            patchSection(section.id, (current) =>
              current.type === "linkList"
                ? { ...current, body: event || undefined }
                : current,
            )
          }
          minHeight={112}
          showToolbar={false}
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
        <span>Intro (markdown)</span>
        <MarkdownEditor
          value={section.body || ""}
          onChange={(event) =>
            patchSection(section.id, (current) =>
              current.type === "featuredPages"
                ? { ...current, body: event || undefined }
                : current,
            )
          }
          minHeight={112}
          showToolbar={false}
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
  addLayoutBlock: (sectionId: string, type: HomeLayoutBlockType) => void;
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
        <span>Body (markdown)</span>
        <MarkdownEditor
          value={block.body}
          onChange={(value) =>
            patchLayoutBlock(sectionId, block.id, (current) =>
              current.type === "markdown" ? { ...current, body: value } : current,
            )
          }
          minHeight={126}
          showToolbar={false}
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
