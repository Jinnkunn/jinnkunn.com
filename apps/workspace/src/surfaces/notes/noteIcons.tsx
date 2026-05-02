import type { LucideIcon } from "lucide-react";
import {
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  FileText,
  FolderKanban,
  Inbox,
  SearchCheck,
} from "lucide-react";

import {
  NOTE_ICON_DAILY_NOTE,
  NOTE_ICON_DAILY_REVIEW,
  NOTE_ICON_INBOX,
  NOTE_ICON_MEETING,
  NOTE_ICON_PROJECT,
  NOTE_ICON_RESEARCH,
} from "../../modules/notes/workflow";

const NOTE_TOKEN_ICONS: Record<string, LucideIcon> = {
  [NOTE_ICON_INBOX]: Inbox,
  [NOTE_ICON_DAILY_NOTE]: CalendarDays,
  [NOTE_ICON_DAILY_REVIEW]: CalendarCheck,
  [NOTE_ICON_MEETING]: ClipboardList,
  [NOTE_ICON_PROJECT]: FolderKanban,
  [NOTE_ICON_RESEARCH]: SearchCheck,
};

export function isNoteIconToken(value: string | null | undefined): boolean {
  return Boolean(value && NOTE_TOKEN_ICONS[value.trim()]);
}

export function NoteIconGlyph({
  className,
  icon,
  size = 14,
}: {
  className?: string;
  icon: string | null | undefined;
  size?: number;
}) {
  const trimmedIcon = icon?.trim() ?? "";
  const SystemIcon = NOTE_TOKEN_ICONS[trimmedIcon];
  if (SystemIcon) {
    return (
      <SystemIcon
        absoluteStrokeWidth
        aria-hidden="true"
        className={className}
        focusable="false"
        size={size}
        strokeWidth={1.65}
      />
    );
  }

  if (trimmedIcon) {
    return (
      <span className={className} aria-hidden="true">
        {trimmedIcon}
      </span>
    );
  }

  return (
    <FileText
      absoluteStrokeWidth
      aria-hidden="true"
      className={className}
      focusable="false"
      size={size}
      strokeWidth={1.65}
    />
  );
}
