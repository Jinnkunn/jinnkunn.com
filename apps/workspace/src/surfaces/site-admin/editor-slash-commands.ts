import {
  getMatchingBlockEditorCommands,
  type BlockEditorCommand,
} from "./block-editor";
import {
  createMdxBlock,
  type MdxBlock,
  type MdxBlockType,
} from "./mdx-blocks";

const RECENT_SLASH_COMMAND_IDS_KEY =
  "workspace.site-admin.editor.recent-slash-commands.v1";
const RECENT_SLASH_COMMAND_LIMIT = 5;

export interface SlashCommand extends BlockEditorCommand {
  makeBlock: () => MdxBlock;
}

const SLASH_COMMANDS: SlashCommand[] = [
  // Basic - text-bearing blocks for paragraphs, headings, lists, and quotes.
  {
    description: "Plain paragraph text",
    group: "Basic",
    icon: "T",
    id: "text",
    keywords: ["text", "paragraph", "plain"],
    label: "Text",
    makeBlock: () => createMdxBlock("paragraph"),
  },
  {
    description: "Large section heading",
    group: "Basic",
    icon: "H₁",
    id: "heading1",
    keywords: ["h1", "heading1", "title"],
    label: "Heading 1",
    makeBlock: () => ({ ...createMdxBlock("heading"), level: 1, text: "" }),
  },
  {
    description: "Medium section heading",
    group: "Basic",
    icon: "H₂",
    id: "heading2",
    keywords: ["h2", "heading", "heading2"],
    label: "Heading 2",
    makeBlock: () => ({ ...createMdxBlock("heading"), level: 2, text: "" }),
  },
  {
    description: "Small section heading",
    group: "Basic",
    icon: "H₃",
    id: "heading3",
    keywords: ["h3", "heading3", "subheading"],
    label: "Heading 3",
    makeBlock: () => ({ ...createMdxBlock("heading"), level: 3, text: "" }),
  },
  {
    description: "Quote or excerpt",
    group: "Basic",
    icon: "❝",
    id: "quote",
    keywords: ["quote", "blockquote"],
    label: "Quote",
    makeBlock: () => createMdxBlock("quote"),
  },
  {
    description: "Bulleted or numbered list",
    group: "Basic",
    icon: "•",
    id: "list",
    keywords: ["list", "bullet", "bulleted", "numbered"],
    label: "List",
    makeBlock: () => createMdxBlock("list"),
  },
  {
    description: "Checkbox list with completion",
    group: "Basic",
    icon: "☑",
    id: "todo",
    keywords: ["todo", "task", "check", "checkbox", "checklist"],
    label: "To-do list",
    makeBlock: () => createMdxBlock("todo"),
  },
  {
    description: "Collapsible section with hidden content",
    group: "Basic",
    icon: "▸",
    id: "toggle",
    keywords: ["toggle", "collapse", "details", "expand"],
    label: "Toggle",
    makeBlock: () => createMdxBlock("toggle"),
  },
  // Media - uploads and platform-hosted media.
  {
    description: "Upload or paste an image",
    group: "Media",
    icon: "▢",
    id: "image",
    keywords: ["image", "img", "photo", "media"],
    label: "Image",
    makeBlock: () => createMdxBlock("image"),
  },
  {
    description: "YouTube or Vimeo video",
    group: "Media",
    icon: "▶",
    id: "video",
    keywords: ["video", "youtube", "vimeo"],
    label: "Video",
    makeBlock: () => ({ ...createMdxBlock("embed"), embedKind: "youtube" }),
  },
  {
    description: "Uploaded file attachment",
    group: "Media",
    icon: "⇩",
    id: "file",
    keywords: ["file", "upload", "attachment", "pdf"],
    label: "File",
    makeBlock: () => createMdxBlock("file"),
  },
  // Embeds - third-party content and links.
  {
    description: "Link preview card",
    group: "Embeds",
    icon: "⌐",
    id: "bookmark",
    keywords: ["bookmark", "link", "url", "preview"],
    label: "Bookmark",
    makeBlock: () => createMdxBlock("bookmark"),
  },
  {
    description: "Iframe embed (CodePen, Loom, Figma, …)",
    group: "Embeds",
    icon: "⌬",
    id: "embed",
    keywords: ["embed", "iframe"],
    label: "Embed",
    makeBlock: () => ({ ...createMdxBlock("embed"), embedKind: "iframe" }),
  },
  {
    description: "Link to another page in this site",
    group: "Embeds",
    icon: "→",
    id: "page-link",
    keywords: ["page", "link", "internal"],
    label: "Page link",
    makeBlock: () => createMdxBlock("page-link"),
  },
  // Data - typed JSON sources (news, publications, ...) embedded as views.
  // Configure the query inline; entries live in their canonical content/*.json
  // and render via matching server components.
  {
    description: "Latest news entries from content/pages/news.mdx",
    group: "Data",
    icon: "📰",
    id: "news-block",
    keywords: ["news", "updates", "feed"],
    label: "News",
    makeBlock: () => createMdxBlock("news-block"),
  },
  {
    description: "A single dated entry inside the news page",
    group: "Data",
    icon: "🗞",
    id: "news-entry",
    keywords: ["news", "entry", "post", "dated", "feed-item"],
    label: "News entry",
    makeBlock: () => createMdxBlock("news-entry"),
  },
  {
    description: "Publication list from content/pages/publications.mdx",
    group: "Data",
    icon: "📚",
    id: "publications-block",
    keywords: ["publications", "papers", "research", "academic"],
    label: "Publications",
    makeBlock: () => createMdxBlock("publications-block"),
  },
  {
    description: "A single publication inside the publications page",
    group: "Data",
    icon: "📑",
    id: "publications-entry",
    keywords: ["publication", "paper", "entry", "research"],
    label: "Publication",
    makeBlock: () => createMdxBlock("publications-entry"),
  },
  {
    description: "Recent + past work entries from content/pages/works.mdx",
    group: "Data",
    icon: "💼",
    id: "works-block",
    keywords: ["works", "experience", "jobs", "projects", "career"],
    label: "Works",
    makeBlock: () => createMdxBlock("works-block"),
  },
  {
    description: "A single role / position inside the works page",
    group: "Data",
    icon: "🧑‍💼",
    id: "works-entry",
    keywords: ["works", "entry", "role", "job", "position"],
    label: "Works entry",
    makeBlock: () => createMdxBlock("works-entry"),
  },
  {
    description: "Teaching activities from content/pages/teaching.mdx",
    group: "Data",
    icon: "🎓",
    id: "teaching-block",
    keywords: ["teaching", "courses", "education", "classes"],
    label: "Teaching",
    makeBlock: () => createMdxBlock("teaching-block"),
  },
  {
    description: "A single teaching activity inside the teaching page",
    group: "Data",
    icon: "🎓",
    id: "teaching-entry",
    keywords: ["teaching", "entry", "course", "class", "term"],
    label: "Teaching entry",
    makeBlock: () => createMdxBlock("teaching-entry"),
  },
  // Layout - structural blocks and advanced.
  {
    description: "Side-by-side columns (Notion-style)",
    group: "Layout",
    icon: "▥",
    id: "columns",
    keywords: ["columns", "column", "split", "side", "grid", "two", "three"],
    label: "Columns",
    makeBlock: () => createMdxBlock("columns"),
  },
  {
    description: "Profile image + headline (home-hero CSS)",
    group: "Layout",
    icon: "✶",
    id: "hero-block",
    keywords: ["hero", "intro", "profile", "headline", "landing"],
    label: "Hero",
    makeBlock: () => createMdxBlock("hero-block"),
  },
  {
    description: "Stack, grid, or inline row of links",
    group: "Layout",
    icon: "🔗",
    id: "link-list-block",
    keywords: ["links", "list", "buttons", "navigation"],
    label: "Link list",
    makeBlock: () => createMdxBlock("link-list-block"),
  },
  {
    description: "Card grid linking to other pages on the site",
    group: "Layout",
    icon: "🗂",
    id: "featured-pages-block",
    keywords: ["featured", "cards", "pages", "grid"],
    label: "Featured pages",
    makeBlock: () => createMdxBlock("featured-pages-block"),
  },
  {
    description: "Markdown table",
    group: "Layout",
    icon: "▦",
    id: "table",
    keywords: ["table", "grid", "matrix", "spreadsheet"],
    label: "Table",
    makeBlock: () => createMdxBlock("table"),
  },
  {
    description: "Visual separator",
    group: "Layout",
    icon: "—",
    id: "divider",
    keywords: ["divider", "hr", "line"],
    label: "Divider",
    makeBlock: () => createMdxBlock("divider"),
  },
  {
    description: "Highlighted note",
    group: "Layout",
    icon: "⚐",
    id: "callout",
    keywords: ["callout", "note", "tip"],
    label: "Callout",
    makeBlock: () => createMdxBlock("callout"),
  },
  {
    description: "Fenced code block",
    group: "Layout",
    icon: "{}",
    id: "code",
    keywords: ["code", "snippet"],
    label: "Code",
    makeBlock: () => createMdxBlock("code"),
  },
  {
    description: "Advanced MDX",
    group: "Layout",
    icon: "◇",
    id: "raw",
    keywords: ["raw", "mdx", "html"],
    label: "Raw MDX",
    makeBlock: () => createMdxBlock("raw"),
  },
];

function loadRecentSlashCommandIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(RECENT_SLASH_COMMAND_IDS_KEY) ?? "[]",
    ) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function rememberRecentSlashCommand(id: string) {
  if (typeof window === "undefined") return;
  const next = [id, ...loadRecentSlashCommandIds().filter((item) => item !== id)].slice(
    0,
    RECENT_SLASH_COMMAND_LIMIT,
  );
  try {
    window.localStorage.setItem(RECENT_SLASH_COMMAND_IDS_KEY, JSON.stringify(next));
  } catch {
    // Recent commands are an affordance only; storage failure should not
    // interrupt block insertion.
  }
}

export function getMatchingSlashCommands(
  value: string,
  enabledIds?: ReadonlySet<string>,
): SlashCommand[] {
  // Surface-level filter so callers (Notes) can hide site-admin business
  // blocks (publications-block, teaching-links, …) without forking the
  // command list. `undefined` keeps the full vocabulary for site-admin.
  const pool =
    enabledIds && enabledIds.size > 0
      ? SLASH_COMMANDS.filter((command) => enabledIds.has(command.id))
      : SLASH_COMMANDS;
  const matches = getMatchingBlockEditorCommands(value, pool, {
    requireSlash: true,
  });
  const query = value.trim().replace(/^\//, "").replace(/\s+/g, "");
  if (query || matches.length === 0) return matches;
  const recentIds = loadRecentSlashCommandIds();
  if (recentIds.length === 0) return matches;
  const recent = recentIds
    .map((id) => matches.find((command) => command.id === id))
    .filter((command): command is SlashCommand => Boolean(command))
    .map((command) => ({ ...command, group: "Recent" }));
  if (recent.length === 0) return matches;
  const recentSet = new Set(recent.map((command) => command.id));
  return [...recent, ...matches.filter((command) => !recentSet.has(command.id))];
}

export function blockFromSlashCommand(
  value: string,
  enabledIds?: ReadonlySet<string>,
): MdxBlock | null {
  const command = getMatchingSlashCommands(value, enabledIds)[0];
  if (!command) return null;
  rememberRecentSlashCommand(command.id);
  return command.makeBlock();
}

export function replaceBlockType(block: MdxBlock, type: MdxBlockType): MdxBlock {
  if (block.type === type) return block;
  const next = createMdxBlock(type);
  if (
    type === "paragraph" ||
    type === "heading" ||
    type === "quote" ||
    type === "list" ||
    type === "todo" ||
    type === "callout" ||
    type === "code" ||
    type === "raw"
  ) {
    return { ...next, text: block.text };
  }
  if (type === "toggle") {
    // Use the source block's text as the toggle summary; preserve any
    // existing children only if we're already a toggle (handled by the
    // early return above).
    return { ...next, text: block.text };
  }
  if (type === "divider") return next;
  return { ...next, alt: block.text.slice(0, 80), text: "" };
}
