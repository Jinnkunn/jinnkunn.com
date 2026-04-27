import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";

import { InlineColor } from "./inline-color-mark";
import { InlineLinkStyle } from "./inline-link-style-mark";

export interface RichTextExtensionOptions {
  placeholder?: string;
}

export function createRichTextExtensions(options: RichTextExtensionOptions = {}) {
  return [
    StarterKit.configure({
      heading: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      blockquote: false,
      codeBlock: false,
      horizontalRule: false,
    }),
    Link.configure({
      openOnClick: false,
      autolink: false,
      HTMLAttributes: { rel: "noreferrer noopener" },
    }),
    Underline,
    InlineColor,
    InlineLinkStyle,
    Placeholder.configure({
      placeholder: ({ editor }) => (editor.isEmpty ? options.placeholder ?? "" : ""),
      showOnlyWhenEditable: true,
      showOnlyCurrent: false,
    }),
  ];
}
