import type { EditorDiagnostic } from "./editor-diagnostics";

export interface PublishPreflightPanelProps {
  blockingDiagnostics: EditorDiagnostic[];
  message: string;
}

export function PublishPreflightPanel({
  blockingDiagnostics,
  message,
}: PublishPreflightPanelProps) {
  return (
    <details className="publish-preview publish-preview--preflight" role="status" open>
      <summary>{message}</summary>
      <div className="publish-preview__body">
        <ul className="publish-preview__preflight-list">
          {blockingDiagnostics.slice(0, 6).map((diagnostic) => (
            <li key={diagnostic.id}>
              <strong>{diagnostic.title}</strong>
              <span>{diagnostic.detail}</span>
              <small>{diagnostic.suggestion}</small>
            </li>
          ))}
          {blockingDiagnostics.length > 6 ? (
            <li>
              <strong>{blockingDiagnostics.length - 6} more blockers</strong>
              <span>Review the editor checks panel in the current document.</span>
            </li>
          ) : null}
        </ul>
      </div>
    </details>
  );
}
