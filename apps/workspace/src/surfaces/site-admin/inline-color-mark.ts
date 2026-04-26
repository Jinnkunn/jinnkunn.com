// Custom TipTap mark for inline text/background color. Matches the
// Notion-style "Color" toolbar entry: pick a foreground tint, a background
// tint, or both, and the selected text wraps in a `<span data-color="..."
// data-bg="...">`. Markdown round-trip is via the same span — the markdown
// parser whitelists `<span>` as a passthrough HTML tag.
//
// We use a custom mark instead of TipTap's built-in TextStyle + Color
// extensions because (a) those serialize as inline `style="color: …"`
// which loses the named-color round-trip, and (b) we want the same
// data-color tokens the public site already paints `<Color bg="…">`
// blocks with, so a future refactor can share the palette table.

import { Mark, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    inlineColor: {
      /** Apply or update the inline color mark. Pass `{ color, bg }` —
       * either may be omitted (or empty string) to clear that side. If
       * both end up empty the mark is removed entirely. */
      setInlineColor: (attrs: { color?: string; bg?: string }) => ReturnType;
      /** Strip any inlineColor mark from the current selection. */
      unsetInlineColor: () => ReturnType;
    };
  }
}

export interface InlineColorAttrs {
  color: string | null;
  bg: string | null;
}

export const InlineColor = Mark.create({
  name: "inlineColor",

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-color") || null,
        renderHTML: (attrs) => {
          const value = attrs.color;
          if (!value || typeof value !== "string") return {};
          return { "data-color": value };
        },
      },
      bg: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-bg") || null,
        renderHTML: (attrs) => {
          const value = attrs.bg;
          if (!value || typeof value !== "string") return {};
          return { "data-bg": value };
        },
      },
    };
  },

  parseHTML() {
    // Match any <span> that carries at least one of the data attributes
    // we paint colors with. A bare <span> (no data-*) shouldn't pick up
    // the mark — it's likely intentional structural HTML.
    return [
      {
        tag: "span[data-color]",
      },
      {
        tag: "span[data-bg]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setInlineColor:
        ({ color, bg }) =>
        ({ chain, commands }) => {
          const nextColor = typeof color === "string" && color ? color : null;
          const nextBg = typeof bg === "string" && bg ? bg : null;
          if (!nextColor && !nextBg) {
            return commands.unsetMark(this.name);
          }
          // setMark replaces (rather than merges) the existing attrs, so
          // skipping this branch and just setting fresh attrs is fine for
          // both "first set" and "update" paths.
          return chain().setMark(this.name, { color: nextColor, bg: nextBg }).run();
        },
      unsetInlineColor:
        () =>
        ({ commands }) => commands.unsetMark(this.name),
    };
  },
});
