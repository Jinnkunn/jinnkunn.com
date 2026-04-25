export type MdxBlockType =
  | "paragraph"
  | "heading"
  | "image"
  | "quote"
  | "list"
  | "divider"
  | "callout"
  | "code"
  | "raw";

export interface MdxBlock {
  alt?: string;
  blankLinesBefore?: number;
  caption?: string;
  id: string;
  language?: string;
  level?: 1 | 2 | 3;
  listStyle?: "bulleted" | "numbered";
  markers?: string[];
  text: string;
  type: MdxBlockType;
  url?: string;
}

let idCounter = 0;

export function createMdxBlock(type: MdxBlockType): MdxBlock {
  idCounter += 1;
  if (type === "heading") {
    return { id: `mdx-block-${idCounter}`, type, level: 2, text: "Heading" };
  }
  if (type === "image") {
    return {
      id: `mdx-block-${idCounter}`,
      type,
      alt: "",
      caption: "",
      text: "",
      url: "",
    };
  }
  if (type === "code") {
    return { id: `mdx-block-${idCounter}`, type, language: "", text: "" };
  }
  if (type === "list") {
    return { id: `mdx-block-${idCounter}`, type, listStyle: "bulleted", text: "" };
  }
  if (type === "divider") {
    return { id: `mdx-block-${idCounter}`, type, text: "" };
  }
  if (type === "callout") {
    return { id: `mdx-block-${idCounter}`, type, text: "" };
  }
  return { id: `mdx-block-${idCounter}`, type, text: "" };
}

function makeBlock(type: MdxBlockType, patch: Partial<MdxBlock> = {}): MdxBlock {
  return { ...createMdxBlock(type), ...patch };
}

function isRawMdxParagraph(lines: string[]): boolean {
  return lines.some((line) => {
    const trimmed = line.trim();
    return (
      trimmed.startsWith("|") ||
      trimmed.startsWith("<") ||
      trimmed.startsWith("</") ||
      trimmed.startsWith("import ") ||
      trimmed.startsWith("export ") ||
      /^\{.*\}$/.test(trimmed)
    );
  });
}

export function parseMdxBlocks(source: string): MdxBlock[] {
  const blocks: MdxBlock[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  let blankLinesBefore = 0;

  const pushBlock = (block: MdxBlock) => {
    blocks.push({
      ...block,
      blankLinesBefore: blocks.length === 0 ? 0 : blankLinesBefore,
    });
    blankLinesBefore = 0;
  };

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      index += 1;
      blankLinesBefore += 1;
      continue;
    }

    if (trimmedLine.startsWith("```")) {
      const language = trimmedLine.replace(/^```/, "").trim();
      const bodyLines: string[] = [];
      index += 1;
      while (index < lines.length && (lines[index] ?? "").trim() !== "```") {
        bodyLines.push(lines[index] ?? "");
        index += 1;
      }
      if ((lines[index] ?? "").trim() === "```") index += 1;
      pushBlock(makeBlock("code", { language, text: bodyLines.join("\n") }));
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && (lines[index] ?? "").trim()) {
      paragraphLines.push(lines[index] ?? "");
      index += 1;
    }
    const paragraph = paragraphLines.join("\n").trim();

    if (/^---+$/.test(paragraph)) {
      pushBlock(makeBlock("divider"));
      continue;
    }

    const imageMatch = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(paragraph);
    if (imageMatch) {
      pushBlock(
        makeBlock("image", {
          alt: imageMatch[1],
          text: "",
          url: imageMatch[2],
        }),
      );
      continue;
    }

    const htmlImageMatch =
      /^<figure>\s*<img src="([^"]+)" alt="([^"]*)" \/>\s*<figcaption>([\s\S]*?)<\/figcaption>\s*<\/figure>$/.exec(
        paragraph,
      );
    if (htmlImageMatch) {
      pushBlock(
        makeBlock("image", {
          alt: htmlImageMatch[2],
          caption: htmlImageMatch[3],
          text: "",
          url: htmlImageMatch[1],
        }),
      );
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(paragraph);
    if (headingMatch) {
      pushBlock(
        makeBlock("heading", {
          level: headingMatch[1].length as 1 | 2 | 3,
          text: headingMatch[2],
        }),
      );
      continue;
    }

    const listMatches = paragraphLines.map((item) =>
      /^(\s*(?:[-*]|\d+\.)(?:\s+))(.+)$/.exec(item),
    );
    if (listMatches.every(Boolean)) {
      const firstMarker = listMatches[0]?.[1].trim() ?? "-";
      const numbered = /^\d+\.$/.test(firstMarker);
      const compatible = listMatches.every((match) =>
        numbered
          ? /^\d+\.$/.test(match?.[1].trim() ?? "")
          : /^[-*]$/.test(match?.[1].trim() ?? ""),
      );
      if (compatible) {
        pushBlock(
          makeBlock("list", {
            listStyle: numbered ? "numbered" : "bulleted",
            markers: listMatches.map((match) => match?.[1] ?? "- "),
            text: listMatches.map((match) => match?.[2] ?? "").join("\n"),
          }),
        );
        continue;
      }
    }

    if (paragraphLines.every((item) => /^>\s?/.test(item))) {
      const quoteLines = paragraphLines.map((item) => item.replace(/^>\s?/, ""));
      if (/^\[!NOTE\]\s*$/i.test(quoteLines[0] ?? "")) {
        pushBlock(
          makeBlock("callout", {
            text: quoteLines.slice(1).join("\n"),
          }),
        );
        continue;
      }
      pushBlock(
        makeBlock("quote", {
          text: quoteLines.join("\n"),
        }),
      );
      continue;
    }

    if (isRawMdxParagraph(paragraphLines)) {
      pushBlock(makeBlock("raw", { text: paragraph }));
      continue;
    }

    pushBlock(makeBlock("paragraph", { text: paragraph }));
  }

  return blocks.length > 0 ? blocks : [createMdxBlock("paragraph")];
}

function serializeBlock(block: MdxBlock): string {
  const text = block.text.trim();
  if (block.type === "heading") {
    if (!text) return "";
    return `${"#".repeat(block.level ?? 2)} ${text}`;
  }
  if (block.type === "image") {
    const url = (block.url ?? "").trim();
    if (!url) return "";
    const alt = (block.alt ?? "").trim();
    const caption = (block.caption ?? "").trim();
    if (caption) {
      return `<figure><img src="${url}" alt="${alt}" /><figcaption>${caption}</figcaption></figure>`;
    }
    return `![${alt}](${url})`;
  }
  if (block.type === "quote") {
    if (!text) return "";
    return text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  }
  if (block.type === "callout") {
    if (!text) return "> [!NOTE]";
    return ["> [!NOTE]", ...text.split("\n").map((line) => `> ${line}`)].join("\n");
  }
  if (block.type === "list") {
    if (!text) return "";
    return text
      .split("\n")
      .map((line, index) => {
        const marker =
          block.markers?.[index] ??
          (block.listStyle === "numbered" ? `${index + 1}. ` : "- ");
        return `${marker}${line}`;
      })
      .join("\n");
  }
  if (block.type === "divider") {
    return "---";
  }
  if (block.type === "code") {
    if (!block.text.trim()) return "";
    return `\`\`\`${(block.language ?? "").trim()}\n${block.text.replace(/\n+$/, "")}\n\`\`\``;
  }
  if (block.type === "raw") {
    return block.text.trim();
  }
  return text;
}

export function serializeMdxBlocks(blocks: MdxBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    const serialized = serializeBlock(block);
    if (!serialized) continue;
    if (parts.length > 0) {
      parts.push("\n".repeat((block.blankLinesBefore ?? 1) + 1));
    }
    parts.push(serialized);
  }
  const source = parts.join("");
  return source ? `${source}\n` : "";
}
