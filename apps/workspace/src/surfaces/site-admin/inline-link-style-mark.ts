import { Mark, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    inlineLinkStyle: {
      /** Apply the icon-prefixed inline link style to the current selection. */
      setInlineLinkStyle: (attrs: { style: "icon"; icon?: string | null }) => ReturnType;
      /** Remove the icon-prefixed inline link style from the current selection. */
      unsetInlineLinkStyle: () => ReturnType;
    };
  }
}

export interface InlineLinkStyleAttrs {
  style: "icon" | null;
  icon: string | null;
}

function cssUrlValue(value: string): string {
  return `url(${JSON.stringify(value)})`;
}

function isSafeIconUrl(value: string): boolean {
  return value.startsWith("/") || /^https:\/\/[^\s"')]+$/i.test(value);
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
      icon: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-link-icon") || null,
        renderHTML: (attrs) => {
          const value = attrs.icon;
          if (!value || typeof value !== "string") return {};
          const rendered: Record<string, string> = {
            "data-link-icon": value,
          };
          if (isSafeIconUrl(value)) {
            rendered.style = `--link-icon-image: ${cssUrlValue(value)};`;
          }
          return rendered;
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
        ({ style, icon }) =>
        ({ chain, commands }) => {
          if (style !== "icon") return commands.unsetMark(this.name);
          return chain().setMark(this.name, { style, icon: icon || null }).run();
        },
      unsetInlineLinkStyle:
        () =>
        ({ commands }) => commands.unsetMark(this.name),
    };
  },
});
