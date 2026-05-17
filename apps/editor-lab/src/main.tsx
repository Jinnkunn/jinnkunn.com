import React from "react";
import { createRoot } from "react-dom/client";
import { initializeEditorCore } from "../../../packages/editor-core/src/index.ts";
import { BlockEditor } from "../../../packages/editor-web/src/index.ts";
import "../../../packages/editor-web/src/styles.css";
import { sampleDocument } from "./sample.ts";
import "./styles.css";

function App() {
  return (
    <main className="lab-editor-shell">
      <BlockEditor initialDocument={sampleDocument} />
    </main>
  );
}

await initializeEditorCore();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
