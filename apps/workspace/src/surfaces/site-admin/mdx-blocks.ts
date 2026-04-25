export type MdxBlockType = "paragraph" | "heading" | "image" | "quote" | "code";

export interface MdxBlock {
  alt?: string;
  id: string;
  language?: string;
  level?: 1 | 2 | 3;
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
    return { id: `mdx-block-${idCounter}`, type, alt: "", text: "", url: "" };
  }
  if (type === "code") {
    return { id: `mdx-block-${idCounter}`, type, language: "", text: "" };
  }
  return { id: `mdx-block-${idCounter}`, type, text: "" };
}

function makeBlock(type: MdxBlockType, patch: Partial<MdxBlock> = {}): MdxBlock {
  return { ...createMdxBlock(type), ...patch };
}

export function parseMdxBlocks(source: string): MdxBlock[] {
  const blocks: MdxBlock[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      index += 1;
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
      blocks.push(makeBlock("code", { language, text: bodyLines.join("\n") }));
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && (lines[index] ?? "").trim()) {
      paragraphLines.push(lines[index] ?? "");
      index += 1;
    }
    const paragraph = paragraphLines.join("\n").trim();

    const imageMatch = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(paragraph);
    if (imageMatch) {
      blocks.push(
        makeBlock("image", {
          alt: imageMatch[1],
          text: "",
          url: imageMatch[2],
        }),
      );
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(paragraph);
    if (headingMatch) {
      blocks.push(
        makeBlock("heading", {
          level: headingMatch[1].length as 1 | 2 | 3,
          text: headingMatch[2],
        }),
      );
      continue;
    }

    if (paragraphLines.every((item) => /^>\s?/.test(item))) {
      blocks.push(
        makeBlock("quote", {
          text: paragraphLines.map((item) => item.replace(/^>\s?/, "")).join("\n"),
        }),
      );
      continue;
    }

    blocks.push(makeBlock("paragraph", { text: paragraph }));
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
    return `![${(block.alt ?? "").trim()}](${url})`;
  }
  if (block.type === "quote") {
    if (!text) return "";
    return text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  }
  if (block.type === "code") {
    if (!block.text.trim()) return "";
    return `\`\`\`${(block.language ?? "").trim()}\n${block.text.replace(/\n+$/, "")}\n\`\`\``;
  }
  return text;
}

export function serializeMdxBlocks(blocks: MdxBlock[]): string {
  const source = blocks.map(serializeBlock).filter(Boolean).join("\n\n");
  return source ? `${source}\n` : "";
}
