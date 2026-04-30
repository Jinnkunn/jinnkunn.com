import { createContext, useContext, type ReactNode } from "react";

import type { EditorDiagnostic } from "../surfaces/site-admin/editor-diagnostics";
import type {
  AssetUploadResponse,
  NormalizedApiResponse,
} from "../surfaces/site-admin/types";

export type WorkspaceEditorMessageKind = "error" | "success" | "info" | "warn";

export type WorkspaceEditorRequest = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<NormalizedApiResponse>;

export interface WorkspaceAssetUploadInput {
  /** Base64-encoded body (no `data:` prefix). */
  base64: string;
  contentType: string;
  filename: string;
}

export type WorkspaceAssetUploadResult =
  | { ok: true; asset: AssetUploadResponse }
  | { ok: false; code: string; error: string };

export type WorkspaceAssetUploader = (
  input: WorkspaceAssetUploadInput,
) => Promise<WorkspaceAssetUploadResult>;

export interface WorkspaceEditorRuntime {
  assetsEnabled?: boolean;
  /** When false, BlocksEditor skips the AssetLibraryPicker render. Used
   * by surfaces (Notes) that have no remote-asset library — they accept
   * paste/drop uploads but should not pull in `useSiteAdmin`. */
  assetLibraryEnabled?: boolean;
  /** Generic HTTP-shaped escape hatch — site-admin-only paths (page links,
   * bookmarks, link audits, etc.) still go through this. New consumers
   * should prefer `uploadAsset` for image / file pastes since it keeps
   * surfaces decoupled from a specific `/api/...` path string. */
  request: WorkspaceEditorRequest;
  /** Optional typed upload entry point. When provided, BlocksEditor
   * routes paste/drop image uploads through this instead of constructing
   * a `request("/api/site-admin/assets", "POST", …)` call. Notes points
   * this at its local `notes_save_asset` Tauri command; site-admin
   * forwards to the cloud asset endpoint. Surfaces that don't host
   * uploads can omit it (uploads are then disabled at the canvas level). */
  uploadAsset?: WorkspaceAssetUploader;
  /** Whitelist of slash-command ids the surface wants to expose. When
   * undefined (the default), every command is enabled — site-admin's
   * MdxDocumentEditor needs the full vocabulary because it owns blocks
   * like `publications-block`, `teaching-links`, `featured-pages-block`
   * that are part of the public site. Notes overrides this with a
   * curated list (text, headings, list, todo, image, code, …) so users
   * don't see slash entries for blocks that don't make sense outside
   * the website context. */
  enabledBlockIds?: ReadonlySet<string>;
  setEditorDiagnostics: (diagnostics: EditorDiagnostic[]) => void;
  setMessage: (kind: WorkspaceEditorMessageKind, text: string) => void;
}

const unavailableRequest: WorkspaceEditorRequest = async () => ({
  ok: false,
  status: 0,
  code: "EDITOR_RUNTIME_UNAVAILABLE",
  error: "This editor does not have a remote asset runtime.",
  raw: null,
});

const fallbackRuntime: WorkspaceEditorRuntime = {
  assetsEnabled: false,
  request: unavailableRequest,
  setEditorDiagnostics: () => {},
  setMessage: () => {},
};

const WorkspaceEditorRuntimeContext =
  createContext<WorkspaceEditorRuntime>(fallbackRuntime);

export function WorkspaceEditorRuntimeProvider({
  children,
  runtime,
}: {
  children: ReactNode;
  runtime: WorkspaceEditorRuntime;
}) {
  return (
    <WorkspaceEditorRuntimeContext.Provider value={runtime}>
      {children}
    </WorkspaceEditorRuntimeContext.Provider>
  );
}

export function useWorkspaceEditorRuntime(): WorkspaceEditorRuntime {
  return useContext(WorkspaceEditorRuntimeContext);
}
