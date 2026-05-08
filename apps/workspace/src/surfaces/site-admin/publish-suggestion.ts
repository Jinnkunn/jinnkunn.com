const CONTENT_PUBLISH_SUGGESTION_KEY = "site-admin:content-publish-needed";
const CONTENT_PUBLISH_SUGGESTION_EVENT = "site-admin:content-publish-needed";
const CONTENT_PUBLISH_SUGGESTION_CLEARED_EVENT =
  "site-admin:content-publish-cleared";

export interface ContentPublishSuggestion {
  atMs: number;
  method: string;
  path: string;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

export function readContentPublishSuggestion(): ContentPublishSuggestion | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(CONTENT_PUBLISH_SUGGESTION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ContentPublishSuggestion>;
    const atMs = typeof parsed.atMs === "number" ? parsed.atMs : 0;
    if (!atMs) return null;
    return {
      atMs,
      method: typeof parsed.method === "string" ? parsed.method : "POST",
      path: typeof parsed.path === "string" ? parsed.path : "",
    };
  } catch {
    return null;
  }
}

export function markContentPublishSuggested(input: {
  method: string;
  path: string;
}): void {
  if (!canUseStorage()) return;
  const payload: ContentPublishSuggestion = {
    atMs: Date.now(),
    method: input.method,
    path: input.path,
  };
  try {
    window.localStorage.setItem(
      CONTENT_PUBLISH_SUGGESTION_KEY,
      JSON.stringify(payload),
    );
  } catch {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<ContentPublishSuggestion>(CONTENT_PUBLISH_SUGGESTION_EVENT, {
      detail: payload,
    }),
  );
}

export function clearContentPublishSuggestion(): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(CONTENT_PUBLISH_SUGGESTION_KEY);
  } catch {
    return;
  }
  window.dispatchEvent(new CustomEvent(CONTENT_PUBLISH_SUGGESTION_CLEARED_EVENT));
}

export function listenForContentPublishSuggestion(
  callback: (suggestion: ContentPublishSuggestion | null) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onNeeded = (event: Event) => {
    callback(
      event instanceof CustomEvent
        ? (event.detail as ContentPublishSuggestion)
        : readContentPublishSuggestion(),
    );
  };
  const onCleared = () => callback(null);
  window.addEventListener(CONTENT_PUBLISH_SUGGESTION_EVENT, onNeeded);
  window.addEventListener(CONTENT_PUBLISH_SUGGESTION_CLEARED_EVENT, onCleared);
  return () => {
    window.removeEventListener(CONTENT_PUBLISH_SUGGESTION_EVENT, onNeeded);
    window.removeEventListener(CONTENT_PUBLISH_SUGGESTION_CLEARED_EVENT, onCleared);
  };
}
