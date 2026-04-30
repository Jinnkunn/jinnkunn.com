import { createContext, useContext, type ReactNode } from "react";

import type { EditorDiagnostic } from "../surfaces/site-admin/editor-diagnostics";
import type { NormalizedApiResponse } from "../surfaces/site-admin/types";

export type WorkspaceEditorMessageKind = "error" | "success" | "info" | "warn";

export type WorkspaceEditorRequest = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<NormalizedApiResponse>;

export interface WorkspaceEditorRuntime {
  assetsEnabled?: boolean;
  request: WorkspaceEditorRequest;
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
