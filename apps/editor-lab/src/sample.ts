import type { EditorDocument } from "../../../packages/editor-core/src/index.ts";

export const sampleDocument: EditorDocument = {
  version: 1,
  title: "Editor Lab",
  blocks: [
    {
      id: "sample-intro",
      type: "paragraph",
      text: [{ text: "A standalone block editor line. Type / to open commands, or try #, >, [], and --- shortcuts." }],
    },
    {
      id: "sample-heading",
      type: "heading",
      level: 2,
      text: [{ text: "The editor is not bound to the website" }],
    },
    {
      id: "sample-todo",
      type: "todo",
      checked: false,
      text: [{ text: "Make the document model boring and reliable first" }],
    },
    {
      id: "sample-quote",
      type: "quote",
      text: [{ text: "The host app should save and publish; the editor should only edit." }],
    },
    {
      id: "sample-callout",
      type: "callout",
      text: [
        { text: "The Rust/WASM core now owns block behavior; " },
        { text: "React only renders the surface.", marks: ["highlight"] },
      ],
    },
    {
      id: "sample-code",
      type: "code-block",
      text: [{ text: "const editor = await initializeEditorCore();" }],
    },
    {
      id: "sample-divider",
      type: "divider",
      text: [],
    },
    {
      id: "sample-list",
      type: "bulleted-list",
      text: [
        { text: "Web, Tauri, iOS WebView, and future native hosts can share " },
        { text: "one boring core", marks: ["strikethrough"] },
        { text: " one reliable core." },
      ],
    },
  ],
};
