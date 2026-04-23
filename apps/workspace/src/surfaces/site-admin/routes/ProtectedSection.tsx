import type { ProtectedRow, RoutesSourceVersion } from "../types";
import { isProtectedDirty, normalizeString } from "../utils";

export interface NewProtectedInput {
  pageId: string;
  path: string;
  auth: "password" | "github" | "public";
  password: string;
}

export const BLANK_NEW_PROTECTED: NewProtectedInput = {
  pageId: "",
  path: "",
  auth: "password",
  password: "",
};

export function validateProtected(draft: {
  pageId: string;
  path: string;
  auth: string;
  password: string;
}): string {
  if (!normalizeString(draft.pageId)) return "Protected route requires pageId.";
  if (!normalizeString(draft.path)) return "Protected route requires path.";
  const auth = normalizeString(draft.auth);
  if (!["password", "github", "public"].includes(auth)) {
    return "Protected route auth is invalid.";
  }
  if (auth === "password" && !normalizeString(draft.password)) {
    return "Password auth requires a password. Empty password disables protection.";
  }
  return "";
}

export interface ProtectedSectionProps {
  protectedRows: ProtectedRow[];
  protectedDrafts: Record<string, ProtectedRow>;
  protectedSaving: Record<string, boolean>;
  conflict: boolean;
  loading: boolean;
  sourceVersion: RoutesSourceVersion | null;
  creatingProtected: boolean;
  newProtected: NewProtectedInput;
  setNewProtected: (next: NewProtectedInput) => void;
  updateProtectedDraft: <K extends keyof ProtectedRow>(
    rowId: string,
    key: K,
    value: ProtectedRow[K],
  ) => void;
  saveProtected: (rowId: string) => void;
  createProtected: () => void;
}

export function ProtectedSection({
  protectedRows,
  protectedDrafts,
  protectedSaving,
  conflict,
  loading,
  sourceVersion,
  creatingProtected,
  newProtected,
  setNewProtected,
  updateProtectedDraft,
  saveProtected,
  createProtected,
}: ProtectedSectionProps) {
  return (
    <details className="surface-details" open>
      <summary>Protected Routes</summary>
      <div className="flex flex-col gap-2 mt-1">
        {protectedRows.length === 0 ? (
          <p className="empty-note">No protected routes.</p>
        ) : (
          <>
            <div className="grid-row grid-header routes-protected">
              <span>Page ID</span>
              <span>Path</span>
              <span>Auth</span>
              <span>Password</span>
              <span>Action</span>
            </div>
            {protectedRows.map((row) => {
              const draft = protectedDrafts[row.rowId] ?? row;
              const dirty = isProtectedDirty(row, draft);
              const saving = Boolean(protectedSaving[row.rowId]);
              const passwordDisabled = draft.auth !== "password";
              return (
                <div className="grid-row routes-protected" key={row.rowId}>
                  <span>{row.pageId}</span>
                  <input
                    value={draft.path}
                    placeholder="/path"
                    onChange={(e) => updateProtectedDraft(row.rowId, "path", e.target.value)}
                  />
                  <select
                    value={draft.auth}
                    onChange={(e) =>
                      updateProtectedDraft(
                        row.rowId,
                        "auth",
                        (e.target.value as ProtectedRow["auth"]) ?? "password",
                      )
                    }
                  >
                    <option value="password">password</option>
                    <option value="github">github</option>
                    <option value="public">public (disable protection)</option>
                  </select>
                  <input
                    type="password"
                    value={draft.password}
                    placeholder={
                      passwordDisabled ? "unused" : "required for password auth"
                    }
                    disabled={passwordDisabled}
                    onChange={(e) =>
                      updateProtectedDraft(row.rowId, "password", e.target.value)
                    }
                  />
                  <div className="flex items-center gap-2">
                    <button
                      className="btn btn--secondary"
                      type="button"
                      disabled={conflict || saving}
                      onClick={() => saveProtected(row.rowId)}
                    >
                      {saving ? "Saving…" : "Save"}
                    </button>
                    <span className={`row-note ${dirty ? "dirty" : "clean"}`}>
                      {dirty ? "unsaved" : "saved"} | mode={row.mode}
                    </span>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      <h3 className="mt-4 mb-2 text-[13px] font-semibold text-text-primary">
        Create Protected Route
      </h3>
      <div
        className="grid gap-2.5"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}
      >
        <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
          Page ID
          <input
            value={newProtected.pageId}
            onChange={(e) =>
              setNewProtected({ ...newProtected, pageId: e.target.value })
            }
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
          Path
          <input
            value={newProtected.path}
            placeholder="/private"
            onChange={(e) =>
              setNewProtected({ ...newProtected, path: e.target.value })
            }
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
          Auth
          <select
            value={newProtected.auth}
            onChange={(e) =>
              setNewProtected({
                ...newProtected,
                auth: (e.target.value as NewProtectedInput["auth"]) ?? "password",
                password:
                  (e.target.value as string) === "password" ? newProtected.password : "",
              })
            }
          >
            <option value="password">password</option>
            <option value="github">github</option>
            <option value="public">public (disable protection)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-text-secondary">
          Password (password auth only)
          <input
            type="password"
            value={newProtected.password}
            disabled={newProtected.auth !== "password"}
            onChange={(e) =>
              setNewProtected({ ...newProtected, password: e.target.value })
            }
          />
        </label>
      </div>
      <div className="flex gap-2 pt-2">
        <button
          className="btn"
          type="button"
          disabled={loading || creatingProtected || conflict || !sourceVersion}
          onClick={() => createProtected()}
        >
          Create Protected Route
        </button>
      </div>
    </details>
  );
}
