import type { ConfigSourceVersion, NavRow } from "../types";
import { isNavDirty, toInteger } from "../utils";

export interface NewNavInput {
  label: string;
  href: string;
  group: "top" | "more";
  order: number;
  enabled: boolean;
}

export const BLANK_NEW_NAV: NewNavInput = {
  label: "",
  href: "",
  group: "top",
  order: 0,
  enabled: true,
};

export interface NavSectionProps {
  navRows: NavRow[];
  navDrafts: Record<string, NavRow>;
  navSaving: Record<string, boolean>;
  conflict: boolean;
  creatingNav: boolean;
  loading: boolean;
  sourceVersion: ConfigSourceVersion | null;
  newNav: NewNavInput;
  setNewNav: (next: NewNavInput) => void;
  updateNavDraft: <K extends keyof NavRow>(rowId: string, key: K, value: NavRow[K]) => void;
  saveNavRow: (rowId: string) => void;
  createNavRow: () => void;
}

export function NavSection({
  navRows,
  navDrafts,
  navSaving,
  conflict,
  creatingNav,
  loading,
  sourceVersion,
  newNav,
  setNewNav,
  updateNavDraft,
  saveNavRow,
  createNavRow,
}: NavSectionProps) {
  return (
    <details className="surface-details" open>
      <summary>Navigation Rows</summary>
      <div className="flex flex-col gap-2 mt-1">
        {navRows.length === 0 ? (
          <p className="empty-note">No navigation rows.</p>
        ) : (
          <>
            <div className="grid-row grid-header">
              <span>Label</span>
              <span>Href</span>
              <span>Group</span>
              <span>Order</span>
              <span>Enabled</span>
              <span>Action</span>
            </div>
            {navRows.map((row) => {
              const draft = navDrafts[row.rowId] ?? row;
              const dirty = isNavDirty(row, draft);
              const saving = Boolean(navSaving[row.rowId]);
              return (
                <div className="grid-row" key={row.rowId}>
                  <input
                    value={draft.label}
                    placeholder="Label"
                    onChange={(e) => updateNavDraft(row.rowId, "label", e.target.value)}
                  />
                  <input
                    value={draft.href}
                    placeholder="/path"
                    onChange={(e) => updateNavDraft(row.rowId, "href", e.target.value)}
                  />
                  <select
                    value={draft.group}
                    onChange={(e) =>
                      updateNavDraft(
                        row.rowId,
                        "group",
                        e.target.value === "top" ? "top" : "more",
                      )
                    }
                  >
                    <option value="top">top</option>
                    <option value="more">more</option>
                  </select>
                  <input
                    type="number"
                    value={draft.order}
                    onChange={(e) =>
                      updateNavDraft(row.rowId, "order", toInteger(e.target.value, 0))
                    }
                  />
                  <select
                    value={draft.enabled ? "true" : "false"}
                    onChange={(e) =>
                      updateNavDraft(row.rowId, "enabled", e.target.value === "true")
                    }
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                  <div className="flex items-center gap-2">
                    <button
                      className="btn btn--secondary"
                      type="button"
                      disabled={conflict || saving}
                      onClick={() => saveNavRow(row.rowId)}
                    >
                      {saving ? "Saving…" : "Save"}
                    </button>
                    <span className={`row-note ${dirty ? "dirty" : "clean"}`}>
                      {dirty ? "unsaved" : "saved"}
                    </span>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      <h3 className="mt-4 mb-2 text-[13px] font-semibold text-text-primary">
        Create Navigation Row
      </h3>
      <div
        className="grid gap-2.5"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}
      >
        <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
          Label
          <input
            value={newNav.label}
            onChange={(e) => setNewNav({ ...newNav, label: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
          Href
          <input
            value={newNav.href}
            onChange={(e) => setNewNav({ ...newNav, href: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
          Group
          <select
            value={newNav.group}
            onChange={(e) =>
              setNewNav({
                ...newNav,
                group: e.target.value === "top" ? "top" : "more",
              })
            }
          >
            <option value="top">top</option>
            <option value="more">more</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
          Order
          <input
            type="number"
            value={newNav.order}
            onChange={(e) =>
              setNewNav({ ...newNav, order: toInteger(e.target.value, 0) })
            }
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
          Enabled
          <select
            value={newNav.enabled ? "true" : "false"}
            onChange={(e) => setNewNav({ ...newNav, enabled: e.target.value === "true" })}
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </label>
      </div>
      <div className="flex gap-2 pt-2">
        <button
          className="btn"
          type="button"
          disabled={loading || creatingNav || conflict || !sourceVersion}
          onClick={() => createNavRow()}
        >
          Create Nav Row
        </button>
      </div>
    </details>
  );
}
