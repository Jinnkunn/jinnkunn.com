import {
  editorDiagnosticsSummary,
  type EditorDiagnostic,
} from "./editor-diagnostics";

export interface EditorDiagnosticsPanelProps {
  diagnostics: EditorDiagnostic[];
  onSelectBlock?: (blockId: string) => void;
}

export function EditorDiagnosticsPanel({
  diagnostics,
  onSelectBlock,
}: EditorDiagnosticsPanelProps) {
  if (diagnostics.length === 0) return null;
  const summary = editorDiagnosticsSummary(diagnostics);
  const open = summary.blocking > 0 || summary.warning > 0;
  const summaryLabel = summary.blocking > 0
    ? `${summary.blocking} blocker${summary.blocking === 1 ? "" : "s"}`
    : summary.warning > 0
      ? `${summary.warning} warning${summary.warning === 1 ? "" : "s"}`
      : `${summary.info} note${summary.info === 1 ? "" : "s"}`;

  return (
    <details className="mdx-document-diagnostics" open={open}>
      <summary>
        Editor checks
        <span>{summaryLabel}</span>
      </summary>
      <ul>
        {diagnostics.slice(0, 8).map((item) => (
          <li key={item.id} data-severity={item.severity}>
            {onSelectBlock ? (
              <button
                type="button"
                onClick={() => onSelectBlock(item.blockId)}
                title={item.suggestion}
              >
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
                <small>{item.suggestion}</small>
              </button>
            ) : (
              <>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
                <small>{item.suggestion}</small>
              </>
            )}
          </li>
        ))}
        {diagnostics.length > 8 ? (
          <li data-severity="info">
            <strong>{diagnostics.length - 8} more checks</strong>
            <span>Open the affected blocks to review the remaining notes.</span>
          </li>
        ) : null}
      </ul>
    </details>
  );
}
