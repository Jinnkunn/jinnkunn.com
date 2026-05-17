import type { EditorDocument } from "../../../packages/editor-core/src/index.ts";

export const sampleDocument: EditorDocument = {
  version: 1,
  title: "Editor Lab",
  blocks: [
    {
      id: "sample-intro",
      type: "paragraph",
      text: [
        { text: "A standalone block editor line. " },
        { text: "Links", marks: [{ type: "link", attrs: { href: "https://jinkunchen.com" } }] },
        { text: " and " },
        {
          text: "icon links",
          marks: [
            { type: "link", attrs: { href: "/blog" } },
            { type: "icon-link" },
            { type: "background-color", attrs: { color: "yellow" } },
          ],
        },
        { text: " are part of the same mark system." },
      ],
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
        { text: "React only renders the surface.", marks: [{ type: "highlight" }] },
      ],
    },
    {
      id: "sample-image",
      type: "image",
      attrs: {
        alt: "Editor canvas",
        url: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80",
      },
      text: [{ text: "Structured blocks use attrs instead of one-off fields." }],
    },
    {
      id: "sample-bookmark",
      type: "bookmark",
      attrs: { url: "https://jinkunchen.com" },
      text: [{ text: "Jinkun Chen" }],
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
        { text: "one boring core", marks: [{ type: "strikethrough" }] },
        { text: " one reliable core." },
      ],
    },
  ],
};
