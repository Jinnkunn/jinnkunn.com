import type { EditorDocument, EditorTransaction } from "../../editor-core/src/index.ts";

export const EDITOR_BRIDGE_PROTOCOL_VERSION = 1;

export type EditorBridgeProtocolVersion = typeof EDITOR_BRIDGE_PROTOCOL_VERSION;

export type EditorCommandName =
  | "get-document"
  | "export-markdown"
  | "undo"
  | "redo"
  | "focus"
  | "get-dirty-state"
  | "mark-saved"
  | "request-save";

export type EditorBridgeError = {
  code: string;
  message: string;
};

export type EditorCommandResult =
  | { ok: true; result?: unknown }
  | { ok: false; error: EditorBridgeError };

export type EditorToHostMessage =
  | {
      type: "editor:ready";
      protocolVersion: EditorBridgeProtocolVersion;
      capabilities: EditorCommandName[];
    }
  | {
      type: "editor:change";
      protocolVersion: EditorBridgeProtocolVersion;
      document: EditorDocument;
      transaction?: EditorTransaction;
    }
  | {
      type: "editor:dirty-change";
      protocolVersion: EditorBridgeProtocolVersion;
      dirty: boolean;
    }
  | {
      type: "editor:save-request";
      protocolVersion: EditorBridgeProtocolVersion;
      requestId?: string;
      document: EditorDocument;
    }
  | {
      type: "editor:command-result";
      protocolVersion: EditorBridgeProtocolVersion;
      requestId: string;
      command: string;
    } & EditorCommandResult
  | {
      type: "editor:error";
      protocolVersion: EditorBridgeProtocolVersion;
      requestId?: string;
      error: EditorBridgeError;
    };

export type HostToEditorMessage =
  | {
      type: "host:load-document";
      protocolVersion: EditorBridgeProtocolVersion;
      requestId?: string;
      document: EditorDocument;
    }
  | {
      type: "host:set-read-only";
      protocolVersion: EditorBridgeProtocolVersion;
      requestId?: string;
      readOnly: boolean;
    }
  | {
      type: "host:mark-saved";
      protocolVersion: EditorBridgeProtocolVersion;
      requestId?: string;
      document?: EditorDocument;
    }
  | {
      type: "host:run-command";
      protocolVersion: EditorBridgeProtocolVersion;
      requestId: string;
      command: string;
      payload?: unknown;
    }
  | {
      type: "host:ping";
      protocolVersion: EditorBridgeProtocolVersion;
      requestId: string;
    };

export type EditorHostMessage = EditorToHostMessage;
export type EditorClientMessage = HostToEditorMessage;

export type EditorBridgeAdapter = {
  postMessage(message: EditorToHostMessage): void;
  subscribe(handler: (message: HostToEditorMessage) => void): () => void;
};

const HOST_MESSAGE_TYPES = new Set([
  "host:load-document",
  "host:mark-saved",
  "host:set-read-only",
  "host:run-command",
  "host:ping",
]);

export const EDITOR_BRIDGE_COMMANDS: EditorCommandName[] = [
  "get-document",
  "export-markdown",
  "undo",
  "redo",
  "focus",
  "get-dirty-state",
  "mark-saved",
  "request-save",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isRequestId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isEditorDocument(value: unknown): value is EditorDocument {
  if (!isRecord(value)) return false;
  if (value.version !== 1) return false;
  if (typeof value.title !== "string") return false;
  return Array.isArray(value.blocks);
}

export function createBridgeError(code: string, message: string): EditorBridgeError {
  return { code, message };
}

export function parseHostToEditorMessage(value: unknown): HostToEditorMessage | null {
  if (!isRecord(value)) return null;
  const type = typeof value.type === "string" ? value.type : "";
  if (!HOST_MESSAGE_TYPES.has(type)) return null;
  if (value.protocolVersion !== EDITOR_BRIDGE_PROTOCOL_VERSION) return null;

  if (type === "host:load-document") {
    if (!isEditorDocument(value.document)) return null;
    if (value.requestId !== undefined && !isRequestId(value.requestId)) return null;
    return {
      type,
      protocolVersion: EDITOR_BRIDGE_PROTOCOL_VERSION,
      requestId: value.requestId,
      document: value.document,
    };
  }

  if (type === "host:set-read-only") {
    if (typeof value.readOnly !== "boolean") return null;
    if (value.requestId !== undefined && !isRequestId(value.requestId)) return null;
    return {
      type,
      protocolVersion: EDITOR_BRIDGE_PROTOCOL_VERSION,
      requestId: value.requestId,
      readOnly: value.readOnly,
    };
  }

  if (type === "host:mark-saved") {
    if (value.requestId !== undefined && !isRequestId(value.requestId)) return null;
    if (value.document !== undefined && !isEditorDocument(value.document)) return null;
    return {
      type,
      protocolVersion: EDITOR_BRIDGE_PROTOCOL_VERSION,
      requestId: value.requestId,
      document: value.document,
    };
  }

  if (type === "host:run-command") {
    if (!isRequestId(value.requestId)) return null;
    if (typeof value.command !== "string" || !value.command.trim()) return null;
    return {
      type,
      protocolVersion: EDITOR_BRIDGE_PROTOCOL_VERSION,
      requestId: value.requestId,
      command: value.command,
      payload: value.payload,
    };
  }

  if (type === "host:ping") {
    if (!isRequestId(value.requestId)) return null;
    return {
      type,
      protocolVersion: EDITOR_BRIDGE_PROTOCOL_VERSION,
      requestId: value.requestId,
    };
  }

  return null;
}

export function createReadyMessage(): EditorToHostMessage {
  return {
    type: "editor:ready",
    protocolVersion: EDITOR_BRIDGE_PROTOCOL_VERSION,
    capabilities: EDITOR_BRIDGE_COMMANDS,
  };
}

export function createCommandResultMessage(
  requestId: string,
  command: string,
  result: EditorCommandResult,
): EditorToHostMessage {
  return {
    ...result,
    type: "editor:command-result",
    protocolVersion: EDITOR_BRIDGE_PROTOCOL_VERSION,
    requestId,
    command,
  };
}

export function createWindowEditorBridge(target: Window = window): EditorBridgeAdapter {
  return {
    postMessage(message) {
      target.parent?.postMessage(message, "*");
    },
    subscribe(handler) {
      const listener = (event: MessageEvent) => {
        const message = parseHostToEditorMessage(event.data);
        if (!message) return;
        handler(message);
      };
      target.addEventListener("message", listener);
      return () => target.removeEventListener("message", listener);
    },
  };
}

export function createMemoryEditorBridge() {
  const hostMessages: EditorToHostMessage[] = [];
  const clientHandlers = new Set<(message: HostToEditorMessage) => void>();
  return {
    adapter: {
      postMessage(message: EditorToHostMessage) {
        hostMessages.push(message);
      },
      subscribe(handler: (message: HostToEditorMessage) => void) {
        clientHandlers.add(handler);
        return () => clientHandlers.delete(handler);
      },
    } satisfies EditorBridgeAdapter,
    hostMessages,
    sendToEditor(message: unknown) {
      const parsed = parseHostToEditorMessage(message);
      if (!parsed) return false;
      clientHandlers.forEach((handler) => handler(parsed));
      return true;
    },
  };
}
