import { useEffect, useRef, useState } from "react";
import {
  createBridgeError,
  createCommandResultMessage,
  createReadyMessage,
  EDITOR_BRIDGE_PROTOCOL_VERSION,
  type EditorBridgeAdapter,
  type HostToEditorMessage,
} from "../../editor-bridge/src/index.ts";
import { createDocument, type EditorDocument, type EditorExtensionManifest, type EditorTransaction } from "../../editor-core/src/index.ts";
import { BlockEditor, type BlockEditorHandle } from "./BlockEditor.tsx";

export type BridgeBlockEditorProps = {
  bridge: EditorBridgeAdapter;
  extensionManifests?: EditorExtensionManifest[];
  initialDocument?: EditorDocument;
  readOnly?: boolean;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function BridgeBlockEditor({
  bridge,
  extensionManifests,
  initialDocument,
  readOnly = false,
}: BridgeBlockEditorProps) {
  const editorRef = useRef<BlockEditorHandle>(null);
  const [loadedDocument, setLoadedDocument] = useState<EditorDocument>(() => initialDocument ?? createDocument());
  const [bridgeReadOnly, setBridgeReadOnly] = useState(readOnly);

  useEffect(() => {
    setLoadedDocument(initialDocument ?? createDocument());
  }, [initialDocument]);

  useEffect(() => {
    setBridgeReadOnly(readOnly);
  }, [readOnly]);

  useEffect(() => {
    bridge.postMessage(createReadyMessage());

    function postSuccess(requestId: string | undefined, command: string, result?: unknown) {
      if (!requestId) return;
      bridge.postMessage(createCommandResultMessage(requestId, command, { ok: true, result }));
    }

    function postFailure(requestId: string | undefined, command: string, code: string, message: string) {
      const error = createBridgeError(code, message);
      if (requestId) {
        bridge.postMessage(createCommandResultMessage(requestId, command, { ok: false, error }));
      } else {
        bridge.postMessage({
          type: "editor:error",
          protocolVersion: EDITOR_BRIDGE_PROTOCOL_VERSION,
          error,
        });
      }
    }

    function runCommand(message: Extract<HostToEditorMessage, { type: "host:run-command" }>) {
      const editor = editorRef.current;
      if (!editor) {
        postFailure(message.requestId, message.command, "EDITOR_NOT_READY", "Editor is not ready.");
        return;
      }

      if (message.command === "get-document") {
        postSuccess(message.requestId, message.command, editor.getDocument());
        return;
      }
      if (message.command === "export-markdown") {
        postSuccess(message.requestId, message.command, editor.exportMarkdown());
        return;
      }
      if (message.command === "undo") {
        postSuccess(message.requestId, message.command, editor.undo());
        return;
      }
      if (message.command === "redo") {
        postSuccess(message.requestId, message.command, editor.redo());
        return;
      }
      if (message.command === "focus") {
        editor.focus();
        postSuccess(message.requestId, message.command, null);
        return;
      }
      postFailure(message.requestId, message.command, "UNKNOWN_COMMAND", `Unknown editor command: ${message.command}`);
    }

    return bridge.subscribe((message) => {
      try {
        if (message.type === "host:ping") {
          postSuccess(message.requestId, "ping", { pong: true });
          return;
        }
        if (message.type === "host:load-document") {
          setLoadedDocument(message.document);
          postSuccess(message.requestId, "load-document", message.document);
          return;
        }
        if (message.type === "host:set-read-only") {
          setBridgeReadOnly(message.readOnly);
          postSuccess(message.requestId, "set-read-only", { readOnly: message.readOnly });
          return;
        }
        if (message.type === "host:run-command") {
          runCommand(message);
        }
      } catch (error) {
        const requestId = "requestId" in message ? message.requestId : undefined;
        postFailure(requestId, message.type, "COMMAND_FAILED", errorMessage(error));
      }
    });
  }, [bridge]);

  function handleChange(nextDocument: EditorDocument, transaction?: EditorTransaction) {
    bridge.postMessage({
      type: "editor:change",
      protocolVersion: EDITOR_BRIDGE_PROTOCOL_VERSION,
      document: nextDocument,
      transaction,
    });
  }

  return (
    <BlockEditor
      ref={editorRef}
      extensionManifests={extensionManifests}
      initialDocument={loadedDocument}
      readOnly={bridgeReadOnly}
      onChange={handleChange}
    />
  );
}
