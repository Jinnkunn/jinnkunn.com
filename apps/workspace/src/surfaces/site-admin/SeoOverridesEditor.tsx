import { useCallback, useMemo, useState } from "react";

// Structured editor for the `seoPageOverrides` JSON field on SiteSettings.
// Parses the stored JSON, exposes a table of rows (path, title, description,
// ogImage, canonicalPath, noindex), and serializes back to a sorted JSON
// string. The parent owns the underlying string so this stays controlled.

export interface SeoOverrideRow {
  path: string;
  title: string;
  description: string;
  ogImage: string;
  canonicalPath: string;
  noindex: boolean;
}

function normalizeRoutePath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (withLeading === "/") return "/";
  return withLeading.replace(/\/+$/, "");
}

function parseOverrides(json: string): SeoOverrideRow[] {
  if (!json.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const out: SeoOverrideRow[] = [];
  for (const [rawPath, rawValue] of Object.entries(parsed as Record<string, unknown>)) {
    const path = normalizeRoutePath(rawPath);
    if (!path) continue;
    const row: SeoOverrideRow = {
      path,
      title: "",
      description: "",
      ogImage: "",
      canonicalPath: "",
      noindex: false,
    };
    if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
      const obj = rawValue as Record<string, unknown>;
      if (typeof obj.title === "string") row.title = obj.title;
      if (typeof obj.description === "string") row.description = obj.description;
      if (typeof obj.ogImage === "string") row.ogImage = obj.ogImage;
      if (typeof obj.canonicalPath === "string") row.canonicalPath = obj.canonicalPath;
      if (typeof obj.noindex === "boolean") row.noindex = obj.noindex;
    }
    out.push(row);
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

function serializeOverrides(rows: SeoOverrideRow[]): string {
  const obj: Record<string, Record<string, unknown>> = {};
  const keys: string[] = [];
  for (const row of rows) {
    const path = normalizeRoutePath(row.path);
    if (!path) continue;
    const entry: Record<string, unknown> = {};
    if (row.title.trim()) entry.title = row.title.trim();
    if (row.description.trim()) entry.description = row.description.trim();
    if (row.ogImage.trim()) entry.ogImage = row.ogImage.trim();
    if (row.canonicalPath.trim()) entry.canonicalPath = row.canonicalPath.trim();
    if (row.noindex) entry.noindex = true;
    if (Object.keys(entry).length === 0) continue;
    if (!obj[path]) keys.push(path);
    obj[path] = entry;
  }
  if (keys.length === 0) return "";
  keys.sort((a, b) => a.localeCompare(b));
  const ordered: Record<string, unknown> = {};
  for (const key of keys) ordered[key] = obj[key];
  return JSON.stringify(ordered, null, 2);
}

function blankRow(): SeoOverrideRow {
  return {
    path: "/",
    title: "",
    description: "",
    ogImage: "",
    canonicalPath: "",
    noindex: false,
  };
}

export function SeoOverridesEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (nextJson: string) => void;
}) {
  const rows = useMemo(() => parseOverrides(value), [value]);
  const [showRaw, setShowRaw] = useState(false);
  const [newRow, setNewRow] = useState<SeoOverrideRow>(blankRow());

  const commitRows = useCallback(
    (nextRows: SeoOverrideRow[]) => {
      onChange(serializeOverrides(nextRows));
    },
    [onChange],
  );

  const updateRow = useCallback(
    (index: number, patch: Partial<SeoOverrideRow>) => {
      const next = rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
      commitRows(next);
    },
    [commitRows, rows],
  );

  const removeRow = useCallback(
    (index: number) => {
      const next = rows.filter((_, i) => i !== index);
      commitRows(next);
    },
    [commitRows, rows],
  );

  const addRow = useCallback(() => {
    if (!normalizeRoutePath(newRow.path)) return;
    const next = [...rows.filter((r) => r.path !== newRow.path), newRow];
    commitRows(next);
    setNewRow(blankRow());
  }, [commitRows, newRow, rows]);

  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="text-[13px] font-semibold text-text-primary">
            SEO page overrides
          </div>
          <div className="text-[11.5px] text-text-muted">
            Per-route SEO metadata. Empty fields fall back to the defaults.
          </div>
        </div>
        <label className="text-[12px] text-text-muted flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={showRaw}
            onChange={(event) => setShowRaw(event.target.checked)}
          />
          Show raw JSON
        </label>
      </header>

      <div className="overflow-hidden rounded-[10px] border border-border-subtle bg-bg-surface">
        <table className="w-full text-[12px]" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "18%" }} />
            <col style={{ width: "22%" }} />
            <col style={{ width: "26%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "8%" }} />
          </colgroup>
          <thead>
            <tr className="text-left text-text-muted">
              <th className="px-2 py-1.5 font-medium">Path</th>
              <th className="px-2 py-1.5 font-medium">Title</th>
              <th className="px-2 py-1.5 font-medium">Description</th>
              <th className="px-2 py-1.5 font-medium">OG image</th>
              <th className="px-2 py-1.5 font-medium text-center">Noindex</th>
              <th className="px-2 py-1.5 font-medium text-right"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-2 py-3 text-center text-[11.5px] text-text-muted"
                >
                  No overrides yet. Add one below.
                </td>
              </tr>
            )}
            {rows.map((row, index) => (
              <tr key={row.path + index}>
                <td className="px-2 py-1">
                  <input
                    className="ds-input"
                    style={{ fontSize: 12 }}
                    value={row.path}
                    onChange={(event) => updateRow(index, { path: event.target.value })}
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    className="ds-input"
                    style={{ fontSize: 12 }}
                    value={row.title}
                    onChange={(event) => updateRow(index, { title: event.target.value })}
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    className="ds-input"
                    style={{ fontSize: 12 }}
                    value={row.description}
                    onChange={(event) =>
                      updateRow(index, { description: event.target.value })
                    }
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    className="ds-input"
                    style={{ fontSize: 12 }}
                    value={row.ogImage}
                    onChange={(event) => updateRow(index, { ogImage: event.target.value })}
                  />
                </td>
                <td className="px-2 py-1 text-center">
                  <input
                    type="checkbox"
                    checked={row.noindex}
                    onChange={(event) =>
                      updateRow(index, { noindex: event.target.checked })
                    }
                  />
                </td>
                <td className="px-2 py-1 text-right">
                  <button
                    type="button"
                    className="btn btn--secondary"
                    style={{ padding: "2px 8px", fontSize: 11.5 }}
                    onClick={() => removeRow(index)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            <tr style={{ background: "var(--bg-subtle,#fafafa)" }}>
              <td className="px-2 py-1">
                <input
                  className="ds-input"
                  style={{ fontSize: 12 }}
                  value={newRow.path}
                  placeholder="/path"
                  onChange={(event) => setNewRow((r) => ({ ...r, path: event.target.value }))}
                />
              </td>
              <td className="px-2 py-1">
                <input
                  className="ds-input"
                  style={{ fontSize: 12 }}
                  value={newRow.title}
                  placeholder="Title"
                  onChange={(event) =>
                    setNewRow((r) => ({ ...r, title: event.target.value }))
                  }
                />
              </td>
              <td className="px-2 py-1">
                <input
                  className="ds-input"
                  style={{ fontSize: 12 }}
                  value={newRow.description}
                  placeholder="Description"
                  onChange={(event) =>
                    setNewRow((r) => ({ ...r, description: event.target.value }))
                  }
                />
              </td>
              <td className="px-2 py-1">
                <input
                  className="ds-input"
                  style={{ fontSize: 12 }}
                  value={newRow.ogImage}
                  placeholder="/og.png"
                  onChange={(event) =>
                    setNewRow((r) => ({ ...r, ogImage: event.target.value }))
                  }
                />
              </td>
              <td className="px-2 py-1 text-center">
                <input
                  type="checkbox"
                  checked={newRow.noindex}
                  onChange={(event) =>
                    setNewRow((r) => ({ ...r, noindex: event.target.checked }))
                  }
                />
              </td>
              <td className="px-2 py-1 text-right">
                <button
                  type="button"
                  className="btn btn--primary"
                  style={{ padding: "2px 8px", fontSize: 11.5 }}
                  onClick={addRow}
                  disabled={!normalizeRoutePath(newRow.path)}
                >
                  Add
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {showRaw && (
        <details open className="surface-details">
          <summary className="text-[12px] text-text-muted">Raw JSON</summary>
          <pre
            className="debug-pane m-0"
            style={{ fontSize: 11.5, lineHeight: 1.5 }}
          >
            {value || "{}"}
          </pre>
        </details>
      )}
    </div>
  );
}
