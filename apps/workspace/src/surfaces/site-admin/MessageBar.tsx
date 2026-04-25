import { useEffect } from "react";
import { useSiteAdmin } from "./state";

export function MessageBar() {
  const { message, clearMessage } = useSiteAdmin();
  const kind = message.kind || "info";

  useEffect(() => {
    if (!message.text || kind !== "success") return;
    const timer = window.setTimeout(clearMessage, 4500);
    return () => window.clearTimeout(timer);
  }, [clearMessage, kind, message.text]);

  if (!message.text) return null;
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
