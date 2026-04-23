import { useSiteAdmin } from "./state";

export function MessageBar() {
  const { message } = useSiteAdmin();
  if (!message.text) return null;
  const kind = message.kind || "info";
  return (
    <div className={`message-bar kind-${kind}`} role="status" aria-live="polite">
      <p>{message.text}</p>
    </div>
  );
}
