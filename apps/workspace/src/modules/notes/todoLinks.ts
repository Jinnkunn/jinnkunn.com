export interface NoteTodoSource {
  id: string;
  title: string;
}

const NOTE_LINK_PREFIX = "workspace://notes/";

export function buildNoteTodoSource(source: NoteTodoSource): string {
  return `Source note: [${escapeLinkLabel(source.title)}](${NOTE_LINK_PREFIX}${encodeURIComponent(source.id)})`;
}

export function parseNoteTodoSource(notes: string): NoteTodoSource | null {
  const match = notes.match(
    /Source note:\s*\[((?:\\.|[^\]\\])+)]\(workspace:\/\/notes\/([^)]+)\)/i,
  );
  if (!match) return null;
  return {
    id: safeDecodeURIComponent(match[2] ?? ""),
    title: unescapeLinkLabel(match[1] ?? ""),
  };
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function escapeLinkLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("]", "\\]");
}

function unescapeLinkLabel(value: string): string {
  return value.replaceAll("\\]", "]").replaceAll("\\\\", "\\");
}
