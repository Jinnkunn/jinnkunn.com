import { useCallback, useEffect, useState } from "react";
import { ListDetailLayout } from "./ListDetailLayout";
import { PageEditor } from "./PageEditor";
import { PublishButton } from "./PublishButton";
import { useSiteAdmin } from "./state";
import type { ItemSelection, PageListRow } from "./types";
import { normalizeString } from "./utils";

export interface PagesPanelProps {
  selected: ItemSelection;
  onSelectedChange: (next: ItemSelection) => void;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asInteger(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizePageListRow(raw: unknown): PageListRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const slug = normalizeString(r.slug);
  if (!slug) return null;
  return {
    slug,
    href: normalizeString(r.href) || `/pages/${slug}`,
    title: normalizeString(r.title) || slug,
    description: (r.description as string | null) ?? null,
    updatedIso: (r.updatedIso as string | null) ?? null,
    draft: asBoolean(r.draft),
    wordCount: asInteger(r.wordCount),
    readingMinutes: asInteger(r.readingMinutes),
    version: normalizeString(r.version),
  };
}

export function PagesPanel({ selected, onSelectedChange }: PagesPanelProps) {
  const { connection, request, setMessage, setPagesIndex } = useSiteAdmin();
  const [rows, setRows] = useState<PageListRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState("");
  const [includeDrafts, setIncludeDrafts] = useState(true);

  const ready = Boolean(connection.baseUrl) && Boolean(connection.authToken);

  const refresh = useCallback(async () => {
    if (!ready) return;
    setLoadingList(true);
    setError("");
    const path = `/api/site-admin/pages${includeDrafts ? "?drafts=1" : ""}`;
    const response = await request(path, "GET");
    setLoadingList(false);
    if (!response.ok) {
      const msg = `${response.code}: ${response.error}`;
      setError(msg);
      setMessage("error", `Load pages failed: ${msg}`);
      return;
    }
    const data = (response.data ?? {}) as Record<string, unknown>;
    const rawPages = Array.isArray(data.pages) ? data.pages : [];
    const parsed: PageListRow[] = [];
    for (const raw of rawPages) {
      const row = normalizePageListRow(raw);
      if (row) parsed.push(row);
    }
    setRows(parsed);
    setPagesIndex(parsed);
    setMessage("success", `Loaded ${parsed.length} page${parsed.length === 1 ? "" : "s"}.`);
  }, [includeDrafts, ready, request, setMessage, setPagesIndex]);

  useEffect(() => {
    // Auto-load pages list once the connection is ready. See PostsPanel.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (ready) void refresh();
  }, [ready, refresh]);

  const onEditorExit = useCallback(
    (action: "saved" | "deleted" | "cancel") => {
      onSelectedChange(null);
      if (action !== "cancel") void refresh();
    },
    [onSelectedChange, refresh],
  );

  const listHeader = (
    <div className="list-detail__list-toolbar">
      <label className="list-detail__drafts-toggle">
        <input
          type="checkbox"
          checked={includeDrafts}
          onChange={(event) => setIncludeDrafts(event.target.checked)}
        />
        <span>Drafts</span>
      </label>
      <button
        className="btn btn--ghost list-detail__refresh"
        type="button"
        onClick={() => void refresh()}
        disabled={!ready || loadingList}
      >
        {loadingList ? "…" : "Refresh"}
      </button>
    </div>
  );

  const list =
    rows.length === 0 && !loadingList ? (
      <div className="list-detail__empty list-detail__empty--cta">
        <span className="list-detail__empty-icon" aria-hidden="true">+</span>
        <strong>No pages yet</strong>
        <span>Create the first standalone MDX page.</span>
        <button
          className="btn btn--primary"
          type="button"
          onClick={() => onSelectedChange({ kind: "new" })}
          disabled={!ready}
        >
          New page
        </button>
      </div>
    ) : (
      <ul className="list-detail__rows" role="list">
        {rows.map((row) => {
          const active = selected?.kind === "edit" && selected.slug === row.slug;
          return (
            <li key={row.slug}>
              <button
                type="button"
                className="list-detail__row"
                aria-current={active ? "true" : undefined}
                onClick={() => onSelectedChange({ kind: "edit", slug: row.slug })}
              >
                <span className="list-detail__row-title" title={row.title}>
                  {row.title}
                </span>
                <span className="list-detail__row-meta">
                  {row.updatedIso || "—"}
                  {row.draft ? (
                    <span className="list-detail__draft-dot" title="Draft">
                      ●
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );

  let detail: React.ReactNode;
  if (selected === null) {
    detail = (
      <div className="list-detail__empty-detail">
        <p>Select a page to edit, or start a new one.</p>
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
    detail = (
      <PageEditor
        mode="create"
        slug={selected.initialSlug}
        onExit={onEditorExit}
      />
    );
  } else {
    detail = (
      <PageEditor
        mode="edit"
        slug={selected.slug}
        onExit={onEditorExit}
        key={selected.slug}
      />
    );
  }

  const headerActions = (
    <>
      <button
        className="btn btn--primary"
        type="button"
        onClick={() => onSelectedChange({ kind: "new" })}
        disabled={!ready}
      >
        New page
      </button>
      <PublishButton />
    </>
  );

  return (
    <ListDetailLayout
      title="Pages"
      description="Standalone MDX pages under content/pages/*.mdx."
      headerActions={headerActions}
      listHeader={listHeader}
      list={list}
      detail={detail}
      error={error}
    />
  );
}
