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
  const latestDocumentRef = useRef(loadedDocument);
  const dirtyRef = useRef(false);

  function postDirtyChange(dirty: boolean, force = false) {
    if (!force && dirtyRef.current === dirty) return;
    dirtyRef.current = dirty;
    bridge.postMessage({
      type: "editor:dirty-change",
      protocolVersion: EDITOR_BRIDGE_PROTOCOL_VERSION,
      dirty,
    });
  }

  function markSaved(document: EditorDocument) {
    latestDocumentRef.current = document;
    postDirtyChange(false);
  }

  useEffect(() => {
    const nextDocument = initialDocument ?? createDocument();
    latestDocumentRef.current = nextDocument;
    setLoadedDocument(nextDocument);
    postDirtyChange(false);
  }, [initialDocument]);

  useEffect(() => {
    setBridgeReadOnly(readOnly);
  }, [readOnly]);

  useEffect(() => {
    bridge.postMessage(createReadyMessage());
    postDirtyChange(dirtyRef.current, true);

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
      if (message.command === "get-dirty-state") {
        postSuccess(message.requestId, message.command, { dirty: dirtyRef.current });
        return;
      }
      if (message.command === "mark-saved") {
        markSaved(editor.getDocument());
        postSuccess(message.requestId, message.command, { dirty: false });
        return;
      }
      if (message.command === "request-save") {
        const document = editor.getDocument();
        bridge.postMessage({
          type: "editor:save-request",
          protocolVersion: EDITOR_BRIDGE_PROTOCOL_VERSION,
          requestId: message.requestId,
          document,
        });
        postSuccess(message.requestId, message.command, { dirty: dirtyRef.current, requested: true });
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
          latestDocumentRef.current = message.document;
          setLoadedDocument(message.document);
          postDirtyChange(false);
          postSuccess(message.requestId, "load-document", message.document);
          return;
        }
        if (message.type === "host:mark-saved") {
          markSaved(message.document ?? editorRef.current?.getDocument() ?? latestDocumentRef.current);
          postSuccess(message.requestId, "mark-saved", { dirty: false });
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
    latestDocumentRef.current = nextDocument;
    postDirtyChange(true);
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
