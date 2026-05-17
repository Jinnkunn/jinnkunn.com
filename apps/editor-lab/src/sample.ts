import { createBlock, createDocument } from "../../../packages/editor-core/src/index.ts";

export const sampleDocument = createDocument({
  title: "Editor Lab",
  blocks: [
    createBlock({
      type: "paragraph",
      text: "A standalone block editor line. Type / to open commands, or try #, >, [], and --- shortcuts.",
    }),
    createBlock({
      type: "heading",
      level: 2,
      text: "The editor is not bound to the website",
    }),
    createBlock({
      type: "todo",
      text: "Make the document model boring and reliable first",
    }),
    createBlock({
      type: "quote",
      text: "The host app should save and publish; the editor should only edit.",
    }),
    createBlock({
      type: "divider",
    }),
    createBlock({
      type: "bulleted-list",
      text: "Web, Tauri, iOS WebView, and future open-source consumers can share this surface.",
    }),
  ],
});
