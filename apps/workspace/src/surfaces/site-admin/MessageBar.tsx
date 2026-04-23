import { useSiteAdmin } from "./state";

export function MessageBar() {
  const { message, clearMessage } = useSiteAdmin();
  if (!message.text) return null;
  const kind = message.kind || "info";
  return (
    <div className={`message-bar kind-${kind}`} role="status" aria-live="polite">
      <p>{message.text}</p>
      <button
        type="button"
        className="message-bar__close"
        aria-label="Dismiss"
        onClick={clearMessage}
      >
        ×
      </button>
    </div>
  );
}
