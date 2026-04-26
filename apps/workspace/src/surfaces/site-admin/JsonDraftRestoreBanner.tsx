import { formatDraftAge } from "./use-editor-draft";

interface Props {
  savedAt: number;
  onRestore: () => void;
  onDismiss: () => void;
}

export function JsonDraftRestoreBanner({ savedAt, onRestore, onDismiss }: Props) {
  return (
    <div className="draft-restore">
      <div>
        <strong>Local draft available</strong>
        <p>
          Autosaved {formatDraftAge(savedAt)}. Restore it if the previous
          session closed before saving.
        </p>
      </div>
      <div className="draft-restore__actions">
        <button className="btn btn--secondary draft-restore__btn" type="button" onClick={onDismiss}>
          Dismiss
        </button>
        <button className="btn btn--primary draft-restore__btn" type="button" onClick={onRestore}>
          Restore
        </button>
      </div>
    </div>
  );
}
