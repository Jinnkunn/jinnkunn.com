import { Mark, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    inlineLinkStyle: {
      /** Apply the icon-prefixed inline link style to the current selection. */
      setInlineLinkStyle: (attrs: { style: "icon" }) => ReturnType;
      /** Remove the icon-prefixed inline link style from the current selection. */
      unsetInlineLinkStyle: () => ReturnType;
    };
  }
}

export interface InlineLinkStyleAttrs {
  style: "icon" | null;
}

export const InlineLinkStyle = Mark.create({
  name: "inlineLinkStyle",

  addAttributes() {
    return {
      style: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute("data-link-style");
          return value === "icon" ? value : null;
        },
        renderHTML: (attrs) => {
          const value = attrs.style;
          if (value !== "icon") return {};
          return { "data-link-style": value };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-link-style="icon"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setInlineLinkStyle:
        ({ style }) =>
        ({ chain, commands }) => {
          if (style !== "icon") return commands.unsetMark(this.name);
          return chain().setMark(this.name, { style }).run();
        },
      unsetInlineLinkStyle:
        () =>
        ({ commands }) => commands.unsetMark(this.name),
    };
  },
});
