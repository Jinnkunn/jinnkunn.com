import type { OverrideRow, RoutesSourceVersion } from "../types";
import { isOverrideDirty } from "../utils";

export interface NewOverrideInput {
  pageId: string;
  routePath: string;
}

export const BLANK_NEW_OVERRIDE: NewOverrideInput = { pageId: "", routePath: "" };

export interface OverridesSectionProps {
  overrides: OverrideRow[];
  overrideDrafts: Record<string, OverrideRow>;
  overrideSaving: Record<string, boolean>;
  conflict: boolean;
  loading: boolean;
  sourceVersion: RoutesSourceVersion | null;
  creatingOverride: boolean;
  newOverride: NewOverrideInput;
  setNewOverride: (next: NewOverrideInput) => void;
  updateOverrideDraft: (pageId: string, value: string) => void;
  saveOverride: (pageId: string) => void;
  createOverride: () => void;
}

export function OverridesSection({
  overrides,
  overrideDrafts,
  overrideSaving,
  conflict,
  loading,
  sourceVersion,
  creatingOverride,
  newOverride,
  setNewOverride,
  updateOverrideDraft,
  saveOverride,
  createOverride,
}: OverridesSectionProps) {
  return (
    <details className="surface-details" open>
      <summary>Route Overrides</summary>
      <div className="flex flex-col gap-2 mt-1">
        {overrides.length === 0 ? (
          <p className="empty-note">No route overrides.</p>
        ) : (
          <>
            <div className="grid-row grid-header routes-override">
              <span>Page ID</span>
              <span>Route Path</span>
              <span>Action</span>
            </div>
            {overrides.map((row) => {
              const draft = overrideDrafts[row.pageId] ?? row;
              const dirty = isOverrideDirty(row, draft);
              const saving = Boolean(overrideSaving[row.pageId]);
              return (
                <div className="grid-row routes-override" key={row.pageId}>
                  <span>{row.pageId}</span>
                  <input
                    value={draft.routePath}
                    placeholder="/custom-path (empty disables)"
                    onChange={(e) => updateOverrideDraft(row.pageId, e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      className="btn btn--secondary"
                      type="button"
                      disabled={conflict || saving}
                      onClick={() => saveOverride(row.pageId)}
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
        Create Override
      </h3>
      <div
        className="grid gap-2.5"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}
      >
        <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
          Page ID
          <input
            value={newOverride.pageId}
            onChange={(e) =>
              setNewOverride({ ...newOverride, pageId: e.target.value })
            }
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
          Route Path
          <input
            value={newOverride.routePath}
            placeholder="/new-path"
            onChange={(e) =>
              setNewOverride({ ...newOverride, routePath: e.target.value })
            }
          />
        </label>
      </div>
      <div className="flex gap-2 pt-2">
        <button
          className="btn"
          type="button"
          disabled={loading || creatingOverride || conflict || !sourceVersion}
          onClick={() => createOverride()}
        >
          Create Override
        </button>
      </div>
    </details>
  );
}
