import type { EditorDocument, EditorTransaction } from "../../editor-core/src/index.ts";

export type EditorHostMessage =
  | { type: "editor:ready" }
  | { type: "editor:change"; document: EditorDocument; transaction?: EditorTransaction }
  | { type: "editor:command"; command: string; payload?: unknown };

export type EditorClientMessage =
  | { type: "host:load-document"; document: EditorDocument }
  | { type: "host:set-read-only"; readOnly: boolean }
  | { type: "host:run-command"; command: string; payload?: unknown };

export type EditorBridgeAdapter = {
  postMessage(message: EditorHostMessage): void;
  subscribe(handler: (message: EditorClientMessage) => void): () => void;
};

export function createWindowEditorBridge(target: Window = window): EditorBridgeAdapter {
  return {
    postMessage(message) {
      target.parent?.postMessage(message, "*");
    },
    subscribe(handler) {
      const listener = (event: MessageEvent) => {
        const data = event.data as EditorClientMessage;
        if (!data || typeof data !== "object") return;
        if (!String(data.type || "").startsWith("host:")) return;
        handler(data);
      };
      target.addEventListener("message", listener);
      return () => target.removeEventListener("message", listener);
    },
  };
}

export function createMemoryEditorBridge() {
  const hostMessages: EditorHostMessage[] = [];
  const clientHandlers = new Set<(message: EditorClientMessage) => void>();
  return {
    adapter: {
      postMessage(message: EditorHostMessage) {
        hostMessages.push(message);
      },
      subscribe(handler: (message: EditorClientMessage) => void) {
        clientHandlers.add(handler);
        return () => clientHandlers.delete(handler);
      },
    } satisfies EditorBridgeAdapter,
    hostMessages,
    sendToEditor(message: EditorClientMessage) {
      clientHandlers.forEach((handler) => handler(message));
    },
  };
}
