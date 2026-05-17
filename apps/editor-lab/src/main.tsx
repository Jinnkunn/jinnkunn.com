import React from "react";
import { createRoot } from "react-dom/client";
import { createWindowEditorBridge } from "../../../packages/editor-bridge/src/index.ts";
import { initializeEditorCore } from "../../../packages/editor-core/src/index.ts";
import { BridgeBlockEditor } from "../../../packages/editor-web/src/index.ts";
import "../../../packages/editor-web/src/styles.css";
import { sampleDocument } from "./sample.ts";
import "./styles.css";

function App() {
  const bridge = React.useMemo(() => createWindowEditorBridge(), []);

  return (
    <main className="lab-editor-shell">
      <BridgeBlockEditor bridge={bridge} initialDocument={sampleDocument} />
    </main>
  );
}

await initializeEditorCore();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
